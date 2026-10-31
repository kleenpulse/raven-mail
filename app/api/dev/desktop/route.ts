import { timingSafeEqual } from "node:crypto";
import { HttpError, route } from "@/lib/server/guard";

/*
 * Dev-only: the desktop shell calls this before it stops `next dev`. Stopping
 * a dev server on Windows is a hard kill, and a killed PGlite writer can leave
 * its folder unopenable, so the shell closes the database first.
 */
export const POST = route(async (request) => {
	const token = process.env.RAVEN_DESKTOP_TOKEN;
	const sent = request.headers.get("x-raven-desktop");
	if (process.env.NODE_ENV === "production" || !token || !sent || !same(sent, token)) {
		throw new HttpError(404, "Not found.", "not_found");
	}
	if (process.env.RAVEN_DESKTOP_BUILD && process.env.RAVEN_DB === "pglite") {
		const { closeLocalDb } = await import("@/lib/db/local");
		await closeLocalDb();
	}
	return new Response(null, { status: 204 });
});

function same(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
