import { describe, expect, test } from "bun:test";
import { computeOverview, enrichSnapshot } from "@/lib/insights/metrics";
import { execute, type AskContext } from "@/lib/jev/ask/retrieve";
import { forcePlan, heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { smartChips } from "@/lib/jev/ask/chips";
import type { EnvelopeRow, Snapshot } from "@/lib/insights/types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 15, 0);
const ME = { address: "me@raven.dev", name: "Me" };
const maya = { name: "Maya Chen", address: "maya@northwind.example" };

let uid = 1;
function row(p: Partial<EnvelopeRow> & Pick<EnvelopeRow, "folder" | "from" | "date">): EnvelopeRow {
  const n = uid++;
  return {
    id: `${p.folder}:${n}`,
    path: p.folder === "inbox" ? "INBOX" : "Sent",
    uid: n,
    to: [ME],
    cc: [],
    subject: "Hello",
    references: [],
    seen: true,
    flagged: false,
    answered: false,
    size: 1000,
    hasAttachments: false,
    attachmentBytes: 0,
    hasCalendar: false,
    autoSubmitted: false,
    bulk: false,
    ...p,
  };
}

function context(question: string, extra: () => EnvelopeRow[] = () => []): { ctx: AskContext; senders: { name: string; address: string }[] } {
  uid = 1;
  const snapshot: Snapshot = {
    v: 1,
    account: ME.address,
    fetchedAt: NOW,
    days: 30,
    inbox: { path: "INBOX", unseen: 2, total: 10 },
    sent: { path: "Sent" },
    truncated: false,
    rows: [
      row({ folder: "inbox", from: maya, date: NOW - 5 * HOUR, messageId: "<a@nw>", subject: "Q3 roadmap sign-off?", seen: false, preview: "Need your sign-off on the roadmap by Friday" }),
      row({ folder: "inbox", from: maya, date: NOW - 50 * HOUR, messageId: "<b@nw>", subject: "Lunch", answered: true }),
      row({ folder: "inbox", from: { name: "Stripe", address: "receipts@stripe.example" }, date: NOW - 30 * HOUR, subject: "Your receipt from Acme", hasAttachments: true, attachmentBytes: 90_000 }),
      row({ folder: "inbox", from: { name: "Accounts Security", address: "security@accounts.example" }, date: NOW - 2 * HOUR, subject: "Security alert: new sign-in", seen: false, autoSubmitted: true }),
      ...extra(),
    ],
  };
  const { rows, local, today } = enrichSnapshot(snapshot, { now: NOW, tz: "UTC" });
  const overview = computeOverview(snapshot, { now: NOW, tz: "UTC", self: [ME.address] });
  return {
    ctx: { now: NOW, today, local, rows, overview, extraRows: [], question },
    senders: [maya, { name: "Stripe", address: "receipts@stripe.example" }],
  };
}

function answer(question: string, extra?: () => EnvelopeRow[]) {
  const { ctx, senders } = context(question, extra);
  const plan = heuristicPlan(question, senders);
  const exec = execute(plan, ctx);
  return { plan, composed: exec.compose(exec.candidates.map((r) => ({ row: r }))) };
}

describe("execute", () => {
  test("needs_reply cites the unanswered thread", () => {
    const { composed } = answer("Who's waiting on my reply?");
    expect(composed.headline).toBe("1 thread needs your reply");
    expect(composed.evidence[0]?.subject).toBe("Q3 roadmap sign-off?");
  });

  test("from_person counts and links to Mail search", () => {
    const { composed } = answer("Emails from Maya this week");
    expect(composed.headline).toBe("2 emails from Maya Chen this week");
    expect(composed.openInMail).toBe("/mail?q=maya%40northwind.example");
  });

  test("receipts", () => {
    const { composed } = answer("Receipts from this month");
    expect(composed.headline).toBe("1 receipt this month");
  });

  test("find_topic matches subject + preview", () => {
    const { composed } = answer("anything about the roadmap");
    expect(composed.headline).toBe("1 email about “roadmap”");
    expect(composed.empty).toBe(false);
  });

  test("find_topic tolerates a one-edit typo", () => {
    const { composed } = answer("anything about the roadmp");
    expect(composed.evidence[0]?.subject).toBe("Q3 roadmap sign-off?");
  });

  test("find_topic matches a word prefix", () => {
    const { composed } = answer("anything about roadm");
    expect(composed.evidence[0]?.subject).toBe("Q3 roadmap sign-off?");
  });

  test("security alerts are critical while unread", () => {
    const { composed } = answer("Any security alerts?");
    expect(composed.evidence[0]?.critical).toBe(true);
  });

  test("a typed filter narrows needs_reply instead of being dropped", () => {
    const extra = () => [
      row({ folder: "inbox", from: { name: "Omar Haddad", address: "omar@harbor.example" }, date: NOW - 8 * HOUR, messageId: "<o@hb>", subject: "Venue for the offsite" }),
    ];
    const { ctx, senders } = context("venue · needs my reply", extra);
    const plan = { ...forcePlan("venue · needs my reply", "needs_reply", senders), filter: "venue" };
    const composed = execute(plan, ctx).compose([]);
    expect(composed.headline).toBe("1 thread needs your reply matching “venue”");
    expect(composed.evidence.map((e) => e.subject)).toEqual(["Venue for the offsite"]);

    const none = execute({ ...plan, filter: "kangaroos" }, ctx).compose([]);
    expect(none.empty).toBe(true);
    expect(none.headline).toBe("Nothing matching “kangaroos” needs your reply");
  });

  test("a typed filter narrows newsletters by list name", () => {
    const list = (name: string, address: string) =>
      row({ folder: "inbox", from: { name, address }, date: NOW - 10 * HOUR, listUnsubscribe: "<mailto:u@x>", seen: false });
    const { ctx, senders } = context("opay · newsletters", () => [list("OPay", "news@opay.example"), list("Figma", "hello@figma.example")]);
    const plan = { ...forcePlan("opay · newsletters", "newsletters", senders), filter: "opay" };
    const composed = execute(plan, ctx).compose([]);
    expect(composed.headline).toBe("1 newsletter matching “opay” · 1 you rarely open");
  });

  test("empty topic says so", () => {
    const { composed } = answer("anything about kangaroos");
    expect(composed.empty).toBe(true);
    expect(composed.headline).toBe("Nothing matches “kangaroos”");
  });
});

describe("smartChips", () => {
  test("built from live numbers, one per intent", () => {
    const { ctx } = context("");
    const chips = smartChips(ctx.overview);
    expect(chips[0]).toEqual({ label: "Who’s waiting on my reply?", intent: "needs_reply" });
    expect(new Set(chips.map((c) => c.intent)).size).toBe(chips.length);
  });

  test("counts people waiting, not threads", () => {
    const { overview } = context("").ctx;
    const ref = overview.obligations.needsReply[0]!;
    const withNeeds = (needsReply: (typeof ref)[]) => ({
      ...overview,
      kpis: { ...overview.kpis, needsReply: needsReply.length },
      obligations: { ...overview.obligations, needsReply },
    });
    const twoFromMaya = [ref, { ...ref, uid: "99" }];
    expect(smartChips(withNeeds(twoFromMaya))[0]!.label).toBe("Who’s waiting on my reply?");
    const plusSam = [...twoFromMaya, { ...ref, uid: "100", from: { name: "Sam Okafor", address: "sam@okafor.example" } }];
    expect(smartChips(withNeeds(plusSam))[0]!.label).toBe("2 people waiting — who?");
  });
});

/* ─── intents beyond the basics ─── */

const sam = { name: "Sam Okafor", address: "sam@okafor.example" };
const priya = { name: "Priya Raman", address: "priya@fieldwork.example" };

function run(question: string, extra?: () => EnvelopeRow[]) {
  const { ctx, senders } = context(question, extra);
  const plan = heuristicPlan(question, [...senders, sam, priya]);
  const exec = execute(plan, ctx);
  return { ctx, plan, exec, composed: exec.compose(exec.candidates.map((r) => ({ row: r }))) };
}

describe("execute: awaiting_others", () => {
  // Sam answered a kickoff in 2h (baseline), then went quiet on the contract for 72h.
  const samThread = () => [
    row({ folder: "sent", from: ME, to: [sam], date: NOW - 240 * HOUR, messageId: "<k@me>", subject: "Kickoff" }),
    row({ folder: "inbox", from: sam, date: NOW - 238 * HOUR, messageId: "<k2@ok>", inReplyTo: "<k@me>", references: ["<k@me>"], subject: "Re: Kickoff", answered: true }),
    row({ folder: "sent", from: ME, to: [sam], date: NOW - 72 * HOUR, messageId: "<c@me>", subject: "Contract draft?" }),
  ];
  const priyaThread = () => [
    row({ folder: "sent", from: ME, to: [priya], date: NOW - 130 * HOUR, messageId: "<p@me>", subject: "Invoice question?" }),
  ];

  test("nobody owes you in the base mailbox", () => {
    const { plan, composed } = run("Who owes me a reply?");
    expect(plan.intent).toBe("awaiting_others");
    expect(composed.headline).toBe("Nobody owes you a reply");
    expect(composed.sentence).toBe("Every message you sent that asked for something got an answer.");
    expect(composed.empty).toBe(true);
  });

  test("names the silent contact with their usual pace", () => {
    const { exec, composed } = run("Who owes me a reply?", samThread);
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("1 person owes you a reply");
    expect(composed.sentence).toBe("Longest silence: Sam Okafor, 3d — they usually answer in 2h.");
    expect(composed.evidence).toHaveLength(1);
    expect(composed.evidence[0]).toMatchObject({ subject: "Contract draft?", from: sam, badge: "3d silent", critical: false });
    expect(composed.empty).toBe(false);
  });

  test("longest silence first; >120h is critical; no baseline → no pace", () => {
    const { composed } = run("Who owes me a reply?", () => [...samThread(), ...priyaThread()]);
    expect(composed.headline).toBe("2 people owe you a reply");
    expect(composed.sentence).toBe("Longest silence: Priya Raman, 5d.");
    expect(composed.evidence.map((e) => [e.from.name, e.critical])).toEqual([
      ["Priya Raman", true],
      ["Sam Okafor", false],
    ]);
  });

  test("filters by the named contact and by timeframe", () => {
    const both = () => [...samThread(), ...priyaThread()];
    expect(run("Is Maya ghosting me?", both).composed.headline).toBe("Nobody owes you a reply");
    // this week = Mon 21 Sep onwards: Sam's 72h-old ask is in, Priya's 130h-old one is out.
    const { composed } = run("Who owes me a reply this week?", both);
    expect(composed.headline).toBe("1 person owes you a reply");
    expect(composed.evidence[0]?.from.name).toBe("Sam Okafor");
  });
});

describe("execute: urgent", () => {
  const urgentRows = () => [
    row({ folder: "inbox", from: sam, date: NOW - 3 * HOUR, subject: "URGENT: contract deadline today" }),
    row({ folder: "inbox", from: maya, date: NOW - 4 * HOUR, subject: "Budget notes", flagged: true }),
    row({ folder: "inbox", from: { name: "Shop", address: "deals@shop.example" }, date: NOW - 1 * HOUR, subject: "Urgent: sale ends today, deadline tonight", listId: "<deals.shop.example>" }),
  ];

  test("nothing urgent in the base mailbox", () => {
    const { composed } = run("Anything urgent?");
    expect(composed.headline).toBe("Nothing urgent last 7 days");
    expect(composed.sentence).toBe("No deadlines, alerts, or flagged mail in that window.");
    expect(composed.empty).toBe(true);
  });

  test("urgency first, flagged mail included, newsletters excluded", () => {
    const { exec, composed } = run("Anything urgent?", urgentRows);
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("2 time-sensitive emails last 7 days");
    expect(composed.sentence).toBe("Most pressing: “URGENT: contract deadline today” from Sam Okafor.");
    expect(composed.evidence.map((e) => [e.subject, e.critical, e.badge])).toEqual([
      ["URGENT: contract deadline today", true, undefined],
      ["Budget notes", false, "Flagged"],
    ]);
  });

  test("rankable once there are more than 3 candidates", () => {
    const more = () => [
      ...urgentRows(),
      row({ folder: "inbox", from: priya, date: NOW - 5 * HOUR, subject: "Overdue: final notice, action required" }),
      row({ folder: "inbox", from: priya, date: NOW - 6 * HOUR, subject: "Blocked — need your call asap" }),
    ];
    const { exec } = run("Anything urgent?", more);
    expect(exec.candidates).toHaveLength(4);
    expect(exec.rankable).toBe(true);
  });
});

describe("execute: unread_summary", () => {
  test("counts unread by kind, people first", () => {
    const { plan, exec, composed } = run("What did I miss today?");
    expect(plan.intent).toBe("unread_summary");
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("2 unread today");
    expect(composed.sentence).toBe("1 from people · 1 notification");
    expect(composed.evidence.map((e) => e.subject)).toEqual(["Q3 roadmap sign-off?", "Security alert: new sign-in"]);
  });

  test("names newsletters and receipts too", () => {
    const { composed } = run("What did I miss today?", () => [
      row({ folder: "inbox", from: { name: "The Download", address: "news@download.example" }, date: NOW - 1 * HOUR, subject: "The Download #12", seen: false, listId: "<download.news.example>" }),
      row({ folder: "inbox", from: { name: "Stripe", address: "receipts@stripe.example" }, date: NOW - 3 * HOUR, subject: "Your receipt #2", seen: false }),
    ]);
    expect(composed.headline).toBe("4 unread today");
    expect(composed.sentence).toBe("1 from people · 1 notification · 1 newsletter · 1 receipt");
  });

  test("caught up when nothing unread in range", () => {
    const { composed } = run("What did I miss yesterday?");
    expect(composed.headline).toBe("You’re caught up yesterday");
    expect(composed.sentence).toBe("Nothing new is waiting.");
    expect(composed.empty).toBe(true);
  });
});

describe("execute: attachments", () => {
  test("totals and the largest file", () => {
    const { exec, composed } = run("Files I got this week", () => [
      row({ folder: "inbox", from: maya, date: NOW - 1 * HOUR, subject: "Deck v2", hasAttachments: true, attachmentBytes: 2_500_000 }),
    ]);
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("2 emails with attachments this week");
    expect(composed.sentence).toBe("2.5 MB in total · largest: “Deck v2” (2.4 MB).");
    expect(composed.evidence.map((e) => [e.subject, e.badge])).toEqual([
      ["Deck v2", "2.4 MB"],
      ["Your receipt from Acme", "88 KB"],
    ]);
  });

  test("none in range", () => {
    const { composed } = run("Files I got today");
    expect(composed.headline).toBe("No attachments today");
    expect(composed.sentence).toBe("Nothing with files in that window.");
    expect(composed.empty).toBe(true);
  });
});

describe("execute: newsletters", () => {
  const lists = () => [
    ...[24, 48, 72].map((h, i) =>
      row({ folder: "inbox", from: { name: "The Download", address: "news@download.example" }, date: NOW - h * HOUR, subject: `The Download #${3 - i}`, seen: false, listId: "The Download <download.news.example>" }),
    ),
    ...[10, 100].map((h) =>
      row({ folder: "inbox", from: { name: "Weekly Brief", address: "brief@weekly.example" }, date: NOW - h * HOUR, subject: "Weekly Brief", listId: "<brief.weekly.example>" }),
    ),
  ];

  test("list-free inbox", () => {
    const { composed } = run("Newsletters I never open");
    expect(composed.headline).toBe("No newsletters in the last 30 days");
    expect(composed.sentence).toBe("Your inbox is refreshingly list-free.");
    expect(composed.evidence).toEqual([]);
    expect(composed.empty).toBe(true);
  });

  test("grades lists; evidence is the latest issue of each rarely-opened list", () => {
    const { composed } = run("Newsletters I never open", lists);
    expect(composed.headline).toBe("2 newsletters · 1 you rarely open");
    expect(composed.sentence).toBe("The Download: opened 0% of 3 issues.");
    expect(composed.evidence).toHaveLength(1);
    expect(composed.evidence[0]).toMatchObject({ subject: "The Download #3", badge: "Grade F" });
    expect(composed.stats).toEqual([
      { label: "The Download", value: "F · 0%" },
      { label: "Weekly Brief", value: "A · 100%" },
    ]);
    expect(composed.empty).toBe(false);
  });
});

describe("execute: volume_stats", () => {
  test("counts the window with a per-day chart", () => {
    const { composed } = run("How much mail did I get this week?");
    expect(composed.headline).toBe("4 received · 0 sent this week");
    expect(composed.viz?.label).toBe("Received per day, this week");
    expect(composed.viz?.points).toHaveLength(7);
    expect(composed.viz?.points.slice(-3)).toEqual([
      { label: "09-22", value: 1 },
      { label: "09-23", value: 1 },
      { label: "09-24", value: 2 },
    ]);
    expect(composed.sentence).not.toMatch(/^(Up|Down)/);
    expect(composed.evidence).toEqual([]);
    expect(composed.empty).toBe(false);
  });

  test("compares with the period before", () => {
    const { composed } = run("How much mail did I get this week?", () => [
      row({ folder: "inbox", from: maya, date: NOW - 8 * 24 * HOUR, subject: "Old 1" }),
      row({ folder: "inbox", from: maya, date: NOW - 9 * 24 * HOUR, subject: "Old 2" }),
      row({ folder: "sent", from: ME, to: [maya], date: NOW - 1 * HOUR, subject: "Out" }),
    ]);
    expect(composed.headline).toBe("4 received · 1 sent this week");
    expect(composed.sentence).toStartWith("Up 100% on the period before");
  });

  test("today is a single day", () => {
    const { composed } = run("How much mail did I get today?");
    expect(composed.headline).toBe("2 received · 0 sent today");
    expect(composed.viz?.points).toEqual([{ label: "09-24", value: 2 }]);
  });

  // BUG: retrieve.ts:360 volume_stats maps "yesterday" to span=2 and sums days.slice(-2),
  // i.e. yesterday + today. The headline says "yesterday" but reports 3 (1 yesterday + 2 today).
  // (Relatedly "this week"/"this month" are rolling 7/30 days, not calendar ranges.)
  test.todo("BUG: 'yesterday' counts only yesterday, not yesterday + today", () => {
    const { composed } = run("How much mail did I get yesterday?");
    expect(composed.headline).toBe("1 received · 0 sent yesterday");
  });
});

describe("execute: response_time", () => {
  const replies = () => [
    // You answered Maya in 90 minutes.
    row({ folder: "inbox", from: maya, date: NOW - 240 * HOUR, messageId: "<c@nw>", subject: "Budget?", answered: true }),
    row({ folder: "sent", from: ME, to: [maya], date: NOW - 240 * HOUR + 90 * 60_000, inReplyTo: "<c@nw>", references: ["<c@nw>"], subject: "Re: Budget?" }),
    // Sam answered you in 2 hours.
    row({ folder: "sent", from: ME, to: [sam], date: NOW - 100 * HOUR, messageId: "<k@me>", subject: "Kickoff" }),
    row({ folder: "inbox", from: sam, date: NOW - 98 * HOUR, inReplyTo: "<k@me>", references: ["<k@me>"], subject: "Re: Kickoff", answered: true }),
  ];

  test("not enough data yet", () => {
    const { composed } = run("How fast do I reply?");
    expect(composed.headline).toBe("Not enough replies to measure yet");
    expect(composed.sentence).toBe("Reply to a few threads and I’ll learn your pace.");
    expect(composed.stats?.map((s) => s.value)).toEqual(["—", "—", "—"]);
    expect(composed.empty).toBe(true);
  });

  test("your median, p90 and theirs", () => {
    const { composed } = run("How fast do I reply?", replies);
    expect(composed.headline).toBe("You reply in 1h 30m");
    expect(composed.sentence).toBe("Median over 1 reply · 90% within 1h 30m · people answer you in 2h.");
    expect(composed.stats).toEqual([
      { label: "Your median", value: "1h 30m" },
      { label: "Your 90th %", value: "1h 30m" },
      { label: "Their median", value: "2h" },
    ]);
    expect(composed.empty).toBe(false);
  });

  test("per contact when one is named", () => {
    const { plan, composed } = run("What's my reply speed with Maya?", replies);
    expect(plan.intent).toBe("response_time");
    expect(composed.headline).toBe("You reply to Maya Chen in 1h 30m");
    expect(composed.sentence).toBe("Maya Chen answers you in — · 3 emails in 30 days.");
    expect(composed.evidence.map((e) => e.subject)).toEqual(["Q3 roadmap sign-off?", "Lunch", "Budget?"]);
  });
});

describe("execute: top_contacts", () => {
  test("the person who writes most, with a chart", () => {
    const { composed } = run("Who emails me most?", () => [
      row({ folder: "sent", from: ME, to: [maya], date: NOW - 1 * HOUR, subject: "Re: Lunch" }),
    ]);
    expect(composed.headline).toBe("Maya Chen writes to you most");
    expect(composed.sentence).toBe("2 emails in 30 days · you wrote back 1 time.");
    expect(composed.viz).toEqual({ kind: "bars", label: "Emails from each person, last 30 days", points: [{ label: "Maya Chen", value: 2 }] });
    expect(composed.evidence.map((e) => e.subject)).toEqual(["Q3 roadmap sign-off?", "Lunch"]);
    expect(composed.empty).toBe(false);
  });

  test("falls back to all senders when no people write", () => {
    const { ctx, plan } = run("Who emails me most?");
    const machines = ctx.overview.senders.filter((s) => s.bucket !== "people");
    expect(machines.length).toBeGreaterThan(0);
    const composed = execute(plan, { ...ctx, overview: { ...ctx.overview, senders: machines } }).compose([]);
    expect(composed.headline).toBe(`${machines[0]!.name} writes to you most`);
    expect(composed.viz?.points).toHaveLength(machines.length);
  });

  test("empty mailbox", () => {
    const { ctx, plan } = run("Who emails me most?");
    const composed = execute(plan, { ...ctx, overview: { ...ctx.overview, senders: [] } }).compose([]);
    expect(composed.headline).toBe("No regular correspondents yet");
    expect(composed.sentence).toBe("Once people write in, they’ll show up here.");
    expect(composed.evidence).toEqual([]);
    expect(composed.empty).toBe(true);
  });
});

describe("execute: meetings", () => {
  test("calendar invites and scheduling threads, newest first", () => {
    const { exec, composed } = run("Any meeting invites this week?", () => [
      row({ folder: "inbox", from: sam, date: NOW - 6 * HOUR, subject: "Quick call tomorrow?" }),
      row({ folder: "inbox", from: maya, date: NOW - 3 * HOUR, subject: "Invitation: Design review @ Fri", hasCalendar: true }),
      row({ folder: "sent", from: ME, to: [maya], date: NOW - 1 * HOUR, subject: "Meeting notes" }),
    ]);
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("2 meeting emails this week");
    expect(composed.sentence).toBe("Latest: “Invitation: Design review @ Fri”.");
    expect(composed.evidence.map((e) => [e.subject, e.badge])).toEqual([
      ["Invitation: Design review @ Fri", "Invite"],
      ["Quick call tomorrow?", undefined],
    ]);
  });

  test("none", () => {
    const { composed } = run("Any meeting invites this week?");
    expect(composed.headline).toBe("No meeting invites this week");
    expect(composed.sentence).toBe("No calendar invites or scheduling threads in that window.");
    expect(composed.empty).toBe(true);
  });
});

describe("execute: help", () => {
  test("static, non-empty, nothing to rank", () => {
    const { plan, exec, composed } = run("What can you do?");
    expect(plan.intent).toBe("help");
    expect(exec.candidates).toEqual([]);
    expect(exec.rankable).toBe(false);
    expect(composed.headline).toBe("Here’s what I can find");
    expect(composed.evidence).toEqual([]);
    expect(composed.empty).toBe(false);
  });
});
