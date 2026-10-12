"use client";

import * as React from "react";
import { readApiError, toApiError } from "@/lib/api-error";
import type { StepEvent, StepFailure, StepStatus } from "@/lib/integrations/types";
import { readNdjson } from "@/lib/ndjson-client";

export type StepState = { id: string; label: string; status: StepStatus; detail?: string; ms?: number };

export type StreamState<R> = {
	status: "idle" | "running" | "done" | "error";
	steps: StepState[];
	result?: R;
	error?: StepFailure;
	/** performance.now() stamps, for the elapsed readout. */
	startedAt?: number;
	finishedAt?: number;
};

const IDLE: StreamState<never> = { status: "idle", steps: [] };

const STREAM_CUT: StepFailure = {
	code: "stream_cut",
	message: "Lost the connection before Raven finished.",
	hint: "Check your network and try again.",
	retryable: true,
};

function apply<R>(state: StreamState<R>, event: StepEvent<R>): StreamState<R> {
	switch (event.type) {
		case "plan":
			return { ...state, steps: event.steps.map((s) => ({ ...s, status: "pending" })) };
		case "step":
			return {
				...state,
				steps: state.steps.map((s) =>
					s.id === event.id ? { ...s, status: event.status, detail: event.detail, ms: event.ms } : s,
				),
			};
		case "done":
			return { ...state, status: "done", result: event.result, finishedAt: performance.now() };
		case "error": {
			const failure: StepFailure = { code: event.code, message: event.message, hint: event.hint, step: event.step, retryable: event.retryable };
			return { ...state, status: "error", error: failure, finishedAt: performance.now() };
		}
	}
}

/**
 * Runs a streamed step flow (connect, test, diagnostics) and mirrors it as
 * state. Exactly one terminal event is expected; a stream that ends without
 * one surfaces as "lost the connection" rather than hanging on a spinner.
 */
export function useStepStream<R>(url: string) {
	const [state, setState] = React.useState<StreamState<R>>(IDLE);
	const controller = React.useRef<AbortController | null>(null);

	React.useEffect(() => () => controller.current?.abort(), []);

	const run = React.useCallback(
		async (body: unknown): Promise<StreamState<R>> => {
			controller.current?.abort();
			const ctrl = new AbortController();
			controller.current = ctrl;
			let current: StreamState<R> = { status: "running", steps: [], startedAt: performance.now() };
			const commit = (next: StreamState<R>) => {
				current = next;
				if (!ctrl.signal.aborted) setState(next);
			};
			commit(current);

			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/x-ndjson" },
					body: JSON.stringify(body),
					signal: ctrl.signal,
				});
				if (res.status === 401) {
					window.location.replace("/login");
					return current;
				}
				if (!res.ok || !res.body) {
					const err = await readApiError(res);
					commit({ ...current, status: "error", error: { code: err.code, message: err.message, hint: err.hint, retryable: err.retryable }, finishedAt: performance.now() });
					return current;
				}
				await readNdjson<StepEvent<R>>(res.body, (event) => commit(apply(current, event)));
				if (current.status === "running") {
					commit({
						...current,
						status: "error",
						error: STREAM_CUT,
						steps: current.steps.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)),
						finishedAt: performance.now(),
					});
				}
			} catch (err) {
				if (ctrl.signal.aborted) return current;
				const e = toApiError(err);
				commit({
					...current,
					status: "error",
					error: e.code === "network" ? STREAM_CUT : { code: e.code, message: e.message, hint: e.hint, retryable: e.retryable },
					steps: current.steps.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)),
					finishedAt: performance.now(),
				});
			} finally {
				if (controller.current === ctrl) controller.current = null;
			}
			return current;
		},
		[url],
	);

	const reset = React.useCallback(() => {
		controller.current?.abort();
		setState(IDLE);
	}, []);

	return { ...state, run, reset };
}
