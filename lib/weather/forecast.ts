import "server-only";

export type LocalWeather = { code: number; temperatureC: number; isDay: boolean };
/** What `/api/weather` answers. `located` is false when the server had no place to look up. */
export type WeatherReply = { located: boolean; place: string | null; weather: LocalWeather | null };

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 4_000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; weather: LocalWeather | null }>();

/** About 1 km: enough for weather, and it keeps a precise position out of logs and caches. */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Current weather at a place, from Open-Meteo (free, no key). Called from the
 * server, so the user's IP never reaches a third party. Cached for 15 minutes
 * per rounded place; a failure is cached too, briefly, as null.
 */
export async function localWeather(lat: number, lon: number, now = Date.now()): Promise<LocalWeather | null> {
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  const key = `${la},${lo}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < (hit.weather ? TTL_MS : TTL_MS / 5)) return hit.weather;

  const url = `${OPEN_METEO}?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code,is_day`;
  let weather: LocalWeather | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as { current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown } };
      const c = body.current;
      if (c && typeof c.temperature_2m === "number" && typeof c.weather_code === "number") {
        weather = { code: c.weather_code, temperatureC: c.temperature_2m, isDay: c.is_day !== 0 };
      }
    }
  } catch {
    // Timeouts and outages: no weather is better than a stalled Overview.
  }

  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now, weather });
  return weather;
}

/** For tests only. */
export function clearWeatherCache() {
  cache.clear();
}
