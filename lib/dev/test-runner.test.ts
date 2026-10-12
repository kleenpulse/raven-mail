import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { TestRunEvent } from "./test-report";
import { assertIdle, startRun, type SpawnImpl } from "./test-runner";

/** A child process whose stdout we script line by line. */
function fakeChild(lines: string[], code = 0) {
	const stdout = new PassThrough();
	const child = Object.assign(new EventEmitter(), { stdout, exitCode: null as number | null, killed: false }) as unknown as ChildProcess & {
		killed: boolean;
	};
	(child as { kill: () => boolean }).kill = () => {
		(child as { killed: boolean }).killed = true;
		stdout.end();
		return true;
	};
	queueMicrotask(() => {
		for (const l of lines) stdout.write(`${l}\n`);
		stdout.end();
		stdout.once("close", () => {
			(child as { exitCode: number | null }).exitCode = code;
			child.emit("close", code);
		});
	});
	return child;
}

async function collect(it: AsyncIterable<TestRunEvent>) {
	const out: TestRunEvent[] = [];
	for await (const e of it) out.push(e);
	return out;
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__emDevTestRun;
});

describe("startRun", () => {
	test("relays well-formed events, skipping noise", async () => {
		let seen: { cmd: string; args: string[] } | null = null;
		const spawnImpl: SpawnImpl = (cmd, args) => {
			seen = { cmd, args };
			return fakeChild([
				JSON.stringify({ type: "start", runId: "r", startedAt: "" }),
				"not json",
				JSON.stringify({ nope: true }),
				JSON.stringify({ type: "test", file: "a", name: "x", status: "pass" }),
				JSON.stringify({ type: "error", message: "done-ish" }),
			]);
		};
		const events = await collect(startRun({ coverage: false, signal: new AbortController().signal, spawnImpl }));
		expect(events.map((e) => e.type)).toEqual(["start", "test", "error"]);
		expect(seen!.args).toContain("--ndjson");
		expect(seen!.args).toContain("--no-coverage");
	});

	test("coverage on passes no opt-out flag", async () => {
		let args: string[] = [];
		const spawnImpl: SpawnImpl = (_cmd, a) => {
			args = a;
			return fakeChild([JSON.stringify({ type: "error", message: "x" })]);
		};
		await collect(startRun({ coverage: true, signal: new AbortController().signal, spawnImpl }));
		expect(args).not.toContain("--no-coverage");
	});

	test("an exit without a terminal event becomes an error event", async () => {
		const events = await collect(
			startRun({ coverage: false, signal: new AbortController().signal, spawnImpl: () => fakeChild([], 3) }),
		);
		expect(events).toEqual([{ type: "error", message: "Test runner exited (3) without a report." }]);
	});

	test("holds a single-flight lock and releases it afterwards", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const spawnImpl: SpawnImpl = () => {
			const stdout = new PassThrough();
			const child = Object.assign(new EventEmitter(), { stdout, exitCode: null, kill: () => true }) as unknown as ChildProcess;
			void gate.then(() => {
				stdout.end(`${JSON.stringify({ type: "error", message: "fin" })}\n`);
				stdout.once("close", () => child.emit("close", 0));
			});
			return child;
		};
		const first = collect(startRun({ coverage: false, signal: new AbortController().signal, spawnImpl }));
		await Bun.sleep(5);
		expect(() => assertIdle()).toThrow("already in progress");
		const second = await collect(startRun({ coverage: false, signal: new AbortController().signal, spawnImpl }));
		expect(second).toEqual([{ type: "error", message: "A test run is already in progress." }]);
		release();
		await first;
		expect(() => assertIdle()).not.toThrow();
	});

	test("abort kills the child and ends quietly", async () => {
		const ctrl = new AbortController();
		let child!: ChildProcess & { killed: boolean };
		const spawnImpl: SpawnImpl = () => {
			const stdout = new PassThrough();
			child = Object.assign(new EventEmitter(), { stdout, exitCode: null, killed: false }) as unknown as ChildProcess & { killed: boolean };
			(child as { kill: () => boolean }).kill = () => {
				(child as { killed: boolean }).killed = true;
				stdout.end();
				stdout.once("close", () => child.emit("close", null));
				return true;
			};
			return child;
		};
		const run = collect(startRun({ coverage: false, signal: ctrl.signal, spawnImpl }));
		await Bun.sleep(5);
		ctrl.abort();
		expect(await run).toEqual([]);
		expect(child.killed).toBe(true);
	});
});
