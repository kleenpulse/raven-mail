import { z } from "zod";
import { json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { getThread } from "@/lib/mail/imap";
import { devGetThread, isDevSession } from "@/lib/mail/dev-store";
import { folderParam, mailError, uidParam } from "@/lib/api/mail-read";
import type { MailThread } from "@/lib/mail/types";

export const maxDuration = 60;

// A header SEARCH on a big unindexed folder can crawl; the reader still has the message itself.
const THREAD_TIMEOUT_MS = 8_000;

const querySchema = z.object({ folder: folderParam, uid: uidParam });

/** The conversation around one message: its folder plus Sent, oldest first. */
export const GET = route(async (request) => {
  const session = await requireApiSession();
  const { folder, uid } = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  if (isDevSession(session)) {
    try {
      return json({ ok: true, data: devGetThread(folder, uid) });
    } catch (err) {
      mailError(err);
    }
  }
  // Timing out or the reader moving on closes the IMAP connection, which frees its slot.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(THREAD_TIMEOUT_MS)]);
  const partial = new Promise<MailThread>((resolve) => {
    signal.addEventListener("abort", () => resolve({ messages: [], partial: true }), { once: true });
  });
  const data = await Promise.race([
    getThread(session, folder, uid, signal).catch((err) => (signal.aborted ? partial : mailError(err))),
    partial,
  ]);
  return json({ ok: true, data });
});
