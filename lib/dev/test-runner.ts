import "server-only";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { HttpError } from "@/lib/server/guard";
import type { TestRunEvent } from "./test-report";

/*
 * Dev-only: runs `scripts/test-report.ts --ndjson` and relays its events.
 * One run at a time per process; the lock lives on globalThis so it survives
 * dev-server HMR.
 */

export type SpawnImpl = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

const LOCK = "__emDevTestRun";
type Lock = { [LOCK]?: boolean };

const BUSY = "A test run is already in progress.";

/** Throws the 409 up front, while the response can still carry a status. */
export function assertIdle(): void {
	if ((globalThis as Lock)[LOCK]) throw new HttpError(409, BUSY, "busy");
}

function bunBinary(): string {
	const exec = process.env.npm_execpath ?? "";
	return /bun(\.exe)?$/i.test(exec) ? exec : "bun";
}

const isEvent = (v: unknown): v is TestRunEvent =>
	typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

export async function* startRun({
	coverage,
	signal,
	spawnImpl = nodeSpawn as SpawnImpl,
}: {
	coverage: boolean;
	signal: AbortSignal;
	spawnImpl?: SpawnImpl;
}): AsyncGenerator<TestRunEvent> {
	const g = globalThis as Lock;
	// The route pre-checks for a clean 409; this only catches two requests racing past it.
	if (g[LOCK]) {
		yield { type: "error", message: BUSY };
		return;
	}
	g[LOCK] = true;

	let child: ChildProcess | null = null;
	const kill = () => child?.kill();
	try {
		const cwd = process.cwd();
		child = spawnImpl(bunBinary(), [path.join("scripts", "test-report.ts"), "--ndjson", ...(coverage ? [] : ["--no-coverage"])], {
			cwd,
			env: process.env,
		});
		signal.addEventListener("abort", kill, { once: true });

		const exited = new Promise<number | null>((resolve) => {
			child!.once("close", (code) => resolve(code));
			child!.once("error", () => resolve(null));
		});

		let terminal = false;
		let buffer = "";
		const decoder = new TextDecoder();
		for await (const chunk of child.stdout ?? []) {
			buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
			let nl = buffer.indexOf("\n");
			while (nl >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (!line) continue;
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					continue;
				}
				if (!isEvent(parsed)) continue;
				if (parsed.type === "done" || parsed.type === "error") terminal = true;
				yield parsed;
			}
		}

		const code = await exited;
		if (!terminal && !signal.aborted) {
			yield { type: "error", message: `Test runner exited (${code ?? "failed to start"}) without a report.` };
		}
	} finally {
		signal.removeEventListener("abort", kill);
		if (child && child.exitCode === null) child.kill();
		g[LOCK] = false;
	}
}
