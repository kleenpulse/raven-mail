import { z } from "zod";
import { HttpError, json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { getMessages } from "@/lib/mail/imap";
import { isDevSession } from "@/lib/mail/dev-store";
import { devReaderMessage, folderParam, mailError } from "@/lib/api/mail-read";
import { parseUidSet } from "@/lib/integrations/export/uid-set";
import { planPreload, PRELOAD_MAX_UIDS, type PreloadResult } from "@/lib/mail/preload";
import { createKeyedSemaphore } from "@/lib/server/semaphore";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import type { MailMessage } from "@/lib/mail/types";

export const maxDuration = 60;

const querySchema = z.object({
  folder: folderParam,
  uids: z.string().min(1).max(300),
});

// Preloads are speculative: one per mailbox at a time however many tabs are open,
// so they never hold more than one of the four IMAP connections.
const gate = createKeyedSemaphore(1);
// Every request is an IMAP login; a runaway client must not turn into a login storm.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function devPreload(folder: string, uids: number[]): PreloadResult {
  const found = new Map<number, MailMessage>();
  for (const uid of uids) {
    try {
      found.set(uid, devReaderMessage(folder, String(uid)));
    } catch {
      // Gone: reported as skipped below.
    }
  }
  const { take, tooBig } = planPreload(
    [...found].map(([uid, m]) => ({ uid, size: m.html.length + m.text.length })),
  );
  return {
    messages: take.map((uid) => found.get(uid)!),
    skipped: [...uids.filter((uid) => !found.has(uid)), ...tooBig].map(String),
  };
}

/** Bodies for the list rows in view, so opening one is instant. */
export const GET = route(async (request) => {
  const session = await requireApiSession();
  const query = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  let uids: number[];
  try {
    uids = parseUidSet(query.uids, { max: PRELOAD_MAX_UIDS });
  } catch {
    throw new HttpError(400, "Invalid message ids.", "bad_request");
  }

  if (isDevSession(session)) {
    return json({ ok: true, data: devPreload(query.folder, uids) });
  }

  const key = sessionKey(session);
  if (!limiter.take(key).ok) throw new HttpError(429, "Preloading is cooling down.", "rate_limited");
  const data = await gate
    .run(key, async () =>
      // The list moved on while this waited its turn; don't spend a connection on it.
      request.signal.aborted
        ? { messages: [], skipped: [] }
        : getMessages(session, query.folder, uids, request.signal),
    )
    .catch(mailError);
  return json({ ok: true, data });
});
