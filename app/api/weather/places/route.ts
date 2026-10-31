import { z } from "zod";
import { HttpError, json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { searchPlaces } from "@/lib/weather/places";

const querySchema = z.object({ q: z.string().trim().min(2).max(80) });

/** Cities matching a typed name, for picking where local weather comes from. */
export const GET = route(async (request) => {
	await requireApiSession();
	const { q } = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
	const places = await searchPlaces(q);
	if (!places) throw new HttpError(502, "Couldn't look up places right now.", "places_unavailable");
	return json({ ok: true, data: { places } });
});
