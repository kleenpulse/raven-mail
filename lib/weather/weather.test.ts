import { afterEach, describe, expect, mock, test } from "bun:test";
import { describeSky, formatTemperature, usesFahrenheit } from "@/lib/weather/codes";
import { clearWeatherCache, localWeather, roundCoord } from "@/lib/weather/forecast";

describe("describeSky", () => {
  test("reads WMO codes into a label and an icon kind", () => {
    expect(describeSky(0)).toEqual({ kind: "clear", label: "Clear" });
    expect(describeSky(3)).toEqual({ kind: "cloudy", label: "Overcast" });
    expect(describeSky(63)).toEqual({ kind: "rain", label: "Rain" });
    expect(describeSky(81)?.kind).toBe("rain");
    expect(describeSky(95)?.kind).toBe("storm");
  });

  test("an unknown code gets no label rather than a wrong one", () => {
    expect(describeSky(42)).toBeNull();
  });
});

describe("temperature", () => {
  test("°F where people read it, °C everywhere else", () => {
    expect(usesFahrenheit("en-US")).toBe(true);
    expect(usesFahrenheit("en")).toBe(true); // English maximizes to en-Latn-US
    expect(usesFahrenheit("en-GB")).toBe(false);
    expect(usesFahrenheit("fr-FR")).toBe(false);
    expect(usesFahrenheit("not a locale")).toBe(false);
  });

  test("rounds and converts", () => {
    expect(formatTemperature(12.4, false)).toBe("12°C");
    expect(formatTemperature(0, true)).toBe("32°F");
    expect(formatTemperature(21.7, true)).toBe("71°F");
  });
});

describe("localWeather", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    clearWeatherCache();
  });

  const answer = (body: unknown, status = 200) => {
    const fn = mock(async (_url: string) => new Response(JSON.stringify(body), { status }));
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  };

  test("asks Open-Meteo for the rounded place and caches the answer", async () => {
    const fn = answer({ current: { temperature_2m: 14.2, weather_code: 61, is_day: 0 } });
    const first = await localWeather(6.524379, 3.379206, 0);
    expect(first).toEqual({ code: 61, temperatureC: 14.2, isDay: false });
    expect(fn.mock.calls[0]![0]).toContain("latitude=6.52&longitude=3.38");
    expect(await localWeather(6.5241, 3.3792, 60_000)).toEqual(first);
    expect(fn).toHaveBeenCalledTimes(1);
    await localWeather(6.5241, 3.3792, 16 * 60_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("an outage or a strange body is no weather, not a crash", async () => {
    answer({ error: true, reason: "down" }, 503);
    expect(await localWeather(1, 2, 0)).toBeNull();
    clearWeatherCache();
    answer({ current: { weather_code: "rain" } });
    expect(await localWeather(1, 2, 0)).toBeNull();
  });

  test("rounds to about 1 km", () => {
    expect(roundCoord(51.50735)).toBe(51.51);
    expect(roundCoord(-0.12776)).toBe(-0.13);
  });
});
