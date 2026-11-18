import { HttpError, json, readJson, requireApiSession, route } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import { IntegrationError } from "@/lib/integrations/errors";
import { getBoard, saveBoard } from "@/lib/overview-board/service";
import { BOARD_PARTS, boardDocSchema, type BoardResponse } from "@/lib/overview-board/types";

// The device copy is the source of truth; this route is its replica. A missing
// database is a normal answer (`db: false`), not an error: the board is then
// kept on the device only. A sleeping or broken one is a 503 the client
// retries.
//
// The body is checked for shape only. Which cards exist is the client's
// business: a tab from an older release shares these rows with a newer one.

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function unavailable(err: unknown): never {
	if (err instanceof IntegrationError) console.warn("[overview-board]", err.code, err.cause ?? "");
	throw new HttpError(503, "Couldn't reach the database.", "db_unavailable");
}

const notConfigured = (err: unknown) => err instanceof IntegrationError && err.code === "db_not_configured";

export const GET = route(async () => {
	const session = await requireApiSession();
	try {
		return json({ ok: true, data: await getBoard(session), db: true } satisfies BoardResponse);
	} catch (err) {
		if (notConfigured(err)) return json({ ok: true, data: null, db: false } satisfies BoardResponse);
		unavailable(err);
	}
});

export const PUT = route(async (request) => {
	const session = await requireApiSession();
	const body = await readJson(request, boardDocSchema);
	if (!BOARD_PARTS.some((part) => body[part])) throw new HttpError(400, "Nothing to save.", "bad_request");
	if (!limiter.take(sessionKey(session)).ok) throw new HttpError(429, "Too many saves.", "rate_limited");
	try {
		return json({ ok: true, data: await saveBoard(session, body), db: true } satisfies BoardResponse);
	} catch (err) {
		if (notConfigured(err)) return json({ ok: true, data: null, db: false } satisfies BoardResponse);
		unavailable(err);
	}
});
