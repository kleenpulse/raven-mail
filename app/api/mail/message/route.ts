import { z } from "zod";
import { json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { findUidByMessageId, getMessage } from "@/lib/mail/imap";
import { isDevSession } from "@/lib/mail/dev-store";
import { devReaderMessage, folderParam, mailError, uidParam } from "@/lib/api/mail-read";

export const maxDuration = 60;

const querySchema = z.object({
  folder: folderParam,
  uid: uidParam,
  mid: z.string().max(998).regex(/^<[^<>\s]+>$/, "Invalid Message-ID.").optional(),
});

export const GET = route(async (request) => {
  const session = await requireApiSession();
  const { folder, uid, mid } = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  if (isDevSession(session)) {
    try {
      return json({ ok: true, data: devReaderMessage(folder, uid) });
    } catch (err) {
      mailError(err);
    }
  }
  try {
    return json({ ok: true, data: await getMessage(session, folder, uid) });
  } catch (err) {
    // UIDs can be reassigned (UIDVALIDITY change); fall back to the Message-ID.
    if (mid && err instanceof Error && /not found/i.test(err.message)) {
      const found = await findUidByMessageId(session, folder, mid).catch(() => null);
      if (found && found !== uid) {
        const data = await getMessage(session, folder, found).catch(mailError);
        return json({ ok: true, data });
      }
    }
    mailError(err);
  }
});
