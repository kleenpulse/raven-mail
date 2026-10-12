import { describe, toIntegrationError, type IntegrationError } from "./errors";
import type { StepEvent } from "./types";

/** A step's finishing note; `warn` marks it done-but-worth-a-look (amber). */
export type StepOutcome = string | { detail: string; warn: true } | void;

export type Step<C> = {
	id: string;
	label: string;
	run: (ctx: C, signal?: AbortSignal) => Promise<StepOutcome>;
	/** Return a reason to skip (shown as the step's detail), or false to run. */
	skip?: (ctx: C) => string | false;
};

export type StepsEnd<R> =
	| { ok: true; result: R; warned: boolean }
	| { ok: false; error: IntegrationError; step?: string }
	| null;

export const warn = (detail: string) => ({ detail, warn: true }) as const;

type RunOptions = { signal?: AbortSignal; now?: () => number };

/**
 * Runs steps in order and narrates them as step events. The full plan goes out
 * first so the UI can draw every step before any of them starts; the first
 * failure ends the run with an `error` event naming the step that broke.
 * Returns `null` if the caller aborted.
 */
export async function* runSteps<C, R>(
	steps: Step<C>[],
	ctx: C,
	finish: (ctx: C, warned: boolean) => Promise<R> | R,
	{ signal, now = () => performance.now() }: RunOptions = {},
): AsyncGenerator<StepEvent<R>, StepsEnd<R>> {
	yield { type: "plan", steps: steps.map(({ id, label }) => ({ id, label })) };
	let warned = false;

	for (const step of steps) {
		if (signal?.aborted) return null;
		const reason = step.skip?.(ctx);
		if (reason) {
			yield { type: "step", id: step.id, status: "skipped", detail: reason };
			continue;
		}
		yield { type: "step", id: step.id, status: "running" };
		const started = now();
		try {
			const outcome = await step.run(ctx, signal);
			const ms = Math.round(now() - started);
			if (typeof outcome === "object") {
				warned = true;
				yield { type: "step", id: step.id, status: "warn", ms, detail: outcome.detail };
			} else {
				yield { type: "step", id: step.id, status: "ok", ms, ...(outcome ? { detail: outcome } : {}) };
			}
		} catch (err) {
			if (signal?.aborted) return null;
			const error = toIntegrationError(err);
			yield { type: "step", id: step.id, status: "error", ms: Math.round(now() - started), detail: error.message };
			yield { type: "error", step: step.id, ...describe(error) };
			return { ok: false, error, step: step.id };
		}
	}

	try {
		const result = await finish(ctx, warned);
		yield { type: "done", result };
		return { ok: true, result, warned };
	} catch (err) {
		const error = toIntegrationError(err);
		yield { type: "error", ...describe(error) };
		return { ok: false, error };
	}
}
