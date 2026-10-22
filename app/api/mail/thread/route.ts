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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<MailThread>((resolve) => {
    timer = setTimeout(() => resolve({ messages: [], partial: true }), THREAD_TIMEOUT_MS);
  });
  try {
    const data = await Promise.race([getThread(session, folder, uid), timeout]).catch(mailError);
    return json({ ok: true, data });
  } finally {
    clearTimeout(timer);
  }
});
