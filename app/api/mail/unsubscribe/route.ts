import { z } from "zod";
import { HttpError, json, readJson, requireApiSession, route } from "@/lib/server/guard";
import { getUnsubscribeHeaders } from "@/lib/mail/imap";
import { devGetMessage, isDevSession } from "@/lib/mail/dev-store";
import { folderParam, mailError, uidParam } from "@/lib/api/mail-read";
import { unsubscribeOptions } from "@/lib/mail/headers";
import { oneClickUnsubscribe } from "@/lib/mail/unsubscribe";

export const maxDuration = 30;

const bodySchema = z.object({ folder: folderParam, uid: uidParam });

/**
 * One-click unsubscribe (RFC 8058) for one message. The target comes from the
 * message's own headers, read again here, so a client can't aim the POST.
 */
export const POST = route(async (request) => {
  const session = await requireApiSession();
  const { folder, uid } = await readJson(request, bodySchema);
  const dev = isDevSession(session);
  let headers: Record<string, string>;
  try {
    headers = dev ? devGetMessage(folder, uid).headers : await getUnsubscribeHeaders(session, folder, uid);
  } catch (err) {
    mailError(err);
  }
  const options = unsubscribeOptions(headers);
  if (!options?.oneClick || !options.https) {
    throw new HttpError(400, "This sender has no one-click unsubscribe.", "no_one_click");
  }
  // The dev mailbox's lists live on .example hosts: nothing to call.
  if (!dev) await oneClickUnsubscribe(options.https);
  return json({ ok: true, data: null });
});
