import { z } from "zod";
import { HttpError, json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { getSnapshot } from "@/lib/mail/snapshot";
import { computeOverview } from "@/lib/insights/metrics";
import { isValidTimeZone } from "@/lib/insights/bins";
import { mailError } from "@/lib/api/mail-read";

export const maxDuration = 60;

const querySchema = z.object({
  days: z.enum(["7", "30"]).default("30"),
  tz: z.string().max(64).default("UTC"),
});

export const GET = route(async (request) => {
  const session = await requireApiSession();
  const { days, tz } = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  if (!isValidTimeZone(tz)) throw new HttpError(400, "Unknown time zone.", "bad_request");
  const snapshot = await getSnapshot(session, { days: Number(days) }).catch(mailError);
  const overview = computeOverview(snapshot, { now: Date.now(), tz, self: [session.email] });
  return json({ ok: true, data: overview });
});
