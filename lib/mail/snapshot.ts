import "server-only";
import type { FetchMessageObject, FetchQueryObject } from "imapflow";
import type { MailSession } from "@/lib/session";
import type { EnvelopeRow, Snapshot } from "@/lib/insights/types";
import { toFolders, withClient } from "@/lib/mail/imap";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import { attachmentBytes, hasAttachments, hasCalendarInvite } from "@/lib/mail/mime";
import { parseDateHeader, parseHeaderBlock, parseReferences } from "@/lib/mail/headers";
import { fetchPreviews } from "@/lib/mail/preview";
import { isDevSession } from "@/lib/mail/dev-store";
import { devSnapshot } from "@/lib/mail/dev-snapshot";
import { sessionKey } from "@/lib/server/session-key";
import { createTtlCache } from "@/lib/server/cache";

export const SNAPSHOT_CAP = 1500;
const PREVIEW_COUNT = 15;
const SENT_PREVIEW_COUNT = 30;

export const SNAPSHOT_QUERY: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  bodyStructure: true,
  threadId: true,
  headers: ["list-id", "list-unsubscribe", "auto-submitted", "precedence", "references", "date"],
};

// Shared by /api/overview and Ask Jev; parallel callers share one in-flight IMAP pass.
const snapshots = createTtlCache<Snapshot>({ ttlMs: 90_000, maxEntries: 20 });

export function invalidateSnapshot(session: MailSession): void {
  const key = sessionKey(session);
  for (const days of [7, 30]) snapshots.invalidate(`${key}:${days}`);
}

export async function getSnapshot(session: MailSession, { days = 30 }: { days?: number } = {}): Promise<Snapshot> {
  if (isDevSession(session)) return devSnapshot({ days, account: session.email });
  return snapshots.get(`${sessionKey(session)}:${days}`, () => fetchSnapshot(session, days));
}

export function envelopeRowFrom(msg: FetchMessageObject, folder: EnvelopeRow["folder"], path: string): EnvelopeRow {
  const envelope = msg.envelope;
  const headers = parseHeaderBlock(msg.headers);
  const dateHeader = parseDateHeader(headers.get("date"));
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  const precedence = headers.get("precedence")?.toLowerCase() ?? "";
  const from = envelope?.from?.[0];
  const addr = (list: { name?: string; address?: string }[] | undefined) =>
    (list ?? []).filter((a) => a.address).map((a) => ({ name: a.name || undefined, address: a.address! }));
  const arrival = msg.internalDate ? new Date(msg.internalDate).getTime() : (dateHeader?.epoch ?? Date.now());

  return {
    id: `${folder}:${msg.uid}`,
    folder,
    path,
    uid: msg.uid,
    date: arrival,
    sentAt: dateHeader?.epoch,
    tzOffsetMin: dateHeader?.offsetMin,
    from: { name: from?.name || undefined, address: from?.address ?? "" },
    to: addr(envelope?.to),
    cc: addr(envelope?.cc),
    subject: envelope?.subject || "(no subject)",
    messageId: envelope?.messageId,
    inReplyTo: envelope?.inReplyTo,
    references: parseReferences(headers.get("references")),
    threadId: msg.threadId,
    seen: msg.flags?.has("\\Seen") ?? false,
    flagged: msg.flags?.has("\\Flagged") ?? false,
    answered: msg.flags?.has("\\Answered") ?? false,
    size: msg.size ?? 0,
    hasAttachments: hasAttachments(msg.bodyStructure),
    attachmentBytes: attachmentBytes(msg.bodyStructure),
    hasCalendar: hasCalendarInvite(msg.bodyStructure),
    listId: headers.get("list-id"),
    listUnsubscribe: headers.get("list-unsubscribe"),
    autoSubmitted: Boolean(autoSubmitted && autoSubmitted !== "no"),
    bulk: /\b(bulk|list|junk)\b/.test(precedence),
  };
}

async function fetchSnapshot(session: MailSession, days: number): Promise<Snapshot> {
  const now = Date.now();
  const since = new Date(now - days * 86_400_000);

  return withClient(session, async (client) => {
    const folders = toFolders(await client.list({ listOnly: true }));
    const inboxPath = resolveSpecialFolder(folders, "\\Inbox") ?? "INBOX";
    const sentPath = resolveSpecialFolder(folders, "\\Sent");

    const status = await client.status(inboxPath, { messages: true, unseen: true }).catch(() => null);
    const quotaRes = await client.getQuota(inboxPath).catch(() => false as const);
    const quota =
      quotaRes && quotaRes.storage?.limit
        ? { usedBytes: quotaRes.storage.used ?? 0, limitBytes: quotaRes.storage.limit }
        : undefined;

    const rows: EnvelopeRow[] = [];
    let truncated = false;
    const targets: [EnvelopeRow["folder"], string | null][] = [
      ["inbox", inboxPath],
      ["sent", sentPath],
    ];

    for (const [folder, path] of targets) {
      if (!path) continue;
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const found = await client.search({ since }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a);
        if (uids.length > SNAPSHOT_CAP) truncated = true;
        const page = uids.slice(0, SNAPSHOT_CAP);
        if (page.length === 0) continue;
        const fetched = await client.fetchAll(page, SNAPSHOT_QUERY, { uid: true });
        const seen = new Set<string>();
        const batch: EnvelopeRow[] = [];
        for (const msg of fetched) {
          // Gmail can list one message twice via labels; keep the first copy.
          const dedupeKey = msg.emailId ?? msg.envelope?.messageId;
          if (dedupeKey) {
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
          }
          batch.push(envelopeRowFrom(msg, folder, path));
        }

        // Previews feed the Daily Brief (newest human mail) and the "expects a reply?"
        // check on recent sends — a couple of grouped partial FETCHes, not full sources.
        const wanted = new Set(
          batch
            .filter((r) => folder === "sent" || (!r.listId && !r.autoSubmitted && !r.bulk))
            .sort((a, b) => b.uid - a.uid)
            .slice(0, folder === "sent" ? SENT_PREVIEW_COUNT : PREVIEW_COUNT)
            .map((r) => r.uid),
        );
        const scope = `${sessionKey(session)}:${path}:${client.mailbox ? String(client.mailbox.uidValidity) : "0"}`;
        const previews = await fetchPreviews(
          client,
          scope,
          fetched.filter((m) => wanted.has(m.uid)),
        ).catch(() => new Map<number, string>());
        for (const row of batch) {
          const preview = previews.get(row.uid);
          if (preview) row.preview = preview;
        }
        rows.push(...batch);
      } finally {
        lock.release();
      }
    }

    return {
      v: 1,
      account: session.email,
      fetchedAt: now,
      days,
      inbox: { path: inboxPath, unseen: status?.unseen ?? 0, total: status?.messages ?? 0 },
      sent: { path: sentPath },
      quota,
      rows,
      truncated,
    };
  });
}
