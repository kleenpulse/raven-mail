import "server-only";
import type { MailSession } from "@/lib/session";
import type { EnvelopeRow } from "@/lib/insights/types";
import { searchTerms, toFolders, withClient } from "@/lib/mail/imap";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import { envelopeRowFrom, SNAPSHOT_QUERY } from "@/lib/mail/snapshot";
import { fetchPreviews } from "@/lib/mail/preview";
import { isDevSession } from "@/lib/mail/dev-store";
import { sessionKey } from "@/lib/server/session-key";

/** Server-side TEXT search across the whole Inbox — reaches past the 30-day window. */
export async function searchMailbox(
  session: MailSession,
  keywords: string[],
  { limit = 60 }: { limit?: number } = {},
): Promise<EnvelopeRow[]> {
  if (isDevSession(session) || keywords.length === 0) return [];
  return withClient(session, async (client) => {
    const folders = toFolders(await client.list({ listOnly: true }));
    const inboxPath = resolveSpecialFolder(folders, "\\Inbox") ?? "INBOX";
    const lock = await client.getMailboxLock(inboxPath, { readOnly: true });
    try {
      const found = await searchTerms(client, keywords, (t) => ({ text: t }));
      const uids = found.sort((a, b) => b - a).slice(0, limit);
      if (uids.length === 0) return [];
      const fetched = await client.fetchAll(uids, SNAPSHOT_QUERY, { uid: true });
      const rows = fetched.map((m) => envelopeRowFrom(m, "inbox", inboxPath));
      const scope = `${sessionKey(session)}:${inboxPath}:${client.mailbox ? String(client.mailbox.uidValidity) : "0"}`;
      const previews = await fetchPreviews(client, scope, fetched).catch(() => new Map<number, string>());
      for (const row of rows) {
        const preview = previews.get(row.uid);
        if (preview) row.preview = preview;
      }
      return rows;
    } finally {
      lock.release();
    }
  });
}
