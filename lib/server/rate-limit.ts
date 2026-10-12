export interface RateLimiter {
	take(key: string): { ok: true } | { ok: false; retryAfterMs: number };
}

/** Fixed-window limiter; in-process (see `cache.ts` for the swap-out rationale). */
export function createRateLimiter({
	limit,
	windowMs,
	now = Date.now,
}: {
	limit: number;
	windowMs: number;
	now?: () => number;
}): RateLimiter {
	const windows = new Map<string, { count: number; resetAt: number }>();

	return {
		take(key) {
			const t = now();
			if (windows.size > 1000) {
				for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
			}
			const current = windows.get(key);
			if (!current || current.resetAt <= t) {
				windows.set(key, { count: 1, resetAt: t + windowMs });
				return { ok: true };
			}
			if (current.count >= limit) {
				return { ok: false, retryAfterMs: current.resetAt - t };
			}
			current.count += 1;
			return { ok: true };
		},
	};
}
