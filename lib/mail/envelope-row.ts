import type { EnvelopeRow, Snapshot } from "@/lib/insights/types";
import type { MailMessage } from "@/lib/mail/types";
import { parseDateHeader, parseReferences } from "@/lib/mail/headers";
import { toPreview } from "@/lib/mail/mime";

/** A parsed message as the Overview/Ask snapshot sees it. Pure, so the public landing demo can share it. */
export function toEnvelopeRow(message: MailMessage, folder: EnvelopeRow["folder"]): EnvelopeRow {
  const h = message.headers;
  const dateHeader = parseDateHeader(h.date);
  const calendar = message.attachments.filter((a) => a.contentType === "text/calendar");
  const files = message.attachments.filter((a) => a.contentType !== "text/calendar");
  const autoSubmitted = h["auto-submitted"]?.toLowerCase();
  return {
    id: `${folder}:${message.uid}`,
    folder,
    path: message.folder,
    uid: Number(message.uid),
    date: Date.parse(message.date),
    sentAt: dateHeader?.epoch,
    tzOffsetMin: dateHeader?.offsetMin,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references ?? parseReferences(h.references),
    seen: message.flags.seen,
    flagged: message.flags.flagged,
    answered: message.flags.answered,
    size: message.text.length + files.reduce((sum, a) => sum + a.size, 0),
    hasAttachments: files.length > 0,
    attachmentBytes: files.reduce((sum, a) => sum + a.size, 0),
    hasCalendar: calendar.length > 0,
    listId: h["list-id"],
    listUnsubscribe: h["list-unsubscribe"],
    autoSubmitted: Boolean(autoSubmitted && autoSubmitted !== "no"),
    bulk: /\b(bulk|list|junk)\b/.test(h.precedence?.toLowerCase() ?? ""),
    preview: toPreview(message.text),
  };
}

const FOLDER_MAP: Record<string, EnvelopeRow["folder"]> = { INBOX: "inbox", Sent: "sent" };

/** Snapshot of synthetic mail (dev store, landing demo) — same shape as the IMAP one. */
export function snapshotFromMessages(
  messages: Iterable<MailMessage>,
  { now, days, account, inbox }: { now: number; days: number; account: string; inbox: { unseen: number; total: number } },
): Snapshot {
  const since = now - days * 86_400_000;
  const rows: EnvelopeRow[] = [];
  for (const message of messages) {
    const folder = FOLDER_MAP[message.folder];
    if (!folder) continue;
    const row = toEnvelopeRow(message, folder);
    if (row.date >= since && row.date <= now) rows.push(row);
  }
  const used = rows.reduce((sum, r) => sum + r.size, 0);
  return {
    v: 1,
    account,
    fetchedAt: now,
    days,
    inbox: { path: "INBOX", ...inbox },
    sent: { path: "Sent" },
    // A believable Gmail-sized quota so the storage ring has something to show.
    quota: { usedBytes: 6_200_000_000 + used, limitBytes: 15_000_000_000 },
    rows,
    truncated: false,
  };
}
