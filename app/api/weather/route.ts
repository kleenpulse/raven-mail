import { z } from "zod";
import { json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { localWeather } from "@/lib/weather/forecast";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

function headerCoord(request: Request, name: string, limit: number): number | null {
  const raw = request.headers.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function headerCity(request: Request): string | null {
  const raw = request.headers.get("x-vercel-ip-city");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).slice(0, 80);
  } catch {
    return null;
  }
}

/**
 * Local weather for the Overview. The place comes from the browser (lat/lon,
 * when the user shared it), else from Vercel's IP location headers. With
 * neither, `located` is false and the client can offer to ask.
 */
export const GET = route(async (request) => {
  await requireApiSession();
  const query = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  const fromBrowser = query.lat !== undefined && query.lon !== undefined;
  const lat = fromBrowser ? query.lat! : headerCoord(request, "x-vercel-ip-latitude", 90);
  const lon = fromBrowser ? query.lon! : headerCoord(request, "x-vercel-ip-longitude", 180);
  if (lat === null || lon === null) return json({ ok: true, data: { located: false, place: null, weather: null } });
  const place = fromBrowser ? null : headerCity(request);
  return json({ ok: true, data: { located: true, place, weather: await localWeather(lat, lon) } });
});
