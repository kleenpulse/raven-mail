import "server-only";
import { roundCoord } from "@/lib/weather/forecast";

/** A place the user can pick for local weather. */
export type WeatherPlace = { label: string; lat: number; lon: number };

const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const TTL_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 4_000;
const MAX_ENTRIES = 200;
const COUNT = 5;
/** How many results to pull for a bare name when a qualifier will narrow them. */
const WIDE_COUNT = 50;
/** How many "name + qualifier" readings to try ("new york city usa" → 3). */
const MAX_SPLITS = 3;
/** Common ways people write a country that Open-Meteo doesn't spell that way. */
const COUNTRY_ALIASES: Record<string, string> = {
	usa: "us",
	america: "us",
	uk: "gb",
	britain: "gb",
	england: "gb",
	scotland: "gb",
	wales: "gb",
	uae: "ae",
};
/**
 * Postal codes people type for a state or province ("austin tx"), per country
 * code, mapped to Open-Meteo's admin1 name. Per country because codes repeat:
 * WA is Washington in the US and Western Australia in Australia.
 */
const REGION_CODES: Record<string, Record<string, string>> = {
	us: {
		al: "alabama",
		ak: "alaska",
		az: "arizona",
		ar: "arkansas",
		ca: "california",
		co: "colorado",
		ct: "connecticut",
		de: "delaware",
		dc: "district of columbia",
		fl: "florida",
		ga: "georgia",
		hi: "hawaii",
		id: "idaho",
		il: "illinois",
		in: "indiana",
		ia: "iowa",
		ks: "kansas",
		ky: "kentucky",
		la: "louisiana",
		me: "maine",
		md: "maryland",
		ma: "massachusetts",
		mi: "michigan",
		mn: "minnesota",
		ms: "mississippi",
		mo: "missouri",
		mt: "montana",
		ne: "nebraska",
		nv: "nevada",
		nh: "new hampshire",
		nj: "new jersey",
		nm: "new mexico",
		ny: "new york",
		nc: "north carolina",
		nd: "north dakota",
		oh: "ohio",
		ok: "oklahoma",
		or: "oregon",
		pa: "pennsylvania",
		ri: "rhode island",
		sc: "south carolina",
		sd: "south dakota",
		tn: "tennessee",
		tx: "texas",
		ut: "utah",
		vt: "vermont",
		va: "virginia",
		wa: "washington",
		wv: "west virginia",
		wi: "wisconsin",
		wy: "wyoming",
	},
	ca: {
		ab: "alberta",
		bc: "british columbia",
		mb: "manitoba",
		nb: "new brunswick",
		nl: "newfoundland and labrador",
		ns: "nova scotia",
		nt: "northwest territories",
		nu: "nunavut",
		on: "ontario",
		pe: "prince edward island",
		qc: "quebec",
		sk: "saskatchewan",
		yt: "yukon",
	},
	au: {
		act: "australian capital territory",
		nsw: "new south wales",
		nt: "northern territory",
		qld: "queensland",
		sa: "south australia",
		tas: "tasmania",
		vic: "victoria",
		wa: "western australia",
	},
};

const cache = new Map<string, { at: number; places: WeatherPlace[] }>();

type GeoResult = {
	name?: unknown;
	admin1?: unknown;
	admin2?: unknown;
	admin3?: unknown;
	country?: unknown;
	country_code?: unknown;
	latitude?: unknown;
	longitude?: unknown;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Lowercase words without accents, so "São Paulo" and "sao paulo" agree. */
const words = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/**
 * Ways to read the query as a place name plus a qualifier (country, state,
 * region), longest name first: "kaduna nigeria" → kaduna + nigeria, and
 * "new york, usa" → new york + usa. Open-Meteo only understands the name.
 */
function splits(query: string): { name: string; qualifier: string[] }[] {
	const comma = query.indexOf(",");
	if (comma > 0) {
		const qualifier = words(query.slice(comma + 1));
		return qualifier.length ? [{ name: query.slice(0, comma).trim(), qualifier }] : [];
	}
	const parts = query.split(/\s+/);
	const out: { name: string; qualifier: string[] }[] = [];
	for (let cut = parts.length - 1; cut >= 1 && out.length < MAX_SPLITS; cut--) {
		out.push({ name: parts.slice(0, cut).join(" "), qualifier: words(parts.slice(cut).join(" ")) });
	}
	return out;
}

/** Whether every qualifier word names this result's country, region, country code or state code. */
function matches(result: GeoResult, qualifier: string[]) {
	const known = new Set([result.country, result.admin1, result.admin2, result.admin3].flatMap((part) => words(text(part) ?? "")));
	const code = text(result.country_code)?.toLowerCase();
	if (code) known.add(code);
	const region = words(text(result.admin1) ?? "").join(" ");
	const regionCodes = code ? REGION_CODES[code] : undefined;
	return qualifier.every((word) => known.has(word) || known.has(COUNTRY_ALIASES[word] ?? "") || regionCodes?.[word] === region);
}

async function geocode(name: string, count: number): Promise<GeoResult[] | null> {
	const url = `${GEOCODING}?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
		if (!res.ok) return null;
		const body = (await res.json()) as { results?: GeoResult[] };
		return Array.isArray(body.results) ? body.results : [];
	} catch {
		return null;
	}
}

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
 * only with the name the user typed. When the text as typed finds nothing,
 * it's retried as a name plus a country or region ("kaduna nigeria").
 * Cached for a day per query. Null when the lookup failed, so the caller can
 * tell that from "no such place".
 */
export async function searchPlaces(query: string, now = Date.now()): Promise<WeatherPlace[] | null> {
	const typed = query.trim();
	const key = typed.toLowerCase();
	const hit = cache.get(key);
	if (hit && now - hit.at < TTL_MS) return hit.places;

	let results = await geocode(typed, COUNT);
	if (!results) return null;
	if (!results.length) {
		// All readings at once: a slow geocoder then costs one timeout here, not
		// one per reading. The longest name that matches still wins.
		const readings = splits(typed);
		const found = await Promise.all(readings.map(({ name }) => geocode(name, WIDE_COUNT)));
		const match = readings.map(({ qualifier }, i) => found[i]?.filter((result) => matches(result, qualifier)) ?? []).find((list) => list.length);
		if (!match && found.includes(null)) return null;
		results = match ?? [];
	}

	const seen = new Set<string>();
	const places = results
		.map(toPlace)
		.filter((place): place is WeatherPlace => place !== null && !seen.has(place.label) && !!seen.add(place.label))
		.slice(0, COUNT);
	cache.delete(key);
	if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	cache.set(key, { at: now, places });
	return places;
}

/** For tests only. */
export function clearPlacesCache() {
	cache.clear();
}
