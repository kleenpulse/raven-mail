import { heuristicTriage } from "@/lib/triage/heuristic";
import { parseListUnsubscribe } from "@/lib/mail/headers";
import {
  dayDiff,
  formatHour,
  makeLocalizer,
  WEEKDAY_NAMES,
  windowDateKeys,
  type LocalParts,
} from "@/lib/insights/bins";
import { inboxWeather } from "@/lib/insights/health";
import type {
  BriefItem,
  EnvelopeRow,
  HotThread,
  MixBucket,
  NewsletterStat,
  Overview,
  PersonRef,
  ReplyTimeStat,
  SenderStat,
  Snapshot,
  ThreadRef,
  WaitingRef,
} from "@/lib/insights/types";
import type { MailAddress, TriageCategory } from "@/lib/mail/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OBLIGATION_WINDOW = 14 * DAY;

// Machine senders by mailbox name; they can't be waiting on you.
const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer(-daemon)?|bounces?|postmaster|alerts?)([._+-].*)?@/i;
const ROLE = /^(billing|receipts?|invoices?|orders?|shipping|renewals?|subscriptions?|support|help|info|sales|news(letter)?|marketing|deals?|updates?|digest|hello|team|contact|accounts?|security|admin|feedback|ci|calendar(-notification)?)@/i;

export type ComputeOptions = {
  now: number;
  tz: string;
  /** Addresses that are "you" (session email + aliases). */
  self: string[];
};

export type EnrichedRow = EnvelopeRow & {
  auto: boolean;
  category: TriageCategory;
  urgency: number;
  bucket: MixBucket;
  local: LocalParts;
  fromKey: string;
  threadKey: string;
};

const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function isMachineAddress(address: string): boolean {
  const a = lc(address);
  return NOREPLY.test(a) || ROLE.test(a);
}

function prettyName(address: string): string {
  const local = address.split("@")[0] ?? address;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ");
}

/** `"owner/repo" <repo.owner.github.com>` → `owner/repo`; undefined when the List-Id has no display phrase. */
export function listLabel(listId: string | undefined): string | undefined {
  if (!listId?.includes("<")) return undefined;
  const phrase = listId.split("<")[0]!.trim().replace(/^"(.*)"$/, "$1").trim();
  // Raw headers aren't MIME-decoded; an encoded-word phrase would render as =?UTF-8?…
  return phrase && !phrase.includes("=?") ? phrase : undefined;
}

export function person(a: MailAddress): PersonRef {
  return { name: a.name || prettyName(a.address), address: a.address };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function replyStat(latenciesMs: number[]): ReplyTimeStat {
  const minutes = latenciesMs.map((ms) => ms / 60_000);
  const med = median(minutes);
  const p90 = quantile(minutes, 0.9);
  return {
    medianMin: med === null ? null : Math.round(med),
    p90Min: p90 === null ? null : Math.round(p90),
    samples: minutes.length,
  };
}

function mode<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  let best = values[0]!;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

function bucketOf(auto: boolean, category: TriageCategory, row: EnvelopeRow): MixBucket {
  if (category === "receipts") return "transactions";
  if (!auto) return "people";
  if (row.listId || row.listUnsubscribe || row.bulk || category === "newsletters" || category === "promotions") {
    return "newsletters";
  }
  return "notifications";
}

/**
 * Having the last word isn't waiting. A sent message expects an answer when you
 * started the thread, or when it asks something.
 */
function expectsReply(row: EnvelopeRow): boolean {
  if (!row.inReplyTo) return true;
  const text = `${row.subject}\n${row.preview ?? ""}`;
  return /\?/.test(text) || heuristicTriage({ subject: row.subject, snippet: row.preview }).needsReply;
}

export function toThreadRef(row: EnvelopeRow, now: number): ThreadRef {
  return {
    folder: row.path,
    uid: String(row.uid),
    messageId: row.messageId,
    subject: row.subject,
    from: person(row.from),
    date: new Date(row.date).toISOString(),
    ageHours: Math.round(((now - row.date) / HOUR) * 10) / 10,
  };
}

/** A human conversation partner — the only mail that can owe or be owed a reply. */
export function isPerson(row: EnrichedRow): boolean {
  return !row.auto && (row.category === "primary" || row.category === "other");
}

function threadKeys(rows: EnvelopeRow[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    let node = x;
    while (parent.has(node) && parent.get(node) !== root) {
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

  for (const row of rows) {
    if (row.threadId) continue;
    const ids = [row.messageId, row.inReplyTo, ...row.references].filter((x): x is string => Boolean(x));
    if (ids.length === 0) continue;
    if (!parent.has(ids[0]!)) parent.set(ids[0]!, ids[0]!);
    for (const id of ids.slice(1)) union(ids[0]!, id);
  }

  const keys = new Map<string, string>();
  for (const row of rows) {
    if (row.threadId) keys.set(row.id, `t:${row.threadId}`);
    else {
      const first = row.messageId ?? row.inReplyTo ?? row.references[0];
      keys.set(row.id, first ? `m:${find(first)}` : `r:${row.id}`);
    }
  }
  return keys;
}

/** Classify + localize every row once; shared by the Overview and Ask Jev retrieval. */
export function enrichSnapshot(snapshot: Snapshot, { now, tz }: { now: number; tz: string }) {
  const local = makeLocalizer(tz);
  const keyOf = threadKeys(snapshot.rows);
  const rows: EnrichedRow[] = snapshot.rows
    .filter((r) => r.date <= now)
    .map((r): EnrichedRow => {
      const triage = heuristicTriage({ subject: r.subject, snippet: r.preview, from: r.from.address });
      const auto = Boolean(r.listId || r.listUnsubscribe || r.autoSubmitted || r.bulk || isMachineAddress(r.from.address));
      // Keyword triage defaults to "primary"; machine mail is never person-to-person.
      const listish = Boolean(r.listId || r.listUnsubscribe || r.bulk);
      const category = auto && triage.category === "primary" ? (listish ? "newsletters" : "updates") : triage.category;
      return {
        ...r,
        auto,
        category,
        urgency: triage.urgency,
        bucket: bucketOf(auto, category, r),
        local: local(r.date),
        fromKey: lc(r.from.address),
        threadKey: keyOf.get(r.id) ?? r.id,
      };
    })
    .sort((a, b) => a.date - b.date);
  return { rows, local, today: local(now) };
}

export function computeOverview(snapshot: Snapshot, { now, tz, self }: ComputeOptions): Overview {
  const { rows, today } = enrichSnapshot(snapshot, { now, tz });
  const selfSet = new Set(self.map(lc));
  const dayKeys = windowDateKeys(today.dateKey, snapshot.days);
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));

  const inbound = rows.filter((r) => r.folder === "inbox");
  const sent = rows.filter((r) => r.folder === "sent");
  const ref = (row: EnvelopeRow): ThreadRef => toThreadRef(row, now);

  /* ── reply latency ── */
  const inboxById = new Map<string, EnrichedRow>();
  for (const r of inbound) if (r.messageId) inboxById.set(r.messageId, r);
  const sentById = new Map<string, EnrichedRow>();
  for (const s of sent) if (s.messageId) sentById.set(s.messageId, s);
  const sentByInReplyTo = new Map<string, EnrichedRow[]>();
  for (const s of sent) {
    if (!s.inReplyTo) continue;
    const list = sentByInReplyTo.get(s.inReplyTo) ?? [];
    list.push(s);
    sentByInReplyTo.set(s.inReplyTo, list);
  }

  const yours: number[] = [];
  const theirs: number[] = [];
  const yoursByContact = new Map<string, number[]>();
  const theirsByContact = new Map<string, number[]>();
  // People only: RSVPs and replies to bots take seconds and would flatter the median.
  for (const s of sent) {
    const original = s.inReplyTo ? inboxById.get(s.inReplyTo) : undefined;
    if (!original || !isPerson(original)) continue;
    const latency = (s.sentAt ?? s.date) - original.date;
    if (latency <= 0 || latency > OBLIGATION_WINDOW) continue;
    yours.push(latency);
    const list = yoursByContact.get(original.fromKey) ?? [];
    list.push(latency);
    yoursByContact.set(original.fromKey, list);
  }
  for (const r of inbound) {
    const original = r.inReplyTo ? sentById.get(r.inReplyTo) : undefined;
    if (!original || !isPerson(r)) continue;
    const latency = r.date - (original.sentAt ?? original.date);
    if (latency <= 0 || latency > 30 * DAY) continue;
    theirs.push(latency);
    const list = theirsByContact.get(r.fromKey) ?? [];
    list.push(latency);
    theirsByContact.set(r.fromKey, list);
  }

  /* ── threads + obligations ── */
  const threads = new Map<string, EnrichedRow[]>();
  for (const r of rows) {
    const list = threads.get(r.threadKey) ?? [];
    list.push(r);
    threads.set(r.threadKey, list);
  }

  const sentCountTo = new Map<string, number>();
  for (const s of sent) {
    for (const a of [...s.to, ...s.cc]) {
      const key = lc(a.address);
      if (!selfSet.has(key)) sentCountTo.set(key, (sentCountTo.get(key) ?? 0) + 1);
    }
  }
  const weightOf = (row: EnrichedRow) => ((sentCountTo.get(row.fromKey) ?? 0) >= 3 ? 1.5 : 1);

  const needsReplyAt = (cutoff: number): EnrichedRow[] => {
    const out: EnrichedRow[] = [];
    for (const thread of threads.values()) {
      let last: EnrichedRow | undefined;
      for (const r of thread) if (r.date <= cutoff) last = r;
      if (!last || last.folder !== "inbox" || !isPerson(last)) continue;
      if (!last.to.some((a) => selfSet.has(lc(a.address)))) continue;
      if (cutoff - last.date > OBLIGATION_WINDOW) continue;
      // \Answered only describes "now"; past cutoffs rely on dated Sent replies.
      if (cutoff >= now && last.answered) continue;
      const replies = last.messageId ? sentByInReplyTo.get(last.messageId) : undefined;
      if (replies?.some((s) => s.date <= cutoff)) continue;
      out.push(last);
    }
    return out;
  };

  const needs = needsReplyAt(now).sort((a, b) => a.date - b.date);
  const needsIds = new Set(needs.map((r) => r.id));
  const debt = (list: EnrichedRow[], at: number) =>
    list.reduce((sum, r) => sum + ((at - r.date) / HOUR) * weightOf(r), 0);
  const replyDebtHours = Math.round(debt(needs, now));
  const prevCutoff = now - 7 * DAY;
  const replyDebtPrevHours = Math.round(debt(needsReplyAt(prevCutoff), prevCutoff));
  const byWeightedAge = [...needs].sort((a, b) => (now - b.date) * weightOf(b) - (now - a.date) * weightOf(a));
  const payoffRows = byWeightedAge.slice(0, 3);
  const payoffShare = replyDebtHours > 0 ? Math.round((debt(payoffRows, now) / debt(needs, now)) * 100) : 0;

  const waiting: WaitingRef[] = [];
  for (const thread of threads.values()) {
    const last = thread[thread.length - 1]!;
    if (last.folder !== "sent") continue;
    const humans = [...last.to, ...last.cc].filter(
      (a) => a.address && !selfSet.has(lc(a.address)) && !isMachineAddress(a.address),
    );
    if (humans.length === 0 || !expectsReply(last)) continue;
    const age = now - (last.sentAt ?? last.date);
    if (age > OBLIGATION_WINDOW) continue;
    const primary = last.to.find((a) => humans.includes(a)) ?? humans[0]!;
    const baselineMs = median(theirsByContact.get(lc(primary.address)) ?? []);
    const threshold = Math.max(48 * HOUR, baselineMs === null ? 0 : 3 * baselineMs);
    if (age < threshold) continue;
    waiting.push({
      ...ref(last),
      to: person(primary),
      baselineHours: baselineMs === null ? null : Math.round((baselineMs / HOUR) * 10) / 10,
    });
  }
  waiting.sort((a, b) => b.ageHours - a.ageHours);

  /* ── hot threads: the busiest human conversations this week ── */
  const weekAgo = now - 7 * DAY;
  const hotThreads: HotThread[] = [];
  for (const thread of threads.values()) {
    const recent = thread.filter((r) => r.date >= weekAgo);
    if (recent.length < 2) continue;
    const people = new Map<string, string>();
    for (const r of thread) {
      if (r.folder === "inbox" && isPerson(r)) people.set(r.fromKey, person(r.from).name);
    }
    if (people.size === 0) continue;
    const latest = thread[thread.length - 1]!;
    hotThreads.push({ ...ref(latest), messages: recent.length, people: [...people.values()] });
  }
  hotThreads.sort((a, b) => b.messages - a.messages || a.ageHours - b.ageHours);

  /* ── volume ── */
  const received = new Array<number>(dayKeys.length).fill(0);
  const sentDaily = new Array<number>(dayKeys.length).fill(0);
  for (const r of rows) {
    const idx = dayIndex.get(r.local.dateKey);
    if (idx === undefined) continue;
    if (r.folder === "inbox") received[idx]! += 1;
    else sentDaily[idx]! += 1;
  }
  const sumRange = (arr: number[], from: number, to: number) =>
    arr.slice(Math.max(0, from), Math.max(0, to)).reduce((s, n) => s + n, 0);
  const n = dayKeys.length;

  /* ── rhythm (human arrivals only) ── */
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const humanMinutes: number[] = [];
  for (const r of inbound) {
    if (r.bucket !== "people") continue;
    heat[r.local.weekday]![r.local.hour]! += 1;
    humanMinutes.push(r.local.hour * 60 + r.local.minute);
  }
  const { checkTimes, coverage } = pickCheckTimes(humanMinutes);
  let busiest: { weekday: number; hour: number } | null = null;
  let busiestCount = 0;
  heat.forEach((hours, weekday) =>
    hours.forEach((count, hour) => {
      if (count > busiestCount) {
        busiestCount = count;
        busiest = { weekday, hour };
      }
    }),
  );

  /* ── mix + categories ── */
  const mixMap = new Map<MixBucket, { count: number; unread: number }>();
  const categoryMap = new Map<TriageCategory, number>();
  for (const r of inbound) {
    const m = mixMap.get(r.bucket) ?? { count: 0, unread: 0 };
    m.count += 1;
    if (!r.seen) m.unread += 1;
    mixMap.set(r.bucket, m);
    categoryMap.set(r.category, (categoryMap.get(r.category) ?? 0) + 1);
  }
  const MIX_ORDER: MixBucket[] = ["people", "notifications", "newsletters", "transactions"];

  /* ── senders ── */
  const groups = new Map<string, EnrichedRow[]>();
  for (const r of inbound) {
    if (!r.fromKey) continue;
    const list = groups.get(r.fromKey) ?? [];
    list.push(r);
    groups.set(r.fromKey, list);
  }
  const needsByContact = new Map<string, number>();
  for (const r of needs) needsByContact.set(r.fromKey, (needsByContact.get(r.fromKey) ?? 0) + 1);

  const allSenders: SenderStat[] = [...groups.entries()].map(([address, list]) => {
    const newest = list[list.length - 1]!;
    const daily = new Array<number>(n).fill(0);
    const weekly = [0, 0, 0, 0];
    for (const r of list) {
      const idx = dayIndex.get(r.local.dateKey);
      if (idx !== undefined) daily[idx]! += 1;
      const ago = dayDiff(r.local.dateKey, today.dateKey);
      if (ago >= 0 && ago < 28) weekly[3 - Math.floor(ago / 7)]! += 1;
    }
    const yoursMed = median(yoursByContact.get(address) ?? []);
    const theirsMed = median(theirsByContact.get(address) ?? []);
    const named = [...list].reverse().find((r) => r.from.name)?.from.name;
    const tzRow = [...list].reverse().find((r) => r.tzOffsetMin !== undefined);
    return {
      address: newest.from.address,
      name: named || prettyName(address),
      domain: address.split("@")[1] ?? "",
      category: mode(list.map((r) => r.category)),
      bucket: mode(list.map((r) => r.bucket)),
      count: list.length,
      unread: list.filter((r) => !r.seen).length,
      sentToThem: sentCountTo.get(address) ?? 0,
      lastAt: new Date(newest.date).toISOString(),
      daily,
      weekly,
      yourReplyMedianMin: yoursMed === null ? null : Math.round(yoursMed / 60_000),
      theirReplyMedianMin: theirsMed === null ? null : Math.round(theirsMed / 60_000),
      needsReply: needsByContact.get(address) ?? 0,
      tzOffsetMin: tzRow?.tzOffsetMin,
      recent: [...list].reverse().slice(0, 5).map(ref),
    };
  });
  // Relationships outrank volume: a person counts triple against a daily digest.
  const senders = allSenders
    .sort((a, b) => b.count * (b.bucket === "people" ? 3 : 1) - a.count * (a.bucket === "people" ? 3 : 1))
    .slice(0, 24)
    .sort((a, b) => b.count - a.count);

  /* ── newsletters ── */
  const lists = new Map<string, EnrichedRow[]>();
  for (const r of inbound) {
    if (!r.listId && !r.listUnsubscribe) continue;
    const key = r.listId ? lc(r.listId.replace(/^.*<|>.*$/g, "")) : r.fromKey;
    const list = lists.get(key) ?? [];
    list.push(r);
    lists.set(key, list);
  }
  const listsPerSender = new Map<string, number>();
  for (const list of lists.values()) {
    const from = list[0]!.fromKey;
    listsPerSender.set(from, (listsPerSender.get(from) ?? 0) + 1);
  }
  // Uncapped: the radar counts rarely-opened lists and Ask narrows by name, so every list must be here.
  const newsletters: NewsletterStat[] = [...lists.entries()]
    .map(([key, list]) => {
      const newest = list[list.length - 1]!;
      // GitHub, Google Groups and the like: one sender address fronts many lists, or posters vary per issue.
      // There the sender's name is just whoever wrote last; the List-Id phrase names the list itself.
      const shared =
        (listsPerSender.get(newest.fromKey) ?? 0) > 1 || new Set(list.map((r) => r.from.name ?? r.fromKey)).size > 1;
      const label = shared ? listLabel(newest.listId) : undefined;
      const opened = list.filter((r) => r.seen);
      const openRate = opened.length / list.length;
      const grade: NewsletterStat["grade"] =
        openRate >= 0.6 ? "A" : openRate >= 0.4 ? "B" : openRate >= 0.2 ? "C" : openRate >= 0.05 ? "D" : "F";
      const lastOpened = opened[opened.length - 1];
      return {
        key,
        name: label || newest.from.name || prettyName(newest.from.address),
        address: newest.from.address,
        issues: list.length,
        issuesPerMonth: Math.round((list.length / snapshot.days) * 30 * 10) / 10,
        opened: opened.length,
        openRate: Math.round(openRate * 100) / 100,
        lastOpenedAt: lastOpened ? new Date(lastOpened.date).toISOString() : undefined,
        lastIssueAt: new Date(newest.date).toISOString(),
        grade,
        unsubscribe: parseListUnsubscribe(newest.listUnsubscribe),
      };
    })
    .sort((a, b) => a.openRate - b.openRate || b.issues - a.issues);

  /* ── attachments ── */
  const withFiles = rows.filter((r) => r.hasAttachments);
  const attachments = {
    count: withFiles.length,
    bytes: withFiles.reduce((s, r) => s + r.attachmentBytes, 0),
    largest: [...withFiles]
      .sort((a, b) => b.attachmentBytes - a.attachmentBytes)
      .slice(0, 5)
      .map((r) => ({ ...ref(r), bytes: r.attachmentBytes })),
  };

  /* ── today ── */
  const todays = inbound.filter((r) => r.local.dateKey === today.dateKey);
  const urgentToday = todays.filter((r) => r.urgency >= 0.66 && r.bucket !== "newsletters").length;

  /* ── weather: today's pace vs the same weekday, same hour ── */
  const sameWeekdayKeys = dayKeys.filter(
    (k) => k !== today.dateKey && dayDiff(k, today.dateKey) % 7 === 0,
  );
  const sameWeekday = new Set(sameWeekdayKeys);
  const byNowPast = inbound.filter(
    (r) =>
      sameWeekday.has(r.local.dateKey) &&
      r.local.hour * 60 + r.local.minute <= today.hour * 60 + today.minute,
  ).length;
  const typicalByNow = sameWeekdayKeys.length ? byNowPast / sameWeekdayKeys.length : 0;
  const paceRatio = sameWeekdayKeys.length && typicalByNow >= 1 ? todays.length / typicalByNow : null;
  const perHour = new Array<number>(24).fill(0);
  for (const r of inbound) if (sameWeekday.has(r.local.dateKey)) perHour[r.local.hour]! += 1;
  let front: string | null = null;
  if (sameWeekdayKeys.length) {
    let bestHour = -1;
    let best = 0;
    for (let h = 6; h < 22; h++) {
      const avg = (perHour[h]! + perHour[h + 1]!) / sameWeekdayKeys.length;
      if (avg > best) {
        best = avg;
        bestHour = h;
      }
    }
    if (bestHour >= 0 && best >= 3) front = `${formatHour(bestHour)}–${formatHour(bestHour + 2)}`;
  }
  const weather = inboxWeather({
    needsReply: needs.length,
    oldestNeedsReplyHours: needs.length ? (now - needs[0]!.date) / HOUR : 0,
    urgentToday,
    waitingOn: waiting.length,
    paceRatio,
    weekdayName: WEEKDAY_NAMES[today.weekday]!,
    front,
  });

  /* ── daily brief (free heuristic; Deep triage upgrades it with Jev) ── */
  const brief: BriefItem[] = inbound
    .filter((r) => now - r.date <= 72 * HOUR && (r.flagged || (r.bucket !== "newsletters" && !r.auto)))
    .map((r) => {
      const needsReply = needsIds.has(r.id);
      const reciprocal = (sentCountTo.get(r.fromKey) ?? 0) >= 3;
      const recency = Math.max(0, 1 - (now - r.date) / (72 * HOUR));
      let score = 0.4 * r.urgency + 0.3 * (needsReply ? 1 : 0) + 0.15 * (r.flagged ? 1 : 0) + 0.1 * (reciprocal ? 1 : 0) + 0.05 * recency;
      if (r.auto) score *= 0.5;
      const why = [
        needsReply ? "Needs your reply" : null,
        r.flagged ? "Flagged" : null,
        r.urgency >= 0.66 ? "Time-sensitive" : null,
        reciprocal ? "You write to them often" : null,
        agoLabel(now - r.date),
      ].filter((x): x is string => Boolean(x));
      return {
        ...ref(r),
        score: Math.round(score * 100) / 100,
        why,
        category: r.category,
        urgency: r.urgency,
        needsReply,
        preview: r.preview,
        source: "heuristic" as const,
      };
    })
    .filter((b) => b.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const invites = inbound
    .filter((r) => r.hasCalendar && now - r.date <= OBLIGATION_WINDOW)
    .reverse()
    .slice(0, 5)
    .map(ref);

  return {
    v: 1,
    generatedAt: new Date(now).toISOString(),
    syncedAt: new Date(snapshot.fetchedAt).toISOString(),
    days: snapshot.days,
    tz,
    truncated: snapshot.truncated,
    kpis: {
      unread: snapshot.inbox.unseen,
      needsReply: needs.length,
      waitingOn: waiting.length,
      urgentToday,
      receivedToday: todays.length,
    },
    obligations: {
      needsReply: needs.map(ref),
      waitingOn: waiting,
      replyDebtHours,
      replyDebtPrevHours,
      payoff: { refs: payoffRows.map(ref), sharePct: payoffShare },
    },
    volume: {
      days: dayKeys.map((date, i) => ({ date, received: received[i]!, sent: sentDaily[i]! })),
      receivedThisWeek: sumRange(received, n - 7, n),
      receivedLastWeek: sumRange(received, n - 14, n - 7),
      sentThisWeek: sumRange(sentDaily, n - 7, n),
      sentLastWeek: sumRange(sentDaily, n - 14, n - 7),
    },
    rhythm: {
      heat,
      checkTimes,
      checkCoverage: coverage,
      focusWindows: focusWindows(checkTimes),
      busiest,
    },
    replyTimes: { yours: replyStat(yours), theirs: replyStat(theirs) },
    mix: MIX_ORDER.map((bucket) => ({ bucket, ...(mixMap.get(bucket) ?? { count: 0, unread: 0 }) })),
    hotThreads: hotThreads.slice(0, 5),
    categories: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    senders,
    newsletters,
    attachments,
    quota: snapshot.quota,
    weather,
    brief,
    invites,
    today: { needsReplyZero: needs.length === 0, unreadZero: snapshot.inbox.unseen === 0 },
  };
}

export { formatHour };

function agoLabel(ms: number): string {
  const hours = ms / HOUR;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Greedy set cover over minute-of-day arrivals: a check at hour c "catches" mail
 * that arrived in the two hours before it. Stops at 80% coverage or 3 checks.
 */
export function pickCheckTimes(arrivalMinutes: number[]): { checkTimes: number[]; coverage: number } {
  if (arrivalMinutes.length === 0) return { checkTimes: [], coverage: 0 };
  const caught = new Array<boolean>(arrivalMinutes.length).fill(false);
  const picks: number[] = [];
  let covered = 0;
  while (picks.length < 3 && covered / arrivalMinutes.length < 0.8) {
    let bestHour = -1;
    let bestGain = 0;
    for (let c = 7; c <= 20; c++) {
      if (picks.includes(c)) continue;
      let gain = 0;
      arrivalMinutes.forEach((t, i) => {
        const wait = c * 60 - t;
        if (!caught[i] && wait >= 0 && wait <= 120) gain += 1;
      });
      if (gain > bestGain) {
        bestGain = gain;
        bestHour = c;
      }
    }
    if (bestHour < 0) break;
    picks.push(bestHour);
    arrivalMinutes.forEach((t, i) => {
      const wait = bestHour * 60 - t;
      if (!caught[i] && wait >= 0 && wait <= 120) {
        caught[i] = true;
        covered += 1;
      }
    });
  }
  return {
    checkTimes: picks.sort((a, b) => a - b),
    coverage: Math.round((covered / arrivalMinutes.length) * 100) / 100,
  };
}

/** Uninterrupted stretches between check-ins inside an 8–18 workday, ≥2h. */
export function focusWindows(checkTimes: number[]): { start: number; end: number }[] {
  const stops = [...checkTimes, 18];
  const out: { start: number; end: number }[] = [];
  let cursor = 8;
  for (const stop of stops) {
    if (stop - cursor >= 2) out.push({ start: cursor, end: stop });
    cursor = Math.max(cursor, stop + 1);
  }
  return out;
}
