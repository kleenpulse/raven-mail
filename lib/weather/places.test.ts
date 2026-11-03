import { afterEach, describe, expect, mock, test } from "bun:test";
import { clearPlacesCache, searchPlaces } from "@/lib/weather/places";

describe("searchPlaces", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
		clearPlacesCache();
	});

	const answer = (body: unknown, status = 200) => {
		const fn = mock<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
		globalThis.fetch = fn as unknown as typeof fetch;
		return fn;
	};

	test("asks Open-Meteo for the typed name and labels the matches", async () => {
		const fn = answer({
			results: [
				{ name: "Lagos", admin1: "Lagos", country: "Nigeria", latitude: 6.45407, longitude: 3.39467 },
				{ name: "Lagos", admin1: "Faro", country: "Portugal", latitude: 37.10202, longitude: -8.67422 },
			],
		});
		expect(await searchPlaces("  Lagos ", 0)).toEqual([
			{ label: "Lagos, Nigeria", lat: 6.45, lon: 3.39 },
			{ label: "Lagos, Faro, Portugal", lat: 37.1, lon: -8.67 },
		]);
		const url = new URL(fn.mock.calls[0]![0]);
		expect(url.origin + url.pathname).toBe("https://geocoding-api.open-meteo.com/v1/search");
		expect(url.searchParams.get("name")).toBe("Lagos");
		expect(url.searchParams.get("count")).toBe("5");
	});

	test("caches per name for a day, whatever the casing", async () => {
		const fn = answer({ results: [{ name: "Oslo", country: "Norway", latitude: 59.91, longitude: 10.75 }] });
		await searchPlaces("Oslo", 0);
		await searchPlaces("oslo", 24 * 60 * 60_000 - 1);
		expect(fn).toHaveBeenCalledTimes(1);
		await searchPlaces("Oslo", 24 * 60 * 60_000);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	test("keeps the 200 most recently fetched names", async () => {
		const fn = answer({ results: [{ name: "Oslo", country: "Norway", latitude: 59.91, longitude: 10.75 }] });
		for (let i = 0; i < 199; i++) await searchPlaces(`place ${i}`, 0);
		const day = 24 * 60 * 60_000;
		await searchPlaces("place 0", day); // expired, fetched again: now the newest
		await searchPlaces("place 199", day); // the 200th
		await searchPlaces("place 200", day); // full: drops "place 1", the oldest
		fn.mockClear();
		await searchPlaces("place 0", day);
		await searchPlaces("place 2", 1);
		expect(fn).not.toHaveBeenCalled();
		await searchPlaces("place 1", 1);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	test("gives each lookup a timeout and keeps the answer tidy", async () => {
		const many = Array.from({ length: 7 }, (_, i) => ({ name: `Springfield ${i}`, country: "United States", latitude: i, longitude: i }));
		const fn = answer({ results: many });
		expect(await searchPlaces("Springfield", 0)).toHaveLength(5);
		expect(fn.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
		answer({ results: [{ name: "Llanfair".repeat(12), country: "United Kingdom", latitude: 53.2, longitude: -4.2 }] });
		expect((await searchPlaces("Llanfair", 0))![0]!.label).toHaveLength(80);
		answer({ results: "not a list" });
		expect(await searchPlaces("Oops", 0)).toEqual([]);
	});

	test("no matches is an empty list; skips broken rows and duplicates", async () => {
		answer({});
		expect(await searchPlaces("Nowhere", 0)).toEqual([]);
		answer({
			results: [
				{ name: "Paris", country: "France", latitude: 48.85, longitude: 2.35 },
				{ name: "Paris", country: "France", latitude: 48.86, longitude: 2.34 },
				{ name: "", country: "France", latitude: 1, longitude: 1 },
				{ name: "Broken", latitude: "1", longitude: 1 },
			],
		});
		expect(await searchPlaces("Paris", 0)).toEqual([{ label: "Paris, France", lat: 48.85, lon: 2.35 }]);
	});

	/** Answers by the `name` asked for; unknown names find nothing. */
	const answerByName = (byName: Record<string, unknown[]>) => {
		const fn = mock<(url: string) => Promise<Response>>(async (url) => {
			const name = new URL(url).searchParams.get("name") ?? "";
			return new Response(JSON.stringify(byName[name] ? { results: byName[name] } : {}));
		});
		globalThis.fetch = fn as unknown as typeof fetch;
		return fn;
	};

	const kaduna = [
		{ name: "Kaduna", admin1: "Kaduna State", country: "Nigeria", country_code: "NG", latitude: 10.52641, longitude: 7.43879 },
		{ name: "Kaduna", admin1: "Punjab", country: "Pakistan", country_code: "PK", latitude: 30.1, longitude: 71.2 },
	];

	test("a city followed by its country is read as name plus qualifier", async () => {
		const fn = answerByName({ Kaduna: kaduna, kaduna });
		expect(await searchPlaces("kaduna nigeria", 0)).toEqual([{ label: "Kaduna, Kaduna State, Nigeria", lat: 10.53, lon: 7.44 }]);
		const names = fn.mock.calls.map(([url]) => new URL(url).searchParams.get("name"));
		expect(names).toEqual(["kaduna nigeria", "kaduna"]);
		expect(new URL(fn.mock.calls[1]![0]).searchParams.get("count")).toBe("50");
	});

	test("qualifiers can be a state, a country code or a common nickname, with or without a comma", async () => {
		const newYork = [{ name: "New York", admin1: "New York", country: "United States", country_code: "US", latitude: 40.71, longitude: -74.01 }];
		answerByName({ "new york": newYork, kaduna });
		expect(await searchPlaces("new york, usa", 0)).toHaveLength(1);
		expect(await searchPlaces("new york us", 0)).toHaveLength(1);
		expect(await searchPlaces("new york united states", 0)).toHaveLength(1);
		expect(await searchPlaces("kaduna kaduna state", 0)).toEqual([{ label: "Kaduna, Kaduna State, Nigeria", lat: 10.53, lon: 7.44 }]);
		expect(await searchPlaces("kaduna france", 0)).toEqual([]);
	});

	test("qualifiers ignore accents, and long queries try at most 3 readings", async () => {
		const montreal = [{ name: "Montreal", admin1: "Quebec", country: "Canada", country_code: "CA", latitude: 45.51, longitude: -73.59 }];
		const springfield = [{ name: "Springfield", admin1: "Illinois", admin2: "Sangamon County", country: "United States", country_code: "US", latitude: 39.8, longitude: -89.64 }];
		answerByName({ montreal, springfield });
		expect(await searchPlaces("montreal, Québec", 0)).toHaveLength(1);
		expect(await searchPlaces("springfield sangamon", 0)).toHaveLength(1);
		const fn = answerByName({});
		expect(await searchPlaces("a b c d e", 0)).toEqual([]);
		expect(fn).toHaveBeenCalledTimes(4);
	});

	test("state and province codes count only in their own country", async () => {
		const austin = [
			{ name: "Austin", admin1: "Texas", country: "United States", country_code: "US", latitude: 30.27, longitude: -97.74 },
			{ name: "Austin", admin1: "Minnesota", country: "United States", country_code: "US", latitude: 43.67, longitude: -92.97 },
		];
		const sydney = [
			{ name: "Sydney", admin1: "New South Wales", country: "Australia", country_code: "AU", latitude: -33.87, longitude: 151.21 },
			{ name: "Sydney", admin1: "Nova Scotia", country: "Canada", country_code: "CA", latitude: 46.14, longitude: -60.18 },
		];
		const vancouver = [
			{ name: "Vancouver", admin1: "British Columbia", country: "Canada", country_code: "CA", latitude: 49.25, longitude: -123.12 },
			{ name: "Vancouver", admin1: "Washington", country: "United States", country_code: "US", latitude: 45.64, longitude: -122.66 },
		];
		const washington = [
			{ name: "Washington D.C.", admin1: "District of Columbia", country: "United States", country_code: "US", latitude: 38.9, longitude: -77.04 },
			{ name: "Washington", admin1: "Pennsylvania", country: "United States", country_code: "US", latitude: 40.17, longitude: -80.25 },
		];
		const perth = [
			{ name: "Perth", admin1: "Western Australia", country: "Australia", country_code: "AU", latitude: -31.95, longitude: 115.86 },
			{ name: "Perth", admin1: "Scotland", country: "United Kingdom", country_code: "GB", latitude: 56.4, longitude: -3.43 },
		];
		const darwin = [
			{ name: "Darwin", admin1: "Northern Territory", country: "Australia", country_code: "AU", latitude: -12.46, longitude: 130.84 },
			{ name: "Darwin", admin1: "Northwest Territories", country: "Canada", country_code: "CA", latitude: 62.45, longitude: -114.37 },
		];
		answerByName({ Austin: austin, austin, sydney, vancouver, washington, perth, darwin });
		// WA and NT mean different places in different countries.
		expect(await searchPlaces("perth wa", 0)).toEqual([{ label: "Perth, Western Australia, Australia", lat: -31.95, lon: 115.86 }]);
		expect((await searchPlaces("darwin nt", 0))!.map((place) => place.label)).toEqual([
			"Darwin, Northern Territory, Australia",
			"Darwin, Northwest Territories, Canada",
		]);
		expect(await searchPlaces("washington dc", 0)).toEqual([{ label: "Washington D.C., District of Columbia, United States", lat: 38.9, lon: -77.04 }]);
		expect(await searchPlaces("vancouver wa", 0)).toEqual([{ label: "Vancouver, Washington, United States", lat: 45.64, lon: -122.66 }]);
		expect(await searchPlaces("vancouver bc", 0)).toEqual([{ label: "Vancouver, British Columbia, Canada", lat: 49.25, lon: -123.12 }]);
		expect(await searchPlaces("Austin, TX", 0)).toEqual([{ label: "Austin, Texas, United States", lat: 30.27, lon: -97.74 }]);
		expect(await searchPlaces("austin mn us", 0)).toEqual([{ label: "Austin, Minnesota, United States", lat: 43.67, lon: -92.97 }]);
		expect(await searchPlaces("sydney nsw", 0)).toEqual([{ label: "Sydney, New South Wales, Australia", lat: -33.87, lon: 151.21 }]);
		expect(await searchPlaces("sydney ns", 0)).toEqual([{ label: "Sydney, Nova Scotia, Canada", lat: 46.14, lon: -60.18 }]);
		expect(await searchPlaces("austin nsw", 0)).toEqual([]);
	});

	test("tries every reading at once, and the longest matching name still wins", async () => {
		const nyc = [{ name: "New York City", admin1: "New York", country: "United States", country_code: "US", latitude: 40.71, longitude: -74.01 }];
		// "new york" + "city usa" matches too, so the order is what picks.
		const ny = [{ name: "New York", admin1: "New York", admin2: "New York City", country: "United States", country_code: "US", latitude: 40.7, longitude: -74 }];
		const pending: Record<string, () => void> = {};
		const fn = mock<(url: string) => Promise<Response>>((url) => {
			const name = new URL(url).searchParams.get("name") ?? "";
			const results = { "new york city": nyc, "new york": ny, new: [] }[name];
			if (!results) return Promise.resolve(new Response("{}"));
			return new Promise((resolve) => {
				pending[name] = () => resolve(new Response(JSON.stringify({ results })));
			});
		});
		globalThis.fetch = fn as unknown as typeof fetch;
		const search = searchPlaces("new york city usa", 0);
		for (let i = 0; i < 10 && Object.keys(pending).length < 3; i++) await Bun.sleep(1);
		expect(fn.mock.calls.map(([url]) => new URL(url).searchParams.get("name"))).toEqual(["new york city usa", "new york city", "new york", "new"]);
		pending["new york"]!();
		pending.new!();
		pending["new york city"]!();
		expect(await search).toEqual([{ label: "New York City, New York, United States", lat: 40.71, lon: -74.01 }]);
	});

	test("a failed reading doesn't hide another reading's match", async () => {
		globalThis.fetch = mock(async (url: string) => {
			const name = new URL(url).searchParams.get("name");
			if (name === "kaduna kaduna") throw new TypeError("offline");
			return new Response(JSON.stringify(name === "kaduna" ? { results: kaduna } : {}));
		}) as unknown as typeof fetch;
		expect(await searchPlaces("kaduna kaduna nigeria", 0)).toEqual([{ label: "Kaduna, Kaduna State, Nigeria", lat: 10.53, lon: 7.44 }]);
	});

	test("a failed fallback lookup with nothing found is null", async () => {
		let calls = 0;
		globalThis.fetch = mock(async () => {
			if (calls++ === 0) return new Response("{}");
			throw new TypeError("offline");
		}) as unknown as typeof fetch;
		expect(await searchPlaces("kaduna nigeria", 0)).toBeNull();
	});

	test("a failed lookup is null and isn't cached", async () => {
		const fn = answer({ error: true }, 500);
		expect(await searchPlaces("Rome", 0)).toBeNull();
		globalThis.fetch = mock(async () => {
			throw new TypeError("offline");
		}) as unknown as typeof fetch;
		expect(await searchPlaces("Rome", 0)).toBeNull();
		answer({ results: [{ name: "Rome", country: "Italy", latitude: 41.89, longitude: 12.48 }] });
		expect(await searchPlaces("Rome", 0)).toHaveLength(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
