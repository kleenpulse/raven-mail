import type { MailAddress, MailSummary } from "@/lib/mail/types";

/*
 * Conversation grouping over the rows a list has loaded. Three tiers, strongest first:
 *  1. the server's thread id (Gmail X-GM-THRID, RFC 8474 THREADID);
 *  2. the header chain: Message-ID ↔ In-Reply-To ↔ every References entry;
 *  3. a guarded subject match for replies that lost their headers.
 * Pure and client-safe: the list and the shell's j/k both group the same way.
 */

export type ThreadRow = {
  /** The newest member's uid: the row's identity for selection, j/k and links. */
  key: string;
  latest: MailSummary;
  /** Newest first, as the list shows them. */
  members: MailSummary[];
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  /** Distinct senders, oldest first; the account itself reads as "You". */
  people: string[];
  /** Server thread ids among the members (whole-thread actions reach unloaded mail through them). */
  threadIds: string[];
};

const PREFIX = /^\s*((re|aw|sv|antw|fwd?|fw|wg|tr)\s*(\[\d+\])?\s*:\s*|\[[^\]]{1,40}\]\s*)+/i;
const REPLY_PREFIX = /^\s*(re|aw|sv|antw|fwd?|fw|wg|tr)\s*(\[\d+\])?\s*:/i;
const SUBJECT_WINDOW_MS = 30 * 86_400_000;

/** "Re: [team] Fwd:  Q3  plan" → "q3 plan". */
export function normalizeSubject(subject: string): string {
  return subject.replace(PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function makeUnion() {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    let node = x;
    while (parent.get(node) !== undefined && parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  return { find, union };
}

const key = (a: MailAddress) => a.address.trim().toLowerCase();

/**
 * Groups rows (newest first) into conversations, in the order of each one's
 * newest message. `self` is the account address, left out of the people
 * that must overlap for a subject match and shown as "You".
 */
export function groupThreads(rows: MailSummary[], self: string): ThreadRow[] {
  const me = self.trim().toLowerCase();
  const { find, union } = makeUnion();
  const node = (i: number) => `row:${i}`;

  rows.forEach((m, i) => {
    union(node(i), node(i));
    if (m.threadId) union(node(i), `tid:${m.threadId}`);
    if (m.messageId) union(node(i), `mid:${m.messageId}`);
    for (const id of [m.inReplyTo, ...(m.references ?? [])]) if (id) union(node(i), `mid:${id}`);
  });

  // A reply with no headers at all joins on subject, only when it says it's a reply,
  // the two share a person besides you, and they're within a month of each other.
  const others = (m: MailSummary) => new Set([m.from, ...m.to].map(key).filter((a) => a && a !== me));
  rows.forEach((m, i) => {
    if (m.threadId || m.inReplyTo || m.references?.length || !REPLY_PREFIX.test(m.subject)) return;
    const subject = normalizeSubject(m.subject);
    if (subject.length < 3) return;
    const people = others(m);
    const at = Date.parse(m.date);
    rows.forEach((n, j) => {
      if (i === j || normalizeSubject(n.subject) !== subject) return;
      if (Math.abs(Date.parse(n.date) - at) > SUBJECT_WINDOW_MS) return;
      if ([...others(n)].some((a) => people.has(a))) union(node(i), node(j));
    });
  });

  const groups = new Map<string, MailSummary[]>();
  rows.forEach((m, i) => {
    const root = find(node(i));
    const list = groups.get(root);
    if (list) list.push(m);
    else groups.set(root, [m]);
  });

  return [...groups.values()].map((members) => {
    const latest = members[0]!;
    const people: string[] = [];
    for (const m of [...members].reverse()) {
      const name = key(m.from) === me ? "You" : m.from.name || m.from.address || "(unknown)";
      if (!people.includes(name)) people.push(name);
    }
    return {
      key: latest.uid,
      latest,
      members,
      unread: members.some((m) => !m.flags.seen),
      flagged: members.some((m) => m.flags.flagged),
      hasAttachments: members.some((m) => m.hasAttachments),
      people,
      threadIds: [...new Set(members.map((m) => m.threadId).filter((t): t is string => Boolean(t)))],
    };
  });
}

/** One row per message, for search results and threading switched off. */
export function singleRows(rows: MailSummary[], self: string): ThreadRow[] {
  const me = self.trim().toLowerCase();
  return rows.map((m) => ({
    key: m.uid,
    latest: m,
    members: [m],
    unread: !m.flags.seen,
    flagged: m.flags.flagged,
    hasAttachments: m.hasAttachments,
    people: [key(m.from) === me ? "You" : m.from.name || m.from.address || "(unknown)"],
    threadIds: [],
  }));
}

/** Every uid a set of selected rows stands for. */
export function memberUids(rows: ThreadRow[], keys: Iterable<string>): string[] {
  const wanted = new Set(keys);
  return rows.filter((r) => wanted.has(r.key)).flatMap((r) => r.members.map((m) => m.uid));
}

/** The row holding a uid, which may be an older member opened from a link. */
export function rowOf(rows: ThreadRow[], uid: string | null): number {
  if (!uid) return -1;
  return rows.findIndex((r) => r.members.some((m) => m.uid === uid));
}

/**
 * The Message-IDs a header SEARCH should look for around one message: the
 * root, its parents and itself. Long chains keep the root and the newest.
 */
export function threadHeaderIds(m: Pick<MailSummary, "messageId" | "inReplyTo" | "references">, cap = 20): string[] {
  const ids = [...new Set([...(m.references ?? []), m.inReplyTo, m.messageId])].filter(
    (id): id is string => Boolean(id && /^<[^<>\s]{1,250}>$/.test(id)),
  );
  return ids.length <= cap ? ids : [ids[0]!, ...ids.slice(ids.length - (cap - 1))];
}

/**
 * Whole-thread targets for the reader's archive / trash: every member in this
 * folder plus their server thread ids. Just the open message without a thread.
 */
export function conversationTargets(
  thread: { messages: MailSummary[] } | undefined,
  folder: string,
  uid: string,
): { uids: string[]; threadIds?: string[] } {
  const here = thread?.messages.filter((m) => m.folder === folder) ?? [];
  if (!here.some((m) => m.uid === uid)) return { uids: [uid] };
  const ids = [...new Set(here.map((m) => m.threadId).filter((t): t is string => Boolean(t)))];
  return { uids: here.map((m) => m.uid), threadIds: ids.length ? ids : undefined };
}
