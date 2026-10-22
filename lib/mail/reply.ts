import { htmlToText } from "@/lib/mail/mime";
import { formatAddress } from "@/lib/format";
import type { ComposeDraft, MailAddress, MailMessage } from "@/lib/mail/types";

export type ReplyMode = "reply" | "replyAll" | "forward";

const QUOTE_LIMIT = 20_000;

function uniqueAddresses(list: MailAddress[], exclude: Set<string>): MailAddress[] {
  const seen = new Set(exclude);
  const out: MailAddress[] = [];
  for (const a of list) {
    const key = a.address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function prefixSubject(subject: string, mode: ReplyMode): string {
  const clean = subject.trim() || "(no subject)";
  if (mode === "forward") return /^(fwd?|fw):/i.test(clean) ? clean : `Fwd: ${clean}`;
  return /^(re|aw|sv|antw):/i.test(clean) ? clean : `Re: ${clean}`;
}

function bodyText(message: MailMessage): string {
  const text = message.text.trim() ? message.text : htmlToText(message.html);
  return text.replace(/\r\n/g, "\n").trim().slice(0, QUOTE_LIMIT);
}

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function buildReplyDraft(
  message: MailMessage,
  mode: ReplyMode,
  accountEmail: string,
): Partial<ComposeDraft> {
  const self = accountEmail.trim().toLowerCase();
  const sender = message.from.name || message.from.address;
  const subject = prefixSubject(message.subject, mode);

  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ----------",
      `From: ${formatAddress(message.from)}`,
      `Date: ${when(message.date)}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.map(formatAddress).join(", ")}`,
    ].join("\n");
    return { to: "", subject, text: "", quote: { kind: "forward", header, body: bodyText(message) } };
  }

  const { to, cc } = replyRecipients(message, mode, self);
  const references = [...new Set([...(message.references ?? []), message.messageId].filter(Boolean))] as string[];

  return {
    to: to.map(formatAddress).join(", "),
    cc: cc.map(formatAddress).join(", "),
    subject,
    text: "",
    quote: { kind: "reply", header: `On ${when(message.date)}, ${sender} wrote:`, body: bodyText(message) },
    inReplyTo: message.messageId,
    references,
    source: { folder: message.folder, uid: message.uid },
  };
}

// Automated senders never read replies; reply-all leaves them out (unless they're the one you're answering).
const AUTOMATED = /^(?:no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?|postmaster)(?:[+.-][^@]*)?@/i;
// Addresses that fan out to many people — answering the group is usually the point.
const GROUP = /^(?:all|everyone|team|staff|group|list|announce|dev|eng|ops|support|hello|info)(?:[+.-][^@]*)?@/i;

const key = (a: MailAddress) => a.address.trim().toLowerCase();

function replyRecipients(
  message: MailMessage,
  mode: "reply" | "replyAll",
  self: string,
): { to: MailAddress[]; cc: MailAddress[] } {
  // Replying to your own sent message goes back to its recipients, not to you.
  const fromSelf = key(message.from) === self;
  const primary = fromSelf ? message.to : [message.replyTo ?? message.from];
  const notSelf = (a: MailAddress) => key(a) !== self;
  if (mode === "reply") return { to: uniqueAddresses(primary, new Set()).filter(notSelf), cc: [] };

  const primaryKeys = new Set(primary.map(key));
  const human = (a: MailAddress) => primaryKeys.has(key(a)) || !AUTOMATED.test(a.address.trim());
  const to = uniqueAddresses([...primary, ...message.to], new Set()).filter((a) => notSelf(a) && human(a));
  const cc = uniqueAddresses(message.cc, new Set([self, ...to.map(key)])).filter(human);
  return { to, cc };
}

export type ReplyOptions = {
  /** People reply-all adds on top of a plain reply; empty = reply-all would change nothing. */
  extra: MailAddress[];
  /** Everyone reply-all reaches (for the button's count and tooltip). */
  everyone: MailAddress[];
  /** Group address or you were only Cc'd — the conversation belongs to the room, so reply-all leads. */
  preferReplyAll: boolean;
};

export function replyOptions(message: MailMessage, accountEmail: string): ReplyOptions {
  const self = accountEmail.trim().toLowerCase();
  const single = replyRecipients(message, "reply", self);
  const all = replyRecipients(message, "replyAll", self);
  const reached = new Set([...single.to, ...single.cc].map(key));
  const everyone = [...all.to, ...all.cc];
  const extra = everyone.filter((a) => !reached.has(key(a)));
  const fromSelf = key(message.from) === self;
  const onlyCc = !fromSelf && !message.to.some((a) => key(a) === self) && message.cc.some((a) => key(a) === self);
  const group = Boolean(message.headers["list-id"]) || everyone.some((a) => GROUP.test(a.address.trim()));
  return { extra, everyone, preferReplyAll: extra.length > 0 && (group || onlyCc) };
}

/**
 * The body that actually leaves: what you wrote, then the quoted original
 * ("> " lines for replies, a header block for forwards). The composer keeps
 * the two apart so the quote never clutters the text box.
 */
export function draftBody(draft: Pick<ComposeDraft, "text" | "quote">): string {
  const lead = draft.text.replace(/\s+$/, "");
  if (!draft.quote) return lead;
  const { kind, header, body } = draft.quote;
  const block =
    kind === "reply"
      ? `${header}\n${body
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n")}`
      : `${header}\n\n${body}`;
  return lead ? `${lead}\n\n${block}` : block;
}

/** A saved draft back into compose fields, so reopening it carries on where it was left. */
export function draftFromMessage(message: MailMessage): Partial<ComposeDraft> {
  const list = (as: MailAddress[]) => as.map(formatAddress).join(", ");
  const text = message.text.trim() ? message.text : htmlToText(message.html).trim();
  return {
    to: list(message.to),
    cc: list(message.cc),
    bcc: list(message.bcc),
    // Saving fills an empty subject with this placeholder; don't hand it back as typed text.
    subject: message.subject === "(no subject)" ? "" : message.subject,
    text: text.replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    inReplyTo: message.inReplyTo,
    references: message.references,
  };
}
