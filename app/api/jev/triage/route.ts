import { HttpError, json, requireApiSession, route } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import { getSnapshot } from "@/lib/mail/snapshot";
import { mailError } from "@/lib/api/mail-read";
import { jevFor } from "@/lib/jev/client";
import { jevTriage } from "@/lib/triage/jev";
import type { TriageResult } from "@/lib/mail/types";

export const maxDuration = 60;

const MAX = 60;
const CONCURRENCY = 4;
const WINDOW_MS = 48 * 3_600_000;
const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

// Jev results per message; re-running Deep triage never pays twice for the same email.
const cache = new Map<string, TriageResult>();
function remember(key: string, value: TriageResult) {
  cache.set(key, value);
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
}

export type DeepTriageItem = { folder: string; uid: string; messageId?: string; triage: TriageResult };

export const POST = route(async (request) => {
  const session = await requireApiSession();
  const jev = jevFor(session);
  if (!jev) {
    throw new HttpError(409, "Jev isn’t set up. Add your TypeSafe key in Settings → Account to turn on Deep triage.", "jev_disabled");
  }
  const allowed = limiter.take(sessionKey(session));
  if (!allowed.ok) throw new HttpError(429, "Deep triage is cooling down — try again shortly.", "rate_limited");

  const snapshot = await getSnapshot(session, { days: 30 }).catch(mailError);
  const now = Date.now();
  const candidates = snapshot.rows
    .filter((r) => r.folder === "inbox" && now - r.date <= WINDOW_MS && !r.listId && !r.bulk)
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX);

  const items: DeepTriageItem[] = [];
  let cursor = 0;
  let fresh = 0;
  async function worker() {
    while (cursor < candidates.length && !request.signal.aborted) {
      const row = candidates[cursor++]!;
      const key = `${sessionKey(session)}:${row.messageId ?? `${row.path}:${row.uid}`}`;
      let triage = cache.get(key);
      if (!triage) {
        triage = await jevTriage(
          { subject: row.subject, snippet: row.preview, from: row.from.address },
          { jev, signal: request.signal },
        );
        if (triage.source === "jev") {
          remember(key, triage);
          fresh += 1;
        }
      }
      items.push({ folder: row.path, uid: String(row.uid), messageId: row.messageId, triage });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.info(`[jev/triage] ${items.length} emails, ${fresh} new Jev calls`);

  return json({ ok: true, data: { items, triagedAt: new Date(now).toISOString() } });
});
