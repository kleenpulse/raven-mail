import { afterEach, describe, expect, mock, test } from "bun:test";
import { clearPlacesCache, searchPlaces } from "@/lib/weather/places";

describe("searchPlaces", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
		clearPlacesCache();
	});

	const answer = (body: unknown, status = 200) => {
		const fn = mock<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
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
		await searchPlaces("oslo", 60_000);
		expect(fn).toHaveBeenCalledTimes(1);
		await searchPlaces("Oslo", 25 * 60 * 60_000);
		expect(fn).toHaveBeenCalledTimes(2);
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
