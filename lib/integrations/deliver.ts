import { toIntegrationError, type IntegrationError } from "./errors";
import type { HttpResult } from "./http";

export type Attempt = (signal?: AbortSignal) => Promise<HttpResult>;
/** `null` when the response is a success, otherwise the error it amounts to. */
export type Judge = (res: HttpResult) => IntegrationError | null;

export type DeliveryOptions = {
	maxAttempts?: number;
	/** Delay before retry n (jittered ±20%); the last value repeats. */
	backoffMs?: number[];
	/** Longer Retry-After requests end the attempt — the user retries later. */
	maxRetryAfterMs?: number;
	/** Total wall-clock budget across attempts and waits. */
	budgetMs?: number;
	/**
	 * Receiver dedupes repeats (Standard Webhooks reuse `webhook-id`). Chat
	 * webhooks don't: once a body went out unanswered, retrying could double-post.
	 */
	idempotent?: boolean;
	signal?: AbortSignal;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
	random?: () => number;
};

export type Delivery =
	| { ok: true; attempts: number; latencyMs: number; response: HttpResult }
	| { ok: false; attempts: number; latencyMs: number; error: IntegrationError; response?: HttpResult };

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

/**
 * Sends with bounded retries. Only transient failures retry (network, 5xx,
 * 429); a revoked webhook or a rejected payload fails at once. Retry-After is
 * honoured when short, otherwise surfaced so the UI can say "try again in 30s".
 */
export async function deliver(attempt: Attempt, judge: Judge, options: DeliveryOptions = {}): Promise<Delivery> {
	const {
		maxAttempts = 3,
		backoffMs = [500, 1500],
		maxRetryAfterMs = 5_000,
		budgetMs = 15_000,
		idempotent = false,
		signal,
		sleep: wait = sleep,
		now = Date.now,
		random = Math.random,
	} = options;

	const started = now();
	let error: IntegrationError | undefined;
	let response: HttpResult | undefined;

	for (let n = 1; n <= maxAttempts; n++) {
		try {
			response = await attempt(signal);
			const verdict = judge(response);
			if (!verdict) return { ok: true, attempts: n, latencyMs: response.ms, response };
			error = verdict;
		} catch (err) {
			if (signal?.aborted) throw err;
			error = toIntegrationError(err);
			response = undefined;
		}

		const fail = (): Delivery => ({ ok: false, attempts: n, latencyMs: now() - started, error: error!, response });
		if (!error.retryable || n === maxAttempts) return fail();
		if (error.code === "unconfirmed" && !idempotent) return fail();

		const base = backoffMs[Math.min(n - 1, backoffMs.length - 1)] ?? 1_000;
		const delay = error.retryAfterMs ?? Math.round(base * (0.8 + random() * 0.4));
		if (delay > maxRetryAfterMs || now() - started + delay > budgetMs) return fail();
		await wait(delay, signal);
	}

	// Unreachable: the loop always returns on its last iteration.
	return { ok: false, attempts: maxAttempts, latencyMs: now() - started, error: error!, response };
}
