import { jsonResponse, ndjsonResponse } from "@/test/dom";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { StepEvent } from "@/lib/integrations/types";

const { act, renderHook } = await import("@testing-library/react");
const { useStepStream } = await import("./use-step-stream");

type Result = { summary: string };

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function answer(res: Response | (() => Promise<Response>)) {
	fetchMock = mock(typeof res === "function" ? res : async () => res);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
	answer(jsonResponse({ ok: false, error: "unset" }, 500));
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

const PLAN: StepEvent<Result> = {
	type: "plan",
	steps: [
		{ id: "auth", label: "Authenticate" },
		{ id: "send", label: "Send test event" },
	],
};

async function runHook(body: unknown = { id: "c1" }) {
	const hook = renderHook(() => useStepStream<Result>("/api/integrations/test"));
	let returned: Awaited<ReturnType<typeof hook.result.current.run>> | undefined;
	await act(async () => {
		returned = await hook.result.current.run(body);
	});
	return { ...hook, returned: returned! };
}

describe("useStepStream", () => {
	test("starts idle", () => {
		const { result } = renderHook(() => useStepStream<Result>("/x"));
		expect(result.current.status).toBe("idle");
		expect(result.current.steps).toEqual([]);
	});

	test("posts JSON asking for NDJSON", async () => {
		answer(ndjsonResponse([PLAN, { type: "done", result: { summary: "ok" } }]));
		await runHook({ id: "c1" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/integrations/test");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe(JSON.stringify({ id: "c1" }));
		expect((init?.headers as Record<string, string>).accept).toBe("application/x-ndjson");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	test("plan → step → done mirrors into state", async () => {
		answer(
			ndjsonResponse(
				[
					PLAN,
					{ type: "step", id: "auth", status: "running" },
					{ type: "step", id: "auth", status: "ok", detail: "Token valid", ms: 12 },
					{ type: "step", id: "send", status: "warn", detail: "Slow", ms: 900 },
					{ type: "done", result: { summary: "Delivered" } },
				],
				{ split: true },
			),
		);
		const { result, returned } = await runHook();
		expect(result.current.status).toBe("done");
		expect(result.current.steps).toEqual([
			{ id: "auth", label: "Authenticate", status: "ok", detail: "Token valid", ms: 12 },
			{ id: "send", label: "Send test event", status: "warn", detail: "Slow", ms: 900 },
		]);
		expect(result.current.result).toEqual({ summary: "Delivered" });
		expect(result.current.error).toBeUndefined();
		expect(typeof result.current.startedAt).toBe("number");
		expect(result.current.finishedAt).toBeGreaterThanOrEqual(result.current.startedAt!);
		// run() resolves with the same final state.
		expect(returned.status).toBe("done");
		expect(returned.result).toEqual({ summary: "Delivered" });
	});

	test("plan alone leaves every step pending until events arrive", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const enc = new TextEncoder();
		answer(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						async start(c) {
							c.enqueue(enc.encode(`${JSON.stringify(PLAN)}\n`));
							await gate;
							c.enqueue(enc.encode(`${JSON.stringify({ type: "done", result: { summary: "x" } })}\n`));
							c.close();
						},
					}),
				),
		);
		const { result } = renderHook(() => useStepStream<Result>("/x"));
		let pending!: Promise<unknown>;
		act(() => {
			pending = result.current.run({});
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		expect(result.current.status).toBe("running");
		expect(result.current.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
		await act(async () => {
			release();
			await pending;
		});
		expect(result.current.status).toBe("done");
	});

	test("an error event ends the run with its failure", async () => {
		answer(
			ndjsonResponse([
				PLAN,
				{ type: "step", id: "auth", status: "error", detail: "401 from Slack" },
				{ type: "error", code: "auth_failed", message: "Slack rejected the token.", hint: "Reconnect.", step: "auth", retryable: false },
			]),
		);
		const { result } = await runHook();
		expect(result.current.status).toBe("error");
		expect(result.current.error).toEqual({
			code: "auth_failed",
			message: "Slack rejected the token.",
			hint: "Reconnect.",
			step: "auth",
			retryable: false,
		});
		expect(result.current.steps[0]!.status).toBe("error");
	});

	test("a stream that ends without a terminal event surfaces stream_cut and fails running steps", async () => {
		answer(ndjsonResponse([PLAN, { type: "step", id: "auth", status: "ok" }, { type: "step", id: "send", status: "running" }]));
		const { result } = await runHook();
		expect(result.current.status).toBe("error");
		expect(result.current.error?.code).toBe("stream_cut");
		expect(result.current.error?.retryable).toBe(true);
		expect(result.current.steps.map((s) => s.status)).toEqual(["ok", "error"]);
		expect(result.current.finishedAt).toBeDefined();
	});

	test("an empty body is also a cut stream", async () => {
		answer(ndjsonResponse([]));
		const { result } = await runHook();
		expect(result.current.error?.code).toBe("stream_cut");
		expect(result.current.steps).toEqual([]);
	});

	test("non-OK JSON answer becomes the error via readApiError", async () => {
		answer(jsonResponse({ ok: false, error: "Connection not found.", code: "not_found", hint: "Refresh the page." }, 404));
		const { result } = await runHook();
		expect(result.current.status).toBe("error");
		expect(result.current.error).toEqual({ code: "not_found", message: "Connection not found.", hint: "Refresh the page.", retryable: false });
	});

	test("non-OK without a JSON body falls back to a status message; 5xx is retryable", async () => {
		answer(new Response("gateway down", { status: 502 }));
		const { result } = await runHook();
		expect(result.current.error).toEqual({ code: "error", message: "Request failed (502)", hint: undefined, retryable: true });
	});

	test("401 sends the browser to /login and leaves no error", async () => {
		const replace = spyOn(window.location, "replace").mockImplementation(() => {});
		try {
			answer(jsonResponse({ ok: false, error: "Signed out" }, 401));
			const { result } = await runHook();
			expect(replace).toHaveBeenCalledWith("/login");
			expect(result.current.status).toBe("running");
			expect(result.current.error).toBeUndefined();
		} finally {
			replace.mockRestore();
		}
	});

	test("a network failure reads as stream_cut", async () => {
		answer(async () => {
			throw new TypeError("Failed to fetch");
		});
		const { result } = await runHook();
		expect(result.current.status).toBe("error");
		expect(result.current.error?.code).toBe("stream_cut");
	});

	test("reset returns to idle", async () => {
		answer(ndjsonResponse([PLAN, { type: "done", result: { summary: "ok" } }]));
		const { result } = await runHook();
		expect(result.current.status).toBe("done");
		act(() => result.current.reset());
		expect(result.current.status).toBe("idle");
		expect(result.current.steps).toEqual([]);
	});
});
