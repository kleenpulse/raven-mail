import type { MailAddress, MailSummary } from "@/lib/mail/types";

export type ThreadRow = {
  key: string;
  latest: MailSummary;
  members: MailSummary[];
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  people: string[];
  threadIds: string[];
};

const PREFIX = /^\s*((re|aw|sv|antw|fwd?|fw|wg|tr)\s*(\[\d+\])?\s*:\s*|\[[^\]]{1,40}\]\s*)+/i;
const REPLY_PREFIX = /^\s*(re|aw|sv|antw|fwd?|fw|wg|tr)\s*(\[\d+\])?\s*:/i;
const SUBJECT_WINDOW_MS = 30 * 86_400_000;

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

export function memberUids(rows: ThreadRow[], keys: Iterable<string>): string[] {
  const wanted = new Set(keys);
  return rows.filter((r) => wanted.has(r.key)).flatMap((r) => r.members.map((m) => m.uid));
}

export function rowOf(rows: ThreadRow[], uid: string | null): number {
  if (!uid) return -1;
  return rows.findIndex((r) => r.members.some((m) => m.uid === uid));
}

export function threadHeaderIds(m: Pick<MailSummary, "messageId" | "inReplyTo" | "references">, cap = 20): string[] {
  const ids = [...new Set([...(m.references ?? []), m.inReplyTo, m.messageId])].filter(
    (id): id is string => Boolean(id && /^<[^<>\s]{1,250}>$/.test(id)),
  );
  return ids.length <= cap ? ids : [ids[0]!, ...ids.slice(ids.length - (cap - 1))];
}

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
