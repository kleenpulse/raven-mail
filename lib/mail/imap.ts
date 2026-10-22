import "server-only";
import { Readable } from "node:stream";
import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type ListResponse,
  type SearchObject,
} from "imapflow";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import type { MailSession } from "@/lib/session";
import type {
  AttachmentMeta,
  MailAddress,
  MailFolder,
  MailFlags,
  MailMessage,
  MailSummary,
  MailThread,
} from "@/lib/mail/types";
import { threadHeaderIds } from "@/lib/mail/thread";
import { labelSpecialUse, resolveSpecialFolder, shortFolderName } from "@/lib/mail/folders";
import { hasRemoteContent, sanitizeBody } from "@/lib/mail/sanitize";
import { attachmentSections, hasAttachments } from "@/lib/mail/mime";
import { listHeaders, parseHeaderBlock, parseReferences } from "@/lib/mail/headers";
import { fetchPreviews } from "@/lib/mail/preview";
import { planPreload, type PreloadResult } from "@/lib/mail/preload";
import { isLoopbackHost } from "@/lib/auth/ip";
import { sessionKey } from "@/lib/server/session-key";
import { createKeyedSemaphore } from "@/lib/server/semaphore";
import { createTtlCache } from "@/lib/server/cache";
import { acceptTerms, neededTerms, parseQuery, termKey, type Term } from "@/lib/search/text";

// Gmail allows ~15 concurrent IMAP connections per account; stay well under.
const connections = createKeyedSemaphore(4);
// Downloads hold a connection for the whole stream; capping them below `connections`
// keeps slots free for the list, poll, reader and send.
const downloads = createKeyedSemaphore(2);
const folderIndex = createTtlCache<MailFolder[]>({ ttlMs: 5 * 60_000, maxEntries: 100 });

function createClient(session: MailSession): ImapFlow {
  const plain = !session.imap.secure;
  return new ImapFlow({
    host: session.imap.host,
    port: session.imap.port,
    secure: session.imap.secure,
    // Non-TLS ports must upgrade; a stripped STARTTLS would leak the password.
    doSTARTTLS: plain && !isLoopbackHost(session.imap.host) ? true : undefined,
    auth: {
      user: session.email,
      pass: session.password,
    },
    logger: false,
    disableAutoIdle: true,
    tls: {
      rejectUnauthorized: process.env.IMAP_REJECT_UNAUTHORIZED !== "false",
    },
    socketTimeout: 30_000,
    greetingTimeout: 20_000,
    connectionTimeout: 20_000,
  });
}

export async function withClient<T>(session: MailSession, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  return connections.run(sessionKey(session), async () => {
    const client = createClient(session);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      client.logout().catch(() => client.close());
    }
  });
}

/**
 * A client held open across several steps (diagnostics, streamed exports) that
 * still counts against the per-mailbox connection cap. Always call `release()`.
 * Connecting is left to the caller so each phase can be timed and classified.
 */
export async function acquireClient(session: MailSession): Promise<{ client: ImapFlow; release: () => void }> {
  const free = await connections.acquire(sessionKey(session));
  const client = createClient(session);
  let released = false;
  return {
    client,
    release: () => {
      if (released) return;
      released = true;
      if (client.usable) client.logout().catch(() => client.close());
      else client.close();
      free();
    },
  };
}

export async function withMailbox<T>(
  session: MailSession,
  mailbox: string,
  fn: (client: ImapFlow) => Promise<T>,
  { readOnly = false }: { readOnly?: boolean } = {},
): Promise<T> {
  return withClient(session, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly });
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  });
}

export function toFolders(list: ListResponse[]): MailFolder[] {
  const folders: MailFolder[] = [];
  for (const entry of list) {
    if (
      entry.flags?.has("\\Noselect") ||
      entry.flags?.has("\\NonExistent") ||
      entry.flags?.has("\\Nonexistent")
    ) {
      continue;
    }
    const delimiter = entry.delimiter ?? ".";
    folders.push({
      path: entry.path,
      name: shortFolderName(entry.path, delimiter),
      delimiter,
      specialUse: labelSpecialUse(entry.path, delimiter, entry.specialUse as string | undefined),
      unread: entry.status?.unseen ?? 0,
      total: entry.status?.messages ?? 0,
      isParent: entry.flags?.has("\\HasChildren") ?? false,
    });
  }
  const inbox = folders.find((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX");
  if (inbox) {
    folders.splice(folders.indexOf(inbox), 1);
    folders.unshift(inbox);
  }
  return folders;
}

export async function listFolders(session: MailSession): Promise<MailFolder[]> {
  return withClient(session, async (client) =>
    toFolders(await client.list({ statusQuery: { messages: true, unseen: true } })),
  );
}

/** Special-use path lookup for mutations — LIST only, cached; no per-folder STATUS. */
export async function resolveSpecial(
  session: MailSession,
  role: NonNullable<MailFolder["specialUse"]>,
): Promise<string | null> {
  const folders = await folderIndex.get(sessionKey(session), () =>
    withClient(session, async (client) => toFolders(await client.list({ listOnly: true }))),
  );
  return resolveSpecialFolder(folders, role);
}

function toIsoDate(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!value) return [];
  const groups = Array.isArray(value) ? value : [value];
  const result: MailAddress[] = [];
  for (const group of groups) {
    for (const a of group.value ?? []) {
      if (a.address) result.push({ name: a.name || undefined, address: a.address });
    }
  }
  return result;
}

function flagsOf(source: { flags?: Set<string> }): MailFlags {
  const has = (flag: string) => source.flags?.has(flag) ?? false;
  return {
    seen: has("\\Seen"),
    flagged: has("\\Flagged"),
    answered: has("\\Answered"),
    draft: has("\\Draft"),
  };
}

const SUMMARY_QUERY: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  bodyStructure: true,
  size: true,
  // Conversation grouping (lib/mail/thread). threadId is only asked of servers that have one.
  threadId: true,
  headers: ["references"],
};

function toSummary(msg: FetchMessageObject, folder: string, preview: string): MailSummary {
  const envelope = msg.envelope;
  const from = envelope?.from?.[0];
  return {
    uid: String(msg.uid),
    folder,
    subject: envelope?.subject || "(no subject)",
    from: { name: from?.name || undefined, address: from?.address ?? "" },
    to: (envelope?.to ?? []).map((a) => ({ name: a.name || undefined, address: a.address ?? "" })),
    preview,
    date: toIsoDate(msg.internalDate ?? envelope?.date),
    flags: flagsOf(msg),
    hasAttachments: hasAttachments(msg.bodyStructure),
    messageId: envelope?.messageId,
    inReplyTo: envelope?.inReplyTo,
    references: parseReferences(parseHeaderBlock(msg.headers).get("references")),
    threadId: msg.threadId,
  };
}

const MAX_SEARCH_TERMS = 6;

function termCriterion(t: Term, plainCriterion: (token: string) => SearchObject): SearchObject {
  switch (t.field) {
    case "from":
      return { from: t.token };
    case "to":
      return { or: [{ to: t.token }, { cc: t.token }] };
    case "subject":
      return { subject: t.token };
    default:
      return plainCriterion(t.token);
  }
}

/**
 * Term-wise server search with the same acceptance policy as `searchText`
 * (`acceptTerms`). imapflow can't AND repeated `or`/`text` keys in one query,
 * so it's one SEARCH per term and the UID sets combine here. The server can't
 * do fuzzy; SEARCH is already substring, so prefixes land while typing.
 */
export async function searchTerms(
  client: ImapFlow,
  query: string | string[],
  plainCriterion: (token: string) => SearchObject,
): Promise<number[]> {
  const terms = parseQuery(query).slice(0, MAX_SEARCH_TERMS);
  const sets = new Map<string, Set<number>>();
  for (const t of neededTerms(terms)) {
    const found = await client.search(termCriterion(t, plainCriterion), { uid: true });
    sets.set(termKey(t), new Set(Array.isArray(found) ? found : []));
  }
  return acceptTerms(terms, (t) => sets.get(termKey(t)) ?? new Set<number>()).keys;
}

export async function listMessages(
  session: MailSession,
  folder: string,
  opts: { limit?: number; before?: number; search?: string } = {},
): Promise<{ messages: MailSummary[]; count: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  return withMailbox(
    session,
    folder,
    async (client) => {
      const mailbox = client.mailbox;
      const exists = mailbox ? mailbox.exists : 0;
      const query = opts.search?.trim();
      let fetched: FetchMessageObject[] = [];
      let count = exists;

      if (query || opts.before) {
        const found = query
          ? await searchTerms(client, query, (t) => ({ or: [{ subject: t }, { body: t }, { from: t }, { to: t }] }))
          : await client.search({ uid: `1:${Math.max(1, opts.before! - 1)}` }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a);
        if (query) count = uids.length;
        // `before` is the page cursor: the lowest UID the client already holds.
        const before = opts.before;
        const page = (before ? uids.filter((u) => u < before) : uids).slice(0, limit);
        if (page.length) fetched = await client.fetchAll(page, SUMMARY_QUERY, { uid: true });
      } else if (exists > 0) {
        // Newest messages have the highest sequence numbers — no SEARCH ALL needed.
        fetched = await client.fetchAll(`${Math.max(1, exists - limit + 1)}:${exists}`, SUMMARY_QUERY);
      }

      const scope = `${sessionKey(session)}:${folder}:${mailbox ? String(mailbox.uidValidity) : "0"}`;
      const previews = await fetchPreviews(client, scope, fetched);
      const messages = fetched
        .map((m) => toSummary(m, folder, previews.get(m.uid) ?? ""))
        .sort((a, b) => +new Date(b.date) - +new Date(a.date) || Number(b.uid) - Number(a.uid));
      return { messages, count };
    },
    { readOnly: true },
  );
}

const INLINE_IMAGE_LIMIT = 1_500_000;

/** cid: references can't resolve inside a srcdoc iframe; inline small images as data: URLs. */
function inlineCidImages(html: string, attachments: Attachment[]): string {
  let out = html;
  for (const a of attachments) {
    if (!a.cid || !a.contentType.startsWith("image/") || !a.content || a.content.length > INLINE_IMAGE_LIMIT) {
      continue;
    }
    const dataUrl = `data:${a.contentType};base64,${a.content.toString("base64")}`;
    const cid = a.cid.replace(/[<>]/g, "");
    out = out.split(`cid:${cid}`).join(dataUrl);
  }
  return out;
}

// `source` is BODY.PEEK[]: reading a message never marks it \Seen.
// bodyStructure gives each attachment its section number for download.
const MESSAGE_QUERY: FetchQueryObject = {
  envelope: true,
  flags: true,
  uid: true,
  source: true,
  internalDate: true,
  bodyStructure: true,
  threadId: true,
};

/** Parse + sanitize one fetched message. CPU only, so callers run it after releasing the mailbox. */
async function toMailMessage(msg: FetchMessageObject, source: Buffer, folder: string): Promise<MailMessage> {
  const parsed = await simpleParser(source);
  const envelope = msg.envelope;
  const parsedAttachments = parsed.attachments ?? [];
  const sections = attachmentSections(parsedAttachments, msg.bodyStructure);
  const attachments: AttachmentMeta[] = parsedAttachments
    .map((a, i) => ({ a, part: sections[i] }))
    .filter(({ a }) => !a.cid || !/inline/i.test(a.contentDisposition ?? ""))
    .map(({ a, part }) => ({
      filename: a.filename ?? "attachment",
      contentType: a.contentType,
      size: a.size ?? a.content?.length ?? 0,
      contentId: a.cid,
      part,
    }));

  const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
  const html = rawHtml ? sanitizeBody(inlineCidImages(rawHtml, parsed.attachments ?? [])) : "";

  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    if (key === "list") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  Object.assign(headers, listHeaders(parsed.headerLines));

  const parsedTo = addresses(parsed.to);
  return {
    uid: String(msg.uid),
    folder,
    subject: parsed.subject || envelope?.subject || "(no subject)",
    from: {
      name: parsed.from?.value?.[0]?.name || envelope?.from?.[0]?.name || undefined,
      address: parsed.from?.value?.[0]?.address ?? envelope?.from?.[0]?.address ?? "",
    },
    to: parsedTo.length
      ? parsedTo
      : (envelope?.to ?? []).map((a) => ({ name: a.name || undefined, address: a.address ?? "" })),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    replyTo: addresses(parsed.replyTo)[0],
    date: toIsoDate(msg.internalDate ?? parsed.date),
    flags: flagsOf(msg),
    text: parsed.text ?? "",
    html,
    attachments,
    messageId: parsed.messageId ?? envelope?.messageId,
    inReplyTo: parsed.inReplyTo ?? envelope?.inReplyTo,
    references: parsed.references
      ? Array.isArray(parsed.references)
        ? parsed.references
        : String(parsed.references).split(/\s+/).filter(Boolean)
      : undefined,
    threadId: msg.threadId,
    headers,
    remoteContent: hasRemoteContent(html),
  };
}

export async function getMessage(session: MailSession, folder: string, uid: string): Promise<MailMessage> {
  const msg = await withMailbox(session, folder, (client) => client.fetchOne(uid, MESSAGE_QUERY, { uid: true }), {
    readOnly: true,
  });
  if (!msg || !msg.source) {
    throw new Error("Message not found");
  }
  return toMailMessage(msg, msg.source, folder);
}

/** Just the List-Unsubscribe pair, read fresh from the server (never trusted from the client). */
export async function getUnsubscribeHeaders(session: MailSession, folder: string, uid: string): Promise<Record<string, string>> {
  const msg = await withMailbox(
    session,
    folder,
    (client) => client.fetchOne(uid, { uid: true, headers: ["list-unsubscribe", "list-unsubscribe-post"] }, { uid: true }),
    { readOnly: true },
  );
  if (!msg) throw new Error("Message not found");
  return Object.fromEntries(parseHeaderBlock(msg.headers));
}

/**
 * Bodies for the list rows in view, over one connection. Sizes come first so
 * an oversized message is never downloaded.
 */
export async function getMessages(
  session: MailSession,
  folder: string,
  uids: number[],
  signal?: AbortSignal,
): Promise<PreloadResult> {
  const { fetched, skipped } = await withMailbox(
    session,
    folder,
    async (client) => {
      const sized = await client.fetchAll(uids, { uid: true, size: true }, { uid: true });
      const found = new Set(sized.map((m) => m.uid));
      const { take, tooBig } = planPreload(sized.map((m) => ({ uid: m.uid, size: m.size ?? Infinity })));
      const skipped = [...uids.filter((uid) => !found.has(uid)), ...tooBig];
      if (take.length === 0 || signal?.aborted) return { fetched: [], skipped };
      return { fetched: await client.fetchAll(take, MESSAGE_QUERY, { uid: true }), skipped };
    },
    { readOnly: true },
  );

  const messages: MailMessage[] = [];
  for (const msg of fetched) {
    if (signal?.aborted) break;
    try {
      if (!msg.source) throw new Error("Message not found");
      messages.push(await toMailMessage(msg, msg.source, folder));
    } catch {
      skipped.push(msg.uid);
    }
  }
  return { messages, skipped: skipped.map(String) };
}

export type AttachmentDownload = {
  body: ReadableStream<Uint8Array>;
  filename?: string;
  contentType?: string;
  charset?: string;
};

/**
 * One decoded part as a stream. imapflow pulls it in 64 KB FETCH windows as
 * the body is read, so the connection and mailbox lock stay held until the
 * stream ends, errors or is cancelled.
 */
export async function downloadAttachment(
  session: MailSession,
  folder: string,
  uid: string,
  part: string,
  signal?: AbortSignal,
): Promise<AttachmentDownload> {
  const freeDownload = await downloads.acquire(sessionKey(session));
  let release = () => {};
  let unlock: (() => void) | undefined;
  const done = () => {
    unlock?.();
    unlock = undefined;
    release();
    freeDownload();
  };
  try {
    const held = await acquireClient(session);
    release = held.release;
    const client = held.client;
    await client.connect();
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    unlock = () => lock.release();
    const { meta, content } = await client.download(uid, part, { uid: true });
    if (!content) throw new Error("Attachment not found");
    content.once("close", done);
    content.once("error", done);
    signal?.addEventListener("abort", () => content.destroy(), { once: true });
    return {
      // node:stream/web and the DOM lib type the same global ReadableStream separately.
      body: Readable.toWeb(content) as unknown as ReadableStream<Uint8Array>,
      filename: meta.filename || undefined,
      contentType: meta.contentType || undefined,
      charset: meta.charset || undefined,
    };
  } catch (err) {
    done();
    throw err;
  }
}

/** Deep links carry the Message-ID so a UIDVALIDITY reset can't strand them. */
export async function findUidByMessageId(
  session: MailSession,
  folder: string,
  messageId: string,
): Promise<string | null> {
  return withMailbox(
    session,
    folder,
    async (client) => {
      const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
      const uid = (Array.isArray(found) ? found : []).sort((a, b) => b - a)[0];
      return uid ? String(uid) : null;
    },
    { readOnly: true },
  );
}

const THREAD_LIMIT = 50;
const THREAD_SINCE_MS = 180 * 86_400_000;

/**
 * The conversation around one message, in its folder plus Sent (or Inbox plus
 * Sent when it was opened from Sent): one SEARCH per folder. Servers with a
 * thread id answer exactly; others match the header chain, bounded by SINCE
 * so a big unindexed folder isn't scanned end to end.
 *
 * One connection for every step. imapflow can't cancel a command, so `signal`
 * closes the socket instead: the slow SEARCH rejects and the slot frees.
 */
export async function getThread(
  session: MailSession,
  folder: string,
  uid: string,
  signal?: AbortSignal,
): Promise<MailThread> {
  const [inbox, sent] = await Promise.all([resolveSpecial(session, "\\Inbox"), resolveSpecial(session, "\\Sent")]);
  const other = folder === sent ? (inbox ?? "INBOX") : sent;
  const folders = [...new Set([folder, other].filter((f): f is string => Boolean(f)))];

  const { client, release } = await acquireClient(session);
  const abort = () => client.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.connect();
    return await threadOn(client, session, folder, uid, folders);
  } finally {
    signal?.removeEventListener("abort", abort);
    release();
  }
}

async function inMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

async function threadOn(
  client: ImapFlow,
  session: MailSession,
  folder: string,
  uid: string,
  folders: string[],
): Promise<MailThread> {
  const anchor = await inMailbox(client, folder, () =>
    client.fetchOne(uid, { uid: true, envelope: true, internalDate: true, threadId: true, headers: ["references"] }, { uid: true }),
  );
  if (!anchor) throw new Error("Message not found");

  let criteria: SearchObject;
  if (anchor.threadId) {
    criteria = { threadId: anchor.threadId };
  } else {
    const ids = threadHeaderIds({
      messageId: anchor.envelope?.messageId,
      inReplyTo: anchor.envelope?.inReplyTo,
      references: parseReferences(parseHeaderBlock(anchor.headers).get("references")),
    });
    const root = ids[0];
    const self = anchor.envelope?.messageId;
    const any: SearchObject[] = [
      ...ids.map((id) => ({ header: { "message-id": id } })),
      ...(root ? [{ header: { references: root } }] : []),
      ...(self ? [{ header: { "in-reply-to": self } }] : []),
    ];
    if (any.length === 0) return { messages: [] };
    const since = new Date(new Date(anchor.internalDate ?? Date.now()).getTime() - THREAD_SINCE_MS);
    criteria = { since, ...(any.length === 1 ? any[0] : { or: any }) };
  }

  const found: MailSummary[] = [];
  for (const path of folders) {
    found.push(
      ...(await inMailbox(client, path, async () => {
        const hits = await client.search(criteria, { uid: true });
        const uids = (Array.isArray(hits) ? hits : []).sort((a, b) => b - a).slice(0, THREAD_LIMIT);
        if (uids.length === 0) return [];
        const fetched = await client.fetchAll(uids, SUMMARY_QUERY, { uid: true });
        const mailbox = client.mailbox;
        const scope = `${sessionKey(session)}:${path}:${mailbox ? String(mailbox.uidValidity) : "0"}`;
        const previews = await fetchPreviews(client, scope, fetched);
        return fetched.map((m) => toSummary(m, path, previews.get(m.uid) ?? ""));
      })),
    );
  }
  return { messages: dedupeThread(found, folder) };
}

/** Oldest first, newest THREAD_LIMIT kept; a copy in the asked folder beats one elsewhere (mail to yourself). */
function dedupeThread(found: MailSummary[], folder: string): MailSummary[] {
  const byId = new Map<string, MailSummary>();
  for (const m of found) {
    const id = m.messageId ?? `${m.folder}:${m.uid}`;
    const held = byId.get(id);
    if (!held || (held.folder !== folder && m.folder === folder)) byId.set(id, m);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-THREAD_LIMIT);
}

/**
 * What the rules run reads: the given Inbox uids, or the newest `limit`, with
 * their previews and the folder's UIDVALIDITY (the fingerprint for mail with
 * no Message-ID).
 */
export async function rulesBatch(
  session: MailSession,
  uids: string[] | null,
  limit: number,
): Promise<{ folder: string; uidValidity: string; messages: MailSummary[] }> {
  const folder = (await resolveSpecial(session, "\\Inbox")) ?? "INBOX";
  return withMailbox(
    session,
    folder,
    async (client) => {
      const mailbox = client.mailbox;
      const exists = mailbox ? mailbox.exists : 0;
      let fetched: FetchMessageObject[] = [];
      if (uids) {
        if (uids.length) fetched = await client.fetchAll(uids.join(","), SUMMARY_QUERY, { uid: true });
      } else if (exists > 0) {
        fetched = await client.fetchAll(`${Math.max(1, exists - limit + 1)}:${exists}`, SUMMARY_QUERY);
      }
      const uidValidity = mailbox ? String(mailbox.uidValidity) : "0";
      const previews = await fetchPreviews(client, `${sessionKey(session)}:${folder}:${uidValidity}`, fetched);
      return { folder, uidValidity, messages: fetched.map((m) => toSummary(m, folder, previews.get(m.uid) ?? "")) };
    },
    { readOnly: true },
  );
}

/**
 * Move, and say where each message landed: the COPYUID map (UIDPLUS) as
 * old uid → new uid. A server without UIDPLUS answers with an empty map, and
 * those moves can't be undone by uid.
 */
export async function moveWithUids(
  session: MailSession,
  folder: string,
  uids: string[],
  destination: string,
): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  if (uids.length === 0) return moved;
  await withMailbox(session, folder, async (client) => {
    const set = uids.join(",");
    let result;
    if (client.capabilities.has("MOVE")) {
      result = await client.messageMove(set, destination, { uid: true });
    } else {
      result = await client.messageCopy(set, destination, { uid: true });
      await client.messageFlagsAdd(set, ["\\Deleted"], { uid: true });
      await client.messageDelete(set, { uid: true });
    }
    const map = result && typeof result === "object" ? result.uidMap : undefined;
    for (const [from, to] of map ?? []) moved.set(String(from), String(to));
  });
  return moved;
}

export type ReplyCheck = { messageId: string; since: Date; needUid: boolean };
export type ReplyAnswer = { replied: boolean; sentUid?: string };

/**
 * For each sent Message-ID: has a reply reached the Inbox (In-Reply-To or
 * References), and, when asked, its uid in Sent. One connection, one SEARCH
 * per check, each bounded by SINCE so a big folder isn't scanned end to end.
 */
export async function findReplies(session: MailSession, checks: ReplyCheck[]): Promise<Map<string, ReplyAnswer>> {
  const answers = new Map<string, ReplyAnswer>();
  if (checks.length === 0) return answers;
  const [inbox, sent] = await Promise.all([resolveSpecial(session, "\\Inbox"), resolveSpecial(session, "\\Sent")]);
  const { client, release } = await acquireClient(session);
  try {
    await client.connect();
    await inMailbox(client, inbox ?? "INBOX", async () => {
      for (const { messageId, since } of checks) {
        const criteria: SearchObject = {
          since,
          or: [{ header: { "in-reply-to": messageId } }, { header: { references: messageId } }],
        };
        const hits = await client.search(criteria, { uid: true });
        answers.set(messageId, { replied: Array.isArray(hits) && hits.length > 0 });
      }
    });
    const lookups = checks.filter((c) => c.needUid);
    if (sent && lookups.length) {
      await inMailbox(client, sent, async () => {
        for (const { messageId } of lookups) {
          const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
          const uid = (Array.isArray(hits) ? hits : []).sort((a, b) => b - a)[0];
          if (uid) answers.set(messageId, { ...answers.get(messageId)!, sentUid: String(uid) });
        }
      });
    }
    return answers;
  } finally {
    release();
  }
}

/**
 * Every UID in `folder` belonging to the given server thread ids, plus `uids`.
 * Whole-thread archive/trash/read act on messages the list never loaded.
 */
export async function expandThreadUids(
  session: MailSession,
  folder: string,
  uids: string[],
  threadIds: string[],
): Promise<string[]> {
  if (threadIds.length === 0) return uids;
  const criteria: SearchObject =
    threadIds.length === 1 ? { threadId: threadIds[0] } : { or: threadIds.map((threadId) => ({ threadId })) };
  const hits = await withMailbox(session, folder, (client) => client.search(criteria, { uid: true }), {
    readOnly: true,
  });
  return [...new Set([...uids, ...(Array.isArray(hits) ? hits : []).map(String)])];
}

export async function setFlags(
  session: MailSession,
  folder: string,
  uids: string[],
  changes: { add?: string[]; remove?: string[] },
): Promise<void> {
  if (uids.length === 0) return;
  await withMailbox(session, folder, async (client) => {
    if (changes.add?.length) {
      await client.messageFlagsAdd(uids.join(","), changes.add, { uid: true });
    }
    if (changes.remove?.length) {
      await client.messageFlagsRemove(uids.join(","), changes.remove, { uid: true });
    }
  });
}

export async function moveMessages(
  session: MailSession,
  folder: string,
  uids: string[],
  destination: string,
): Promise<void> {
  if (uids.length === 0) return;
  await withMailbox(session, folder, async (client) => {
    if (client.capabilities.has("MOVE")) {
      await client.messageMove(uids.join(","), destination, { uid: true });
    } else {
      await client.messageCopy(uids.join(","), destination, { uid: true });
      await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
      await client.messageDelete(uids.join(","), { uid: true });
    }
  });
}

export async function deleteMessages(
  session: MailSession,
  folder: string,
  uids: string[],
  trashFolder: string | null,
): Promise<void> {
  if (uids.length === 0) return;
  if (trashFolder && trashFolder !== folder) {
    await moveMessages(session, folder, uids, trashFolder);
    return;
  }
  await withMailbox(session, folder, async (client) => {
    await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
    await client.messageDelete(uids.join(","), { uid: true });
  });
}

export async function appendRaw(
  session: MailSession,
  mailbox: string,
  raw: Buffer,
  flags: string[] = ["\\Seen"],
): Promise<{ uid?: string }> {
  return withClient(session, async (client) => {
    const res = await client.append(mailbox, raw, flags);
    // UIDPLUS servers answer with APPENDUID; others leave the caller to search.
    return res && res.uid ? { uid: String(res.uid) } : {};
  });
}

export async function verifyCredentials(session: MailSession): Promise<void> {
  await withClient(session, async (client) => {
    await client.noop();
  });
}
