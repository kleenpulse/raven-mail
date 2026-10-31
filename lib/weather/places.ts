import "server-only";
import { roundCoord } from "@/lib/weather/forecast";

/** A place the user can pick for local weather. */
export type WeatherPlace = { label: string; lat: number; lon: number };

const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const TTL_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 4_000;
const MAX_ENTRIES = 200;
const COUNT = 5;

const cache = new Map<string, { at: number; places: WeatherPlace[] }>();

type GeoResult = { name?: unknown; admin1?: unknown; country?: unknown; latitude?: unknown; longitude?: unknown };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function toPlace(result: GeoResult): WeatherPlace | null {
	const name = text(result.name);
	const { latitude: lat, longitude: lon } = result;
	if (!name || typeof lat !== "number" || typeof lon !== "number") return null;
	const parts = [name, text(result.admin1), text(result.country)].filter((part, i, all): part is string => !!part && all.indexOf(part) === i);
	return { label: parts.join(", ").slice(0, 80), lat: roundCoord(lat), lon: roundCoord(lon) };
}

/**
 * Cities matching what the user typed, from Open-Meteo's geocoding (free, no
 * key; the same service the weather comes from). Called from the server, and
 * only with the name the user typed. Cached for a day per name. Null when
 * the lookup failed, so the caller can tell that from "no such place".
 */
export async function searchPlaces(query: string, now = Date.now()): Promise<WeatherPlace[] | null> {
	const key = query.trim().toLowerCase();
	const hit = cache.get(key);
	if (hit && now - hit.at < TTL_MS) return hit.places;

	const url = `${GEOCODING}?name=${encodeURIComponent(query.trim())}&count=${COUNT}&language=en&format=json`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
		if (!res.ok) return null;
		const body = (await res.json()) as { results?: GeoResult[] };
		const seen = new Set<string>();
		const places = (Array.isArray(body.results) ? body.results : [])
			.map(toPlace)
			.filter((place): place is WeatherPlace => place !== null && !seen.has(place.label) && !!seen.add(place.label));
		cache.delete(key);
		if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
		cache.set(key, { at: now, places });
		return places;
	} catch {
		return null;
	}
}

/** For tests only. */
export function clearPlacesCache() {
	cache.clear();
}
