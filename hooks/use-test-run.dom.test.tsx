import { jsonResponse, ndjsonResponse, router } from "@/test/dom";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { TestHistory, TestReport, TestRunEvent } from "@/lib/dev/test-report";

const { act, renderHook } = await import("@testing-library/react");
const { useTestRun } = await import("./use-test-run");

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function answer(res: Response | (() => Promise<Response>)) {
	fetchMock = mock(typeof res === "function" ? res : async () => res);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

const REPORT: TestReport = {
	schema: 1,
	runId: "run-1",
	startedAt: "2026-09-25T10:00:00.000Z",
	finishedAt: "2026-09-25T10:00:03.000Z",
	ms: 3000,
	bun: "1.4.0",
	exitCode: 1,
	counts: { total: 3, pass: 2, fail: 1, skip: 0, todo: 0 },
	files: [],
};
const HISTORY: TestHistory = { schema: 1, runs: [] };

const EVENTS: TestRunEvent[] = [
	{ type: "start", runId: "run-1", startedAt: REPORT.startedAt },
	{ type: "file", file: "lib/a.test.ts", layer: "unit" },
	{ type: "test", file: "lib/a.test.ts", name: "one", status: "pass", ms: 1 },
	{ type: "test", file: "lib/a.test.ts", name: "two", status: "fail", ms: 2 },
	{ type: "file", file: "test/api/b.test.ts", layer: "route" },
	{ type: "test", file: "test/api/b.test.ts", name: "three", status: "pass" },
];

async function runHook(url?: string) {
	const hook = renderHook(() => useTestRun(url));
	await act(async () => {
		await hook.result.current.run();
	});
	return hook;
}

describe("useTestRun", () => {
	test("starts idle", () => {
		const { result } = renderHook(() => useTestRun());
		expect(result.current.state.status).toBe("idle");
		expect(result.current.running).toBe(false);
	});

	test("posts to the default run route, always with coverage", async () => {
		answer(ndjsonResponse([...EVENTS, { type: "done", report: REPORT, history: HISTORY }]));
		await runHook();
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/dev/tests/run");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe(JSON.stringify({ coverage: true }));
	});

	test("start/file/test/done → counts, dots and report; router refreshed", async () => {
		answer(ndjsonResponse([...EVENTS, { type: "done", report: REPORT, history: HISTORY }], { split: true }));
		const { result } = await runHook();
		const s = result.current.state;
		expect(s.status).toBe("done");
		expect(s.runId).toBe("run-1");
		expect(s.files).toBe(2);
		expect(s.dots.map((d) => d.status)).toEqual(["pass", "fail", "pass"]);
		expect(s.dots[0]).toMatchObject({ name: expect.any(String), file: expect.any(String) });
		expect(s.counts).toEqual(REPORT.counts);
		expect(s.report).toEqual(REPORT);
		expect(s.history).toEqual(HISTORY);
		expect(s.currentFile).toBeUndefined();
		expect(result.current.running).toBe(false);
		expect(router.refresh).toHaveBeenCalledTimes(1);
	});

	test("live counts before the report lands", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const enc = new TextEncoder();
		answer(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						async start(c) {
							for (const e of EVENTS) c.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
							await gate;
							c.enqueue(enc.encode(`${JSON.stringify({ type: "done", report: REPORT, history: HISTORY })}\n`));
							c.close();
						},
					}),
				),
		);
		const { result } = renderHook(() => useTestRun());
		let pending!: Promise<void>;
		act(() => {
			pending = result.current.run();
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		expect(result.current.running).toBe(true);
		expect(result.current.state.counts).toEqual({ total: 3, pass: 2, fail: 1, skip: 0, todo: 0 });
		expect(result.current.state.currentFile).toBe("test/api/b.test.ts");
		expect(router.refresh).not.toHaveBeenCalled();

		// A second run while one is in flight is ignored.
		await act(async () => {
			await result.current.run();
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			release();
			await pending;
		});
		expect(result.current.state.status).toBe("done");
	});

	test("409 JSON error → status error with the server's message", async () => {
		answer(jsonResponse({ ok: false, error: "A run is already in progress.", code: "busy" }, 409));
		const { result } = await runHook();
		expect(result.current.state.status).toBe("error");
		expect(result.current.state.error).toBe("A run is already in progress.");
		expect(router.refresh).not.toHaveBeenCalled();
	});

	test("stream ending without a terminal event → error", async () => {
		answer(ndjsonResponse(EVENTS));
		const { result } = await runHook();
		expect(result.current.state.status).toBe("error");
		expect(result.current.state.error).toBe("The run ended without a report.");
		// Progress so far is kept.
		expect(result.current.state.dots).toHaveLength(3);
		expect(router.refresh).not.toHaveBeenCalled();
	});

	test("an error event ends the run with its message", async () => {
		answer(ndjsonResponse([EVENTS[0]!, { type: "error", message: "bun crashed" }]));
		const { result } = await runHook();
		expect(result.current.state.status).toBe("error");
		expect(result.current.state.error).toBe("bun crashed");
		expect(router.refresh).not.toHaveBeenCalled();
	});

	test("network failure → error with the friendly message", async () => {
		answer(async () => {
			throw new TypeError("Failed to fetch");
		});
		const { result } = await runHook();
		expect(result.current.state.status).toBe("error");
		expect(result.current.state.error).toBe("Couldn't reach Raven.");
	});

	test("401 → window.location.replace('/login')", async () => {
		const replace = spyOn(window.location, "replace").mockImplementation(() => {});
		try {
			answer(jsonResponse({ ok: false, error: "Signed out" }, 401));
			await runHook();
			expect(replace).toHaveBeenCalledWith("/login");
		} finally {
			replace.mockRestore();
		}
	});

	test("can run again after finishing", async () => {
		answer(ndjsonResponse([...EVENTS, { type: "done", report: REPORT, history: HISTORY }]));
		const { result } = await runHook("/custom/run");
		answer(ndjsonResponse([...EVENTS, { type: "done", report: { ...REPORT, runId: "run-2" }, history: HISTORY }]));
		await act(async () => {
			await result.current.run();
		});
		expect(fetchMock.mock.calls[0]![0]).toBe("/custom/run");
		expect(result.current.state.report?.runId).toBe("run-2");
		expect(router.refresh).toHaveBeenCalledTimes(2);
	});
});
