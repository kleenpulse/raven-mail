import "server-only";
import { json, route } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import type { MailSession } from "@/lib/session";
import { describe, IntegrationError } from "./errors";

type Handler = (request: Request) => Promise<Response>;

/** `route()` plus the integrations error vocabulary (code, hint, retryable) on the wire. */
export function integrationRoute(handler: Handler): Handler {
	return route(
		async (request) => {
			try {
				return await handler(request);
			} catch (err) {
				if (!(err instanceof IntegrationError)) throw err;
				if (err.code === "internal") console.error("[integrations]", err.cause ?? err);
				const headers = err.retryAfterMs ? { "Retry-After": String(Math.ceil(err.retryAfterMs / 1000)) } : undefined;
				return json({ ok: false, error: err.message, ...describe(err) }, { status: err.status, headers });
			}
		},
		{ fallback: "Something went wrong on Raven's side." },
	);
}

/** A per-mailbox limiter that throws the catalog's `too_many_requests`. */
export function limiter(limit: number, windowMs = 60_000) {
	const inner = createRateLimiter({ limit, windowMs });
	return (session: MailSession) => {
		const taken = inner.take(sessionKey(session));
		if (!taken.ok) throw new IntegrationError("too_many_requests", { retryAfterMs: taken.retryAfterMs });
	};
}

/** The terminal event a stream sends if the server itself fell over mid-run. */
export const CRASH_EVENT = {
	type: "error",
	code: "internal",
	message: "Something went wrong on Raven's side.",
	hint: "Try again. If it keeps happening, check the server logs.",
	retryable: true,
} as const;
