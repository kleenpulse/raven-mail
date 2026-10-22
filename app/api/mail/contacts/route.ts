import { json, requireApiSession, route } from "@/lib/server/guard";
import { getSnapshot } from "@/lib/mail/snapshot";
import { rankContacts } from "@/lib/mail/contacts";
import { mailError } from "@/lib/api/mail-read";

export const maxDuration = 60;

/** To/Cc/Bcc suggestions from the last 30 days of mail; the snapshot is shared with the Overview. */
export const GET = route(async () => {
  const session = await requireApiSession();
  const snapshot = await getSnapshot(session, { days: 30 }).catch(mailError);
  return json({ ok: true, data: rankContacts(snapshot.rows, { self: [session.email], now: Date.now() }) });
});
