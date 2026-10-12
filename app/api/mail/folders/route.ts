import { json, requireApiSession, route } from "@/lib/server/guard";
import { listFolders } from "@/lib/mail/imap";
import { devListFolders, isDevSession } from "@/lib/mail/dev-store";
import { mailError } from "@/lib/api/mail-read";

export const maxDuration = 60;

export const GET = route(async () => {
  const session = await requireApiSession();
  if (isDevSession(session)) return json({ ok: true, data: devListFolders() });
  const data = await listFolders(session).catch(mailError);
  return json({ ok: true, data });
});
