import { isPerson, toThreadRef, type EnrichedRow } from "@/lib/insights/metrics";
import { formatHour, WEEKDAY_NAMES, type LocalParts } from "@/lib/insights/bins";
import { matchesTimeframe, timeframeLabel } from "@/lib/jev/ask/timeframe";
import { formatAge, formatBytes, formatDuration, plural } from "@/lib/jev/ask/format";
import type { Overview, ThreadRef } from "@/lib/insights/types";
import type { AskAnswer, AskPlan, Evidence } from "@/lib/jev/ask/types";
import { parseQuery, scoreTerms, searchText, type TextField } from "@/lib/search/text";

export type AskContext = {
  now: number;
  today: LocalParts;
  local: (epoch: number) => LocalParts;
  rows: EnrichedRow[];
  overview: Overview;
  /** Mailbox-wide keyword hits beyond the 30-day window (find_topic only). */
  extraRows: EnrichedRow[];
  question: string;
};

export type Ranked = { row: EnrichedRow; score?: number; low?: boolean };

export type Composed = Pick<AskAnswer, "headline" | "sentence" | "evidence" | "viz" | "stats" | "openInMail" | "empty">;

export type Execution = {
  /** Rows the ranker may reorder (already in heuristic order). */
  candidates: EnrichedRow[];
  rankable: boolean;
  compose: (ranked: Ranked[]) => Composed;
};

const MAX_EVIDENCE = 8;
const SECURITY = /\b(security|sign[- ]?in|signed in|log[- ]?in|password|2fa|two-factor|verification code|verify|suspicious|new device)\b/i;
const MEETING = /\b(invite|invitation|meeting|calendar|event|webinar|call|zoom|meet)\b/i;

const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

function evidence(row: EnrichedRow, now: number, extra: Partial<Evidence> = {}): Evidence {
  return { ...toThreadRef(row, now), preview: row.preview, ...extra };
}

function refEvidence(ref: ThreadRef, extra: Partial<Evidence> = {}): Evidence {
  return { ...ref, ...extra };
}

function inScope(row: EnrichedRow, plan: AskPlan): boolean {
  if (plan.scope === "all") return true;
  return row.folder === (plan.scope === "sent" ? "sent" : "inbox");
}

function withSender(row: EnrichedRow, plan: AskPlan): boolean {
  if (!plan.sender) return true;
  const target = lc(plan.sender.address);
  if (row.folder === "inbox") return lc(row.from.address) === target;
  return [...row.to, ...row.cc].some((a) => lc(a.address) === target);
}

function base(plan: AskPlan, ctx: AskContext, rows = ctx.rows): EnrichedRow[] {
  return rows.filter(
    (r) =>
      inScope(r, plan) &&
      matchesTimeframe(r.local.dateKey, ctx.today, plan.timeframe) &&
      (!plan.unreadOnly || !r.seen) &&
      withSender(r, plan),
  );
}

/** Narrow a list intent's items by the typed filter, keeping the intent's own order. */
function narrow<T>(items: T[], filter: string | undefined, fieldsOf: (item: T) => TextField[]): T[] {
  if (!filter) return items;
  const hits = new Set(searchText(items, filter, fieldsOf).map((hit) => hit.item));
  return items.filter((item) => hits.has(item));
}

const refFields = (ref: ThreadRef): TextField[] => [
  { text: ref.subject, weight: 4, key: "subject" },
  { text: `${ref.from.name} ${ref.from.address}`, weight: 3, key: "from" },
];

const matching = (filter: string | undefined) => (filter ? ` matching “${filter}”` : "");

const newestFirst = (a: EnrichedRow, b: EnrichedRow) => b.date - a.date;
const refInFrame = (ref: ThreadRef, plan: AskPlan, ctx: AskContext) =>
  matchesTimeframe(ctx.local(Date.parse(ref.date)).dateKey, ctx.today, plan.timeframe);

function staticExecution(compose: () => Composed): Execution {
  return { candidates: [], rankable: false, compose: () => compose() };
}

function listAnswer(
  rows: Ranked[],
  ctx: AskContext,
  make: (count: number, top: Ranked | undefined) => { headline: string; sentence: string },
  extra: (r: Ranked) => Partial<Evidence> = () => ({}),
): Composed {
  const { headline, sentence } = make(rows.length, rows[0]);
  return {
    headline,
    sentence,
    evidence: rows.slice(0, MAX_EVIDENCE).map((r) =>
      evidence(r.row, ctx.now, { score: r.score, lowConfidence: r.low, ...extra(r) }),
    ),
    empty: rows.length === 0,
  };
}

/** Subject carries most signal; people next (sender for inbox, recipients for sent — mirrors `withSender`). */
function rowFields(row: EnrichedRow): TextField[] {
  const inbox = row.folder === "inbox";
  const people = inbox ? [row.from] : [...row.to, ...row.cc];
  return [
    { text: row.subject, weight: 4, key: "subject" },
    { text: people.map((p) => `${p.name ?? ""} ${p.address}`).join(" "), weight: 3, key: inbox ? "from" : "to" },
    { text: row.preview ?? "", weight: 2 },
  ];
}

export function execute(plan: AskPlan, ctx: AskContext): Execution {
  const { overview, now } = ctx;
  const tf = timeframeLabel(plan.timeframe);

  switch (plan.intent) {
    case "needs_reply":
      return staticExecution(() => {
        const list = narrow(
          overview.obligations.needsReply.filter(
            (r) => (!plan.sender || lc(r.from.address) === lc(plan.sender.address)) && refInFrame(r, plan, ctx),
          ),
          plan.filter,
          refFields,
        );
        const oldest = list[0];
        return {
          headline: list.length
            ? `${list.length} ${plural(list.length, "thread needs", "threads need")} your reply${matching(plan.filter)}`
            : plan.filter
              ? `Nothing matching “${plan.filter}” needs your reply`
              : "Nobody’s waiting on you",
          sentence: oldest
            ? `Oldest: ${oldest.from.name}, ${formatAge(oldest.ageHours)} — “${oldest.subject}”.`
            : plan.filter
              ? "I checked subjects and senders of threads waiting on you."
              : "Every human thread addressed to you has an answer.",
          evidence: list.slice(0, MAX_EVIDENCE).map((r) =>
            refEvidence(r, { badge: `${formatAge(r.ageHours)} waiting`, critical: r.ageHours > 72 }),
          ),
          stats: list.length
            ? [
                { label: "Reply debt", value: `${overview.obligations.replyDebtHours}h` },
                { label: "Last week", value: `${overview.obligations.replyDebtPrevHours}h` },
              ]
            : undefined,
          empty: list.length === 0,
        };
      });

    case "awaiting_others":
      return staticExecution(() => {
        const list = overview.obligations.waitingOn.filter(
          (w) => (!plan.sender || lc(w.to.address) === lc(plan.sender.address)) && refInFrame(w, plan, ctx),
        );
        const people = new Set(list.map((w) => lc(w.to.address))).size;
        const top = list[0];
        return {
          headline: list.length
            ? `${people} ${plural(people, "person owes", "people owe")} you a reply`
            : "Nobody owes you a reply",
          sentence: top
            ? `Longest silence: ${top.to.name}, ${formatAge(top.ageHours)}${
                top.baselineHours ? ` — they usually answer in ${formatDuration(top.baselineHours * 60)}` : ""
              }.`
            : "Every message you sent that asked for something got an answer.",
          evidence: list.slice(0, MAX_EVIDENCE).map((w) =>
            refEvidence(w, {
              from: w.to,
              badge: `${formatAge(w.ageHours)} silent`,
              critical: w.ageHours > 120,
            }),
          ),
          empty: list.length === 0,
        };
      });

    case "urgent": {
      const rows = base(plan, ctx)
        .filter((r) => r.folder === "inbox" && r.bucket !== "newsletters" && (r.urgency >= 0.5 || r.flagged))
        .sort((a, b) => b.urgency - a.urgency || newestFirst(a, b));
      return {
        candidates: rows,
        rankable: rows.length > 3,
        compose: (ranked) =>
          listAnswer(
            ranked,
            ctx,
            (n, top) => ({
              headline: n ? `${n} time-sensitive ${plural(n, "email")} ${tf}` : `Nothing urgent ${tf}`,
              sentence: top
                ? `Most pressing: “${top.row.subject}” from ${top.row.from.name || top.row.from.address}.`
                : "No deadlines, alerts, or flagged mail in that window.",
            }),
            (r) => ({ critical: r.row.urgency >= 0.66, badge: r.row.flagged ? "Flagged" : undefined }),
          ),
      };
    }

    case "from_person": {
      if (!plan.sender) {
        return staticExecution(() => ({
          headline: "Who do you mean?",
          sentence: "I couldn’t match that to anyone in your last 30 days of mail. Try their name or address.",
          evidence: [],
          empty: true,
        }));
      }
      const sender = plan.sender;
      const terms = parseQuery(plan.keywords);
      const scores = new Map(base(plan, ctx).map((r) => [r, scoreTerms(terms, rowFields(r))]));
      const rows = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || newestFirst(a, b));
      const stat = overview.senders.find((s) => lc(s.address) === lc(sender.address));
      return {
        candidates: rows,
        rankable: plan.keywords.length > 0 && rows.length > 3,
        compose: (ranked) => {
          const unread = ranked.filter((r) => !r.row.seen).length;
          const composed = listAnswer(ranked, ctx, (n, top) => ({
            headline: `${n} ${plural(n, "email")} ${plan.scope === "sent" ? "to" : "from"} ${sender.name} ${tf}`,
            sentence: top
              ? [
                  unread ? `${unread} unread` : "All opened",
                  `latest ${formatAge((now - top.row.date) / 3_600_000)} ago`,
                  stat?.yourReplyMedianMin != null ? `you usually reply in ${formatDuration(stat.yourReplyMedianMin)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : `Nothing ${plan.scope === "sent" ? "to" : "from"} ${sender.name} in that window.`,
          }));
          return { ...composed, openInMail: `/mail?${new URLSearchParams({ q: sender.address })}` };
        },
      };
    }

    case "find_topic":
    case "other": {
      const keywords = plan.keywords;
      if (keywords.length === 0) {
        return staticExecution(() => ({
          headline: "Not sure what you’re after",
          sentence: "Pick one of the suggestions below, or name a person, topic, or time range.",
          evidence: [],
          empty: true,
        }));
      }
      const seen = new Set<string>();
      const unique = [...base(plan, ctx), ...ctx.extraRows].filter((r) => {
        const key = r.messageId ?? `${r.path}:${r.uid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const pool = searchText(unique, keywords, rowFields)
        .sort((a, b) => b.score - a.score || newestFirst(a.item, b.item))
        .slice(0, 200)
        .map((h) => h.item);
      const phrase = keywords.join(" ");
      return {
        candidates: pool,
        rankable: pool.length > 1,
        compose: (ranked) => {
          const composed = listAnswer(ranked, ctx, (n, top) => ({
            headline: n
              ? top?.low
                ? `Nothing clearly about “${phrase}”`
                : `${n} ${plural(n, "email")} about “${phrase}”`
              : `Nothing matches “${phrase}”`,
            sentence: top
              ? top.low
                ? "These are the closest I found — take them with a grain of salt."
                : `Best match: “${top.row.subject}” from ${top.row.from.name || top.row.from.address}, ${formatAge((now - top.row.date) / 3_600_000)} ago.`
              : "I searched subjects, senders, and previews. Try a different word or a person’s name.",
          }));
          return { ...composed, openInMail: `/mail?${new URLSearchParams({ q: phrase })}` };
        },
      };
    }

    case "unread_summary": {
      const rows = base({ ...plan, unreadOnly: true }, ctx)
        .filter((r) => r.folder === "inbox")
        .sort((a, b) => Number(isPerson(b)) - Number(isPerson(a)) || b.urgency - a.urgency || newestFirst(a, b));
      const counts = { people: 0, notifications: 0, newsletters: 0, transactions: 0 };
      for (const r of rows) counts[r.bucket] += 1;
      return {
        candidates: rows,
        rankable: rows.length > MAX_EVIDENCE,
        compose: (ranked) =>
          listAnswer(ranked, ctx, (n) => ({
            headline: n ? `${n} unread ${tf}` : `You’re caught up ${tf === "any time" ? "" : tf}`.trim(),
            sentence: n
              ? [
                  counts.people && `${counts.people} from people`,
                  counts.notifications && `${counts.notifications} ${plural(counts.notifications, "notification")}`,
                  counts.newsletters && `${counts.newsletters} ${plural(counts.newsletters, "newsletter")}`,
                  counts.transactions && `${counts.transactions} ${plural(counts.transactions, "receipt")}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Nothing new is waiting.",
          })),
      };
    }

    case "attachments": {
      const rows = base(plan, ctx).filter((r) => r.hasAttachments).sort(newestFirst);
      const total = rows.reduce((s, r) => s + r.attachmentBytes, 0);
      const largest = [...rows].sort((a, b) => b.attachmentBytes - a.attachmentBytes)[0];
      return {
        candidates: rows,
        rankable: false,
        compose: (ranked) =>
          listAnswer(
            ranked,
            ctx,
            (n) => ({
              headline: n ? `${n} ${plural(n, "email")} with attachments ${tf}` : `No attachments ${tf}`,
              sentence: largest
                ? `${formatBytes(total)} in total · largest: “${largest.subject}” (${formatBytes(largest.attachmentBytes)}).`
                : "Nothing with files in that window.",
            }),
            (r) => ({ badge: formatBytes(r.row.attachmentBytes) }),
          ),
      };
    }

    case "receipts": {
      const rows = base(plan, ctx)
        .filter((r) => r.folder === "inbox" && (r.bucket === "transactions" || r.category === "receipts"))
        .sort(newestFirst);
      const bySender = new Map<string, number>();
      for (const r of rows) {
        const name = r.from.name || r.from.address;
        bySender.set(name, (bySender.get(name) ?? 0) + 1);
      }
      const top = [...bySender.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
      return {
        candidates: rows,
        rankable: false,
        compose: (ranked) =>
          listAnswer(ranked, ctx, (n) => ({
            headline: n ? `${n} ${plural(n, "receipt")} ${tf}` : `No receipts ${tf}`,
            sentence: n ? `Mostly from ${top.join(", ")}.` : "No invoices, orders, or payment confirmations in that window.",
          })),
      };
    }

    case "newsletters":
      return staticExecution(() => {
        const lists = narrow(overview.newsletters, plan.filter, (l) => [
          { text: l.name, weight: 4, key: "from" },
          { text: `${l.address} ${l.key}`, weight: 3 },
        ]);
        const rare = lists.filter((l) => l.grade === "D" || l.grade === "F");
        const worst = lists[0];
        const latest = (key: string) =>
          ctx.rows
            .filter((r) => r.folder === "inbox" && (r.listId ? lc(r.listId.replace(/^.*<|>.*$/g, "")) === key : lc(r.from.address) === key))
            .sort(newestFirst)[0];
        return {
          headline: lists.length
            ? `${lists.length} ${plural(lists.length, "newsletter")}${matching(plan.filter)} · ${rare.length} you rarely open`
            : plan.filter
              ? `No newsletters matching “${plan.filter}”`
              : "No newsletters in the last 30 days",
          sentence: worst
            ? `${worst.name}: opened ${Math.round(worst.openRate * 100)}% of ${worst.issues} ${plural(worst.issues, "issue")}.`
            : plan.filter
              ? "I checked list names and sender addresses."
              : "Your inbox is refreshingly list-free.",
          evidence: rare.slice(0, MAX_EVIDENCE).flatMap((l) => {
            const row = latest(l.key);
            return row ? [evidence(row, now, { badge: `Grade ${l.grade}` })] : [];
          }),
          stats: lists.slice(0, 4).map((l) => ({ label: l.name, value: `${l.grade} · ${Math.round(l.openRate * 100)}%` })),
          empty: lists.length === 0,
        };
      });

    case "volume_stats":
      return staticExecution(() => {
        const days = overview.volume.days;
        const span = plan.timeframe === "today" ? 1 : plan.timeframe === "yesterday" ? 2 : plan.timeframe === "last_30_days" || plan.timeframe === "this_month" || plan.timeframe === "any" ? 30 : 7;
        const window = days.slice(-span);
        const received = window.reduce((s, d) => s + d.received, 0);
        const sent = window.reduce((s, d) => s + d.sent, 0);
        const prev = days.slice(-2 * span, -span).reduce((s, d) => s + d.received, 0);
        const delta = prev ? Math.round(((received - prev) / prev) * 100) : null;
        const busiest = overview.rhythm.busiest;
        return {
          headline: `${received} received · ${sent} sent ${tf}`,
          sentence: [
            delta === null ? null : `${delta >= 0 ? "Up" : "Down"} ${Math.abs(delta)}% on the period before`,
            busiest ? `people write most on ${WEEKDAY_NAMES[busiest.weekday]}s around ${formatHour(busiest.hour)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          viz: {
            kind: "bars",
            label: `Received per day, ${tf}`,
            points: window.map((d) => ({ label: d.date.slice(5), value: d.received })),
          },
          evidence: [],
          empty: false,
        };
      });

    case "response_time":
      return staticExecution(() => {
        const { yours, theirs } = overview.replyTimes;
        const stat = plan.sender ? overview.senders.find((s) => lc(s.address) === lc(plan.sender!.address)) : undefined;
        if (stat) {
          return {
            headline: `You reply to ${stat.name} in ${formatDuration(stat.yourReplyMedianMin)}`,
            sentence: `${stat.name} answers you in ${formatDuration(stat.theirReplyMedianMin)} · ${stat.count} ${plural(stat.count, "email")} in 30 days.`,
            evidence: stat.recent.slice(0, 4).map((r) => refEvidence(r)),
            empty: false,
          };
        }
        return {
          headline: yours.medianMin === null ? "Not enough replies to measure yet" : `You reply in ${formatDuration(yours.medianMin)}`,
          sentence:
            yours.medianMin === null
              ? "Reply to a few threads and I’ll learn your pace."
              : `Median over ${yours.samples} ${plural(yours.samples, "reply", "replies")} · 90% within ${formatDuration(yours.p90Min)} · people answer you in ${formatDuration(theirs.medianMin)}.`,
          stats: [
            { label: "Your median", value: formatDuration(yours.medianMin) },
            { label: "Your 90th %", value: formatDuration(yours.p90Min) },
            { label: "Their median", value: formatDuration(theirs.medianMin) },
          ],
          evidence: [],
          empty: yours.medianMin === null,
        };
      });

    case "top_contacts":
      return staticExecution(() => {
        const people = overview.senders.filter((s) => s.bucket === "people");
        const ranked = (people.length ? people : overview.senders).slice(0, 8);
        const top = ranked[0];
        return {
          headline: top ? `${top.name} writes to you most` : "No regular correspondents yet",
          sentence: top
            ? `${top.count} ${plural(top.count, "email")} in 30 days · you wrote back ${top.sentToThem} ${plural(top.sentToThem, "time")}.`
            : "Once people write in, they’ll show up here.",
          viz: { kind: "bars", label: "Emails from each person, last 30 days", points: ranked.map((s) => ({ label: s.name, value: s.count })) },
          evidence: top ? top.recent.slice(0, 3).map((r) => refEvidence(r)) : [],
          empty: !top,
        };
      });

    case "meetings": {
      const rows = base(plan, ctx)
        .filter((r) => r.folder === "inbox" && (r.hasCalendar || MEETING.test(r.subject)))
        .sort(newestFirst);
      return {
        candidates: rows,
        rankable: false,
        compose: (ranked) =>
          listAnswer(
            ranked,
            ctx,
            (n, top) => ({
              headline: n ? `${n} meeting ${plural(n, "email")} ${tf}` : `No meeting invites ${tf}`,
              sentence: top ? `Latest: “${top.row.subject}”.` : "No calendar invites or scheduling threads in that window.",
            }),
            (r) => ({ badge: r.row.hasCalendar ? "Invite" : undefined }),
          ),
      };
    }

    case "security": {
      const rows = base(plan, ctx)
        .filter((r) => r.folder === "inbox" && SECURITY.test(`${r.subject} ${r.preview ?? ""}`))
        .sort(newestFirst);
      return {
        candidates: rows,
        rankable: false,
        compose: (ranked) =>
          listAnswer(
            ranked,
            ctx,
            (n, top) => ({
              headline: n ? `${n} security ${plural(n, "alert")} ${tf}` : `No security alerts ${tf}`,
              sentence: top ? `Latest: “${top.row.subject}” from ${top.row.from.name || top.row.from.address}.` : "No sign-in, password, or verification mail in that window.",
            }),
            (r) => ({ critical: !r.row.seen, badge: r.row.seen ? undefined : "Unread" }),
          ),
      };
    }

    case "help":
      return staticExecution(() => ({
        headline: "Here’s what I can find",
        sentence:
          "I read your last 30 days of Inbox and Sent. Ask about replies you owe, who owes you, urgent mail, a person, a topic, receipts, newsletters, files, meetings, or how fast you reply.",
        evidence: [],
        empty: false,
      }));
  }
}
