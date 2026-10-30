/** What the sky is doing, coarse enough to pick an icon. */
export type SkyKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm" | "hail";

export type Sky = { kind: SkyKind; label: string };

/**
 * WMO weather interpretation codes, as Open-Meteo returns them
 * (https://open-meteo.com/en/docs, "WMO Weather interpretation codes").
 */
const CODES: Record<number, Sky> = {
  0: { kind: "clear", label: "Clear" },
  1: { kind: "partly", label: "Mostly clear" },
  2: { kind: "partly", label: "Partly cloudy" },
  3: { kind: "cloudy", label: "Overcast" },
  45: { kind: "fog", label: "Fog" },
  48: { kind: "fog", label: "Freezing fog" },
  51: { kind: "drizzle", label: "Light drizzle" },
  53: { kind: "drizzle", label: "Drizzle" },
  55: { kind: "drizzle", label: "Heavy drizzle" },
  56: { kind: "drizzle", label: "Freezing drizzle" },
  57: { kind: "drizzle", label: "Freezing drizzle" },
  61: { kind: "rain", label: "Light rain" },
  63: { kind: "rain", label: "Rain" },
  65: { kind: "rain", label: "Heavy rain" },
  66: { kind: "rain", label: "Freezing rain" },
  67: { kind: "rain", label: "Freezing rain" },
  71: { kind: "snow", label: "Light snow" },
  73: { kind: "snow", label: "Snow" },
  75: { kind: "snow", label: "Heavy snow" },
  77: { kind: "snow", label: "Snow grains" },
  80: { kind: "rain", label: "Light showers" },
  81: { kind: "rain", label: "Showers" },
  82: { kind: "rain", label: "Heavy showers" },
  85: { kind: "snow", label: "Snow showers" },
  86: { kind: "snow", label: "Heavy snow showers" },
  95: { kind: "storm", label: "Thunderstorm" },
  96: { kind: "hail", label: "Thunderstorm with hail" },
  99: { kind: "hail", label: "Thunderstorm with hail" },
};

/** An unknown code says nothing, so it gets no label rather than a wrong one. */
export function describeSky(code: number): Sky | null {
  return CODES[code] ?? null;
}

/** Where people read °F: the US and a few others. Everyone else gets °C. */
const FAHRENHEIT_REGIONS = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"]);

export function usesFahrenheit(locale: string): boolean {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region ? FAHRENHEIT_REGIONS.has(region) : false;
  } catch {
    return false;
  }
}

export function formatTemperature(celsius: number, fahrenheit: boolean): string {
  return fahrenheit ? `${Math.round((celsius * 9) / 5 + 32)}°F` : `${Math.round(celsius)}°C`;
}
