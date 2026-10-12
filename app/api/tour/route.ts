import { HttpError, json, readJson, requireApiSession, route } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import { IntegrationError } from "@/lib/integrations/errors";
import { getTour, saveTour } from "@/lib/tour/service";
import { tourStateSchema, type TourResponse } from "@/lib/tour/types";

// The device copy is the source of truth; this route is its replica. A missing
// database is a normal answer (`db: false`), not an error — the tour runs
// local-only. A sleeping or broken one is a 503 the client quietly retries.

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function unavailable(err: unknown): never {
	if (err instanceof IntegrationError) console.warn("[tour]", err.code, err.cause ?? "");
	throw new HttpError(503, "Couldn't reach the database.", "db_unavailable");
}

const notConfigured = (err: unknown) => err instanceof IntegrationError && err.code === "db_not_configured";

export const GET = route(async () => {
	const session = await requireApiSession();
	try {
		return json({ ok: true, data: await getTour(session), db: true } satisfies TourResponse);
	} catch (err) {
		if (notConfigured(err)) return json({ ok: true, data: null, db: false } satisfies TourResponse);
		unavailable(err);
	}
});

export const PUT = route(async (request) => {
	const session = await requireApiSession();
	const body = await readJson(request, tourStateSchema);
	if (!body.updatedAt) throw new HttpError(400, "updatedAt is required.", "bad_request");
	if (!limiter.take(sessionKey(session)).ok) throw new HttpError(429, "Too many saves.", "rate_limited");
	try {
		const data = await saveTour(session, { ...body, updatedAt: body.updatedAt });
		return json({ ok: true, data, db: true } satisfies TourResponse);
	} catch (err) {
		if (notConfigured(err)) return json({ ok: true, data: null, db: false } satisfies TourResponse);
		unavailable(err);
	}
});
