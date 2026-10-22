import "server-only";
import type {
  AttachmentMeta,
  ComposeDraft,
  MailAddress,
  MailFolder,
  MailMessage,
  MailSummary,
  MailThread,
} from "@/lib/mail/types";
import { threadHeaderIds } from "@/lib/mail/thread";
import { dateHeader, generateSyntheticMail } from "@/lib/mail/dev-seed";
import { fixtureBytes } from "@/lib/mail/dev-fixtures";
import { searchText } from "@/lib/search/text";

export function isDevSession(session: { dev?: boolean }): boolean {
  return session.dev === true && process.env.NODE_ENV !== "production";
}

type DevDb = {
  nextUid: number;
  messages: MailMessage[];
  /** Bytes of attachments sent or saved through compose, by `uid/part`. Seeds use fixtures. */
  files: Map<string, Uint8Array>;
};

// Versioned so a running dev server (store lives on globalThis across HMR) picks up the synthetic seed.
const STORE_KEY = "__em_dev_mail_store_v8__";

/** Section numbers like a multipart/mixed message: the body is part 1. */
function withParts(attachments: AttachmentMeta[]): AttachmentMeta[] {
  return attachments.map((a, i) => ({ ...a, part: String(i + 2) }));
}

function hoursAgo(now: number, h: number): string {
  return new Date(now - h * 3_600_000).toISOString();
}

function addr(address: string, name?: string): MailAddress {
  return name ? { address, name } : { address };
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

type SeedInput = {
  uid: number;
  folder: string;
  subject: string;
  from: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  date: string;
  text: string;
  html?: string;
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
  draft?: boolean;
  attachments?: AttachmentMeta[];
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  /** Like Gmail's X-GM-THRID: a server thread id, so dev runs that path too. */
  threadId?: string;
};

function seedMessage(input: SeedInput): MailMessage {
  const text = input.text;
  const html =
    input.html ??
    `<p>${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")}</p>`;
  return {
    uid: String(input.uid),
    folder: input.folder,
    subject: input.subject,
    from: input.from,
    to: input.to ?? [addr("dev@localhost", "You")],
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    date: input.date,
    flags: {
      seen: input.seen ?? false,
      flagged: input.flagged ?? false,
      answered: input.answered ?? false,
      draft: input.draft ?? false,
    },
    text,
    html,
    attachments: input.attachments ?? [],
    messageId: input.messageId ?? `<dev-${input.uid}@localhost>`,
    inReplyTo: input.inReplyTo,
    references: input.references,
    threadId: input.threadId,
    headers: {
      from: `${input.from.name ? `${input.from.name} <` : ""}${input.from.address}${input.from.name ? ">" : ""}`,
      date: dateHeader(Date.parse(input.date)),
      "x-dev-mode": "true",
    },
  };
}

function seed(now: number): DevDb {
  const messages: MailMessage[] = [
    seedMessage({
      uid: 101,
      folder: "INBOX",
      subject: "Q3 roadmap — need your sign-off by Friday",
      from: addr("maya.chen@northwind.example", "Maya Chen"),
      date: hoursAgo(now, 1),
      text: "Hey — the Q3 roadmap draft is ready for review. I need your sign-off by Friday so we can lock scope.\n\nCan you take a look at the pricing experiments section and let me know if we should keep the two-week beta?",
      flagged: true,
      answered: true,
    }),
    seedMessage({
      uid: 100,
      folder: "INBOX",
      subject: "Security alert: new sign-in to your account",
      from: addr("no-reply@accounts.example", "Accounts Security"),
      date: hoursAgo(now, 3),
      text: "We noticed a new sign-in from Chrome on Windows.\n\nIf this was you, no action is needed. If not, reset your password immediately.",
      seen: true,
    }),
    seedMessage({
      uid: 99,
      folder: "INBOX",
      subject: "Invoice #1842 — payment received",
      from: addr("billing@fastmail.example", "Billing"),
      date: hoursAgo(now, 7),
      text: "We received your payment of $48.00 for Invoice #1842.\n\nThank you for your business.",
      seen: true,
      attachments: [
        { filename: "invoice-1842.pdf", contentType: "application/pdf", size: 48_211 },
      ],
    }),
    seedMessage({
      uid: 98,
      folder: "INBOX",
      subject: "Design critique notes + open questions",
      from: addr("sam.okafor@northwind.example", "Sam Okafor"),
      date: hoursAgo(now, 26),
      text: "Notes from Tuesday's critique:\n\n1. The list density feels right at 50 rows.\n2. Reader pane needs a clearer back affordance on mobile.\n3. Triage badges are noisy on newsletters.\n\nOpen question: do we want keyboard-first archive, or is the toolbar enough?",
      attachments: [
        { filename: "critique-board.svg", contentType: "image/svg+xml", size: 4_812 },
        { filename: "Notes – Tuesday critique.txt", contentType: "text/plain", size: 1_204 },
      ],
    }),
    seedMessage({
      uid: 97,
      folder: "INBOX",
      subject: "Weekly roundup: 12 links worth your time",
      from: addr("digest@reads.example", "Reads Digest"),
      date: hoursAgo(now, 30),
      text: "This week: local-first sync patterns, Postgres query plans, and a deep dive on IMAP IDLE.\n\nRead more →",
      // A designed newsletter (own colours + a tracking-style remote image) so dev exercises the
      // reader's paper look and the "Load images" banner.
      html: `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3efe8" style="font-family:Georgia,serif">
<tr><td style="padding:28px 32px;background:#1f2a44;color:#f6f1e7">
<p style="margin:0;font:600 12px/1.4 Arial,sans-serif;letter-spacing:.14em;color:#e0b25c">READS DIGEST · ISSUE 212</p>
<h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;color:#ffffff">12 links worth your time</h1>
</td></tr>
<tr><td style="padding:24px 32px;color:#2b2b2b">
<img src="https://images.reads.example/issue-212/hero.jpg" alt="Issue 212 cover" width="560" style="display:block;border-radius:8px;margin-bottom:18px">
<p style="margin:0 0 14px">This week: local-first sync patterns, Postgres query plans, and a deep dive on IMAP IDLE.</p>
<p style="margin:0 0 20px"><a href="https://reads.example/212" style="display:inline-block;padding:10px 18px;background:#1f2a44;color:#ffffff;border-radius:6px;text-decoration:none">Read the issue →</a></p>
<p style="margin:0;font-size:12px;color:#8a8375">You get this because you subscribed at reads.example. <a href="https://reads.example/u" style="color:#8a8375">Unsubscribe</a></p>
<img src="https://t.reads.example/open.gif" width="1" height="1" alt="">
</td></tr></table>`,
      seen: true,
    }),
    seedMessage({
      uid: 96,
      folder: "INBOX",
      subject: "Your order has shipped",
      from: addr("shipping@shop.example", "Shop Shipping"),
      date: hoursAgo(now, 49),
      text: "Order #9931 is on its way. Tracking: 1Z999AA10123456784.",
      seen: true,
    }),
    seedMessage({
      uid: 95,
      folder: "INBOX",
      subject: "Alex mentioned you in “Launch checklist”",
      from: addr("notifications@team.example", "Team Notifications"),
      date: hoursAgo(now, 52),
      text: "Alex mentioned you: “@you can you confirm the rollback path before we ship?”",
      seen: true,
    }),
    seedMessage({
      uid: 94,
      folder: "INBOX",
      subject: "Renewal notice — action required",
      from: addr("renewals@saas.example", "SaaS Renewals"),
      date: hoursAgo(now, 73),
      text: "Your plan renews in 7 days. Please confirm your payment method to avoid interruption.",
      flagged: true,
    }),
    seedMessage({
      uid: 93,
      folder: "INBOX",
      subject: "Lunch Thursday?",
      from: addr("jordan.lee@northwind.example", "Jordan Lee"),
      date: hoursAgo(now, 80),
      text: "There's a new ramen place near the office — Thursday around noon?",
    }),
    seedMessage({
      uid: 92,
      folder: "INBOX",
      subject: "50% off Spring sale — today only",
      from: addr("deals@shop.example", "Shop Deals"),
      date: hoursAgo(now, 96),
      text: "Everything must go. 50% off sitewide. Use code SPRING50 at checkout. Unsubscribe",
      seen: true,
    }),
    seedMessage({
      uid: 91,
      folder: "INBOX",
      subject: "Build passing on main",
      from: addr("ci@github.example", "CI Bot"),
      date: hoursAgo(now, 120),
      text: "Workflow “deploy-preview” passed in 2m 14s.\n\nCommit: 8f3a1c2 — feat: dev login",
      seen: true,
    }),
    seedMessage({
      uid: 90,
      folder: "INBOX",
      subject: "Password reset requested",
      from: addr("security@accounts.example", "Accounts Security"),
      date: hoursAgo(now, 140),
      text: "A password reset was requested for your account. If this wasn't you, ignore this message.",
      seen: true,
    }),
    seedMessage({
      uid: 80,
      folder: "Sent",
      subject: "Re: Q3 roadmap — need your sign-off by Friday",
      from: addr("dev@localhost", "You"),
      to: [addr("maya.chen@northwind.example", "Maya Chen")],
      date: hoursAgo(now, 0.5),
      inReplyTo: "<dev-101@localhost>",
      references: ["<dev-101@localhost>"],
      text: "Looking at it now — will have comments before EOD.",
      seen: true,
    }),
    seedMessage({
      uid: 79,
      folder: "Sent",
      subject: "Notes from the retro",
      from: addr("dev@localhost", "You"),
      to: [addr("team@northwind.example", "Team")],
      date: hoursAgo(now, 36),
      text: "Sharing the retro notes. Action items are in the doc linked below.",
      seen: true,
    }),
    seedMessage({
      uid: 70,
      folder: "Drafts",
      subject: "Draft: hiring post for senior eng",
      from: addr("dev@localhost", "You"),
      to: [addr("people@northwind.example", "People")],
      date: hoursAgo(now, 10),
      text: "We're hiring a senior engineer who cares about delightful local-first UX…",
      seen: true,
      draft: true,
    }),
    seedMessage({
      uid: 60,
      folder: "Archive",
      subject: "Conference talk accepted 🎉",
      from: addr("cfp@events.example", "CFP Committee"),
      date: hoursAgo(now, 200),
      text: "Your talk “Mail without the refresh” was accepted. See you in June!",
      seen: true,
    }),
    seedMessage({
      uid: 50,
      folder: "Junk",
      subject: "You've WON a free vacation!!!",
      from: addr("winner@spam.example", "Prize Dept"),
      date: hoursAgo(now, 220),
      text: "Click here to claim your free vacation. Absolutely no strings attached.",
      seen: true,
    }),
    seedMessage({
      uid: 40,
      folder: "Trash",
      subject: "Old newsletter",
      from: addr("news@old.example", "Old News"),
      date: hoursAgo(now, 260),
      text: "This month in archives…",
      seen: true,
    }),
    // Threading cases (task 1.5). A Gmail-style thread: only the server id ties it together,
    // and its first message sits beyond the first page, so whole-thread archive must reach it.
    seedMessage({
      uid: 30,
      folder: "INBOX",
      subject: "Launch checklist",
      from: addr("priya@orbit.example", "Priya Nair"),
      date: hoursAgo(now, 240),
      text: "Here's the launch checklist. Can you own the comms section?",
      seen: true,
      threadId: "dev-thread-7301",
    }),
    seedMessage({
      uid: 31,
      folder: "Sent",
      subject: "Re: Launch checklist",
      from: addr("dev@localhost", "You"),
      to: [addr("priya@orbit.example", "Priya Nair")],
      date: hoursAgo(now, 200),
      text: "Yes, I'll take comms. Draft by Thursday.",
      seen: true,
      threadId: "dev-thread-7301",
    }),
    seedMessage({
      uid: 32,
      folder: "INBOX",
      subject: "Re: Launch checklist",
      from: addr("priya@orbit.example", "Priya Nair"),
      date: hoursAgo(now, 2),
      text: "Thanks! One more item: the press list needs a final pass.",
      threadId: "dev-thread-7301",
    }),
    // A reply from a phone client that sent no In-Reply-To or References: joins on subject.
    seedMessage({
      uid: 33,
      folder: "INBOX",
      subject: "Venue options for the offsite",
      from: addr("leo@harbor.example", "Leo Park"),
      date: hoursAgo(now, 30),
      text: "Three venues made the shortlist. Prices attached later today.",
      seen: true,
    }),
    seedMessage({
      uid: 34,
      folder: "INBOX",
      subject: "Re: Venue options for the offsite",
      from: addr("leo@harbor.example", "Leo Park"),
      date: hoursAgo(now, 5),
      text: "Sent from my phone. The lake venue just dropped its price.",
    }),
    // Same sender, same subject, no reply prefix: two receipts, never one thread.
    seedMessage({
      uid: 35,
      folder: "INBOX",
      subject: "Your receipt",
      from: addr("orders@shop.example", "Shop"),
      date: hoursAgo(now, 20),
      text: "Order #5521: 1 × desk lamp.",
      seen: true,
    }),
    seedMessage({
      uid: 36,
      folder: "INBOX",
      subject: "Your receipt",
      from: addr("orders@shop.example", "Shop"),
      date: hoursAgo(now, 44),
      text: "Order #5498: 2 × notebooks.",
      seen: true,
    }),
    // A thread whose middle message was archived: the Inbox and the reader show the rest.
    seedMessage({
      uid: 37,
      folder: "INBOX",
      subject: "Contract redlines",
      from: addr("ana@northwind.example", "Ana Ruiz"),
      date: hoursAgo(now, 50),
      text: "Redlines attached. Section 4 is the one to look at.",
      seen: true,
      messageId: "<dev-redlines-1@northwind.example>",
    }),
    seedMessage({
      uid: 38,
      folder: "Archive",
      subject: "Re: Contract redlines",
      from: addr("ana@northwind.example", "Ana Ruiz"),
      date: hoursAgo(now, 30),
      text: "Legal signed off on section 4.",
      seen: true,
      messageId: "<dev-redlines-2@northwind.example>",
      inReplyTo: "<dev-redlines-1@northwind.example>",
      references: ["<dev-redlines-1@northwind.example>"],
    }),
    seedMessage({
      uid: 39,
      folder: "INBOX",
      subject: "Re: Contract redlines",
      from: addr("ana@northwind.example", "Ana Ruiz"),
      date: hoursAgo(now, 6),
      text: "Final version is ready to sign.",
      messageId: "<dev-redlines-3@northwind.example>",
      inReplyTo: "<dev-redlines-2@northwind.example>",
      references: ["<dev-redlines-1@northwind.example>", "<dev-redlines-2@northwind.example>"],
    }),
  ];

  messages.push(...generateSyntheticMail({ now }));
  // IMAP UIDs rise with arrival, and list paging relies on it (cursor = lowest UID held),
  // so renumber hand seeds + synthetic mail by date. Message-IDs were fixed at creation.
  messages.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  messages.forEach((m, i) => {
    m.uid = String(i + 1);
    m.attachments = withParts(m.attachments);
  });
  return { nextUid: messages.length + 1, messages, files: new Map() };
}

function getDb(): DevDb {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: DevDb };
  g[STORE_KEY] ??= seed(Date.now());
  return g[STORE_KEY];
}

/** Every folder, unsorted. The array is a copy; the messages are the live store objects. */
export function devAllMessages(): MailMessage[] {
  return [...getDb().messages];
}

const FOLDERS: MailFolder[] = [
  { path: "INBOX", name: "Inbox", delimiter: "/", specialUse: "\\Inbox", unread: 0, total: 0 },
  { path: "Sent", name: "Sent", delimiter: "/", specialUse: "\\Sent", unread: 0, total: 0 },
  { path: "Drafts", name: "Drafts", delimiter: "/", specialUse: "\\Drafts", unread: 0, total: 0 },
  { path: "Archive", name: "Archive", delimiter: "/", specialUse: "\\Archive", unread: 0, total: 0 },
  { path: "Junk", name: "Junk", delimiter: "/", specialUse: "\\Junk", unread: 0, total: 0 },
  { path: "Trash", name: "Trash", delimiter: "/", specialUse: "\\Trash", unread: 0, total: 0 },
];

export function devListFolders(): MailFolder[] {
  const counts = new Map<string, { total: number; unread: number }>();
  for (const m of getDb().messages) {
    const c = counts.get(m.folder) ?? { total: 0, unread: 0 };
    c.total++;
    if (!m.flags.seen) c.unread++;
    counts.set(m.folder, c);
  }
  return FOLDERS.map((folder) => ({ ...folder, ...(counts.get(folder.path) ?? { total: 0, unread: 0 }) }));
}

function toSummary(message: MailMessage): MailSummary {
  return {
    uid: message.uid,
    folder: message.folder,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: preview(message.text),
    date: message.date,
    flags: message.flags,
    hasAttachments: message.attachments.length > 0,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    threadId: message.threadId,
  };
}

export function devListMessages(
  folder: string,
  opts: { limit?: number; before?: number; search?: string } = {},
): { messages: MailSummary[]; count: number } {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 40, 100);
  const query = opts.search?.trim();

  let list = db.messages.filter((m) => m.folder === folder);
  if (query) {
    // Same policy as IMAP (every token, else any token) plus prefix/typo tiers; order stays by date.
    const people = (as: MailAddress[]) => as.map((a) => `${a.name ?? ""} ${a.address}`).join(" ");
    list = searchText(list, query, (m) => [
      { text: m.subject, weight: 4, key: "subject" },
      { text: people([m.from]), weight: 3, key: "from" },
      { text: people([...m.to, ...m.cc]), weight: 2, key: "to" },
      { text: m.text, weight: 1 },
    ]).map((h) => h.item);
  }

  // Parse each date once rather than inside the comparator (hundreds of seeded messages).
  const sorted = list
    .map((m) => ({ m, t: Date.parse(m.date), uid: Number(m.uid) }))
    .sort((a, b) => b.t - a.t || b.uid - a.uid);

  // Like IMAP: `count` is the whole folder (or all matches); `before` only pages.
  const before = opts.before;
  const page = before ? sorted.filter(({ uid }) => uid < before) : sorted;
  return {
    messages: page.slice(0, limit).map(({ m }) => toSummary(m)),
    count: sorted.length,
  };
}

export function devGetMessage(folder: string, uid: string): MailMessage {
  const db = getDb();
  const found = db.messages.find((m) => m.folder === folder && m.uid === uid);
  if (!found) throw new Error("Message not found");
  return found;
}

/** Same search as IMAP `getThread`: the folder plus Sent (Inbox plus Sent from Sent). */
export function devGetThread(folder: string, uid: string): MailThread {
  const anchor = devGetMessage(folder, uid);
  const folders = new Set([folder, folder === "Sent" ? "INBOX" : "Sent"]);
  const pool = getDb().messages.filter((m) => folders.has(m.folder));
  let hits: MailMessage[];
  if (anchor.threadId) {
    hits = pool.filter((m) => m.threadId === anchor.threadId);
  } else {
    const chain = threadHeaderIds(anchor);
    if (chain.length === 0) return { messages: [] };
    const ids = new Set(chain);
    const root = chain[0];
    hits = pool.filter(
      (m) =>
        (m.messageId && ids.has(m.messageId)) ||
        (root && m.references?.includes(root)) ||
        (anchor.messageId && m.inReplyTo === anchor.messageId),
    );
  }
  const byId = new Map<string, MailMessage>();
  for (const m of hits) {
    const id = m.messageId ?? `${m.folder}:${m.uid}`;
    const held = byId.get(id);
    if (!held || (held.folder !== folder && m.folder === folder)) byId.set(id, m);
  }
  const messages = [...byId.values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-50)
    .map(toSummary);
  return { messages };
}

/** Like IMAP `expandThreadUids`: `uids` plus every message in `folder` with one of the thread ids. */
export function devExpandThread(folder: string, uids: string[], threadIds: string[]): string[] {
  if (threadIds.length === 0) return uids;
  const wanted = new Set(threadIds);
  const more = getDb()
    .messages.filter((m) => m.folder === folder && m.threadId && wanted.has(m.threadId))
    .map((m) => m.uid);
  return [...new Set([...uids, ...more])];
}

/** An attachment's bytes: what compose uploaded, or a fixture for seeded mail. */
export function devGetAttachment(
  folder: string,
  uid: string,
  part: string,
): { meta: AttachmentMeta; bytes: Uint8Array } {
  const meta = devGetMessage(folder, uid).attachments.find((a) => a.part === part);
  if (!meta) throw new Error("Attachment not found");
  return { meta, bytes: getDb().files.get(`${uid}/${part}`) ?? fixtureBytes(meta) };
}

export function devSetFlags(
  folder: string,
  uids: string[],
  changes: { seen?: boolean; flagged?: boolean; answered?: boolean },
): void {
  const db = getDb();
  const set = new Set(uids);
  for (const m of db.messages) {
    if (m.folder !== folder || !set.has(m.uid)) continue;
    if (changes.seen !== undefined) m.flags.seen = changes.seen;
    if (changes.flagged !== undefined) m.flags.flagged = changes.flagged;
    if (changes.answered !== undefined) m.flags.answered = changes.answered;
  }
}

export function devMoveMessages(folder: string, uids: string[], destination: string): void {
  const db = getDb();
  const set = new Set(uids);
  for (const m of db.messages) {
    if (m.folder === folder && set.has(m.uid)) m.folder = destination;
  }
}

export function devDeleteMessages(folder: string, uids: string[], trashFolder: string | null): void {
  const db = getDb();
  if (trashFolder && trashFolder !== folder) {
    devMoveMessages(folder, uids, trashFolder);
    return;
  }
  const set = new Set(uids);
  db.messages = db.messages.filter((m) => !(m.folder === folder && set.has(m.uid)));
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAddressList(raw: string): MailAddress[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*?)<([^>]+)>$/);
      if (match) return addr(match[2]!.trim(), match[1]?.trim() || undefined);
      return addr(entry);
    });
}

function draftToMessage(
  folder: string,
  draft: ComposeDraft,
  from: MailAddress,
  flags: { seen: boolean; draft: boolean },
): MailMessage {
  const db = getDb();
  const uid = String(db.nextUid++);
  const now = new Date().toISOString();
  const text = draft.text;
  const attachments = withParts(
    (draft.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: Math.floor((a.contentBase64.length * 3) / 4),
    })),
  );
  (draft.attachments ?? []).forEach((a, i) => {
    db.files.set(`${uid}/${attachments[i]!.part}`, Uint8Array.from(Buffer.from(a.contentBase64, "base64")));
  });
  return {
    uid,
    folder,
    subject: draft.subject || "(no subject)",
    from,
    to: parseAddressList(draft.to),
    cc: parseAddressList(draft.cc ?? ""),
    bcc: parseAddressList(draft.bcc ?? ""),
    date: now,
    flags: {
      seen: flags.seen,
      flagged: false,
      answered: false,
      draft: flags.draft,
    },
    text,
    html: `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    attachments,
    messageId: `<dev-${uid}@localhost>`,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    headers: {
      from: from.address,
      date: now,
      "x-dev-mode": "true",
    },
  };
}

export function devSendMessage(
  draft: ComposeDraft,
  from: MailAddress,
): { messageId: string } {
  if (!draft.to.trim()) throw new Error("Add at least one recipient.");
  const db = getDb();
  const message = draftToMessage("Sent", draft, from, { seen: true, draft: false });
  db.messages.unshift(message);
  // Mail to yourself lands in the Inbox too, as on a real server — the only way new mail arrives here.
  const self = from.address.toLowerCase();
  if ([...message.to, ...message.cc, ...message.bcc].some((a) => a.address.toLowerCase() === self)) {
    db.messages.unshift({ ...draftToMessage("INBOX", draft, from, { seen: false, draft: false }), messageId: message.messageId });
  }
  return { messageId: message.messageId ?? "" };
}

/** Like IMAP: append the new copy first, then drop the one it replaces. */
export function devSaveDraft(draft: ComposeDraft, from: MailAddress, replaces?: string): { uid: string } {
  const db = getDb();
  const message = draftToMessage("Drafts", draft, from, { seen: true, draft: true });
  db.messages.unshift(message);
  if (replaces && replaces !== message.uid) devDeleteMessages("Drafts", [replaces], null);
  return { uid: message.uid };
}
