import { describe, expect, test } from "bun:test";
import { computeOverview, focusWindows, pickCheckTimes } from "@/lib/insights/metrics";
import { makeLocalizer, shiftDateKey, windowDateKeys, weekdayOfKey } from "@/lib/insights/bins";
import { inboxWeather } from "@/lib/insights/health";
import { parseDateHeader, parseHeaderBlock, parseListUnsubscribe } from "@/lib/mail/headers";
import type { EnvelopeRow, Snapshot } from "@/lib/insights/types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 15, 0); // Thu 24 Sep 2026 15:00Z
const ME = { address: "me@raven.dev", name: "Me" };

let uid = 1;
function row(partial: Partial<EnvelopeRow> & Pick<EnvelopeRow, "folder" | "from" | "date">): EnvelopeRow {
  const n = uid++;
  return {
    id: `${partial.folder}:${n}`,
    path: partial.folder === "inbox" ? "INBOX" : "Sent",
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
    ...partial,
  };
}

const maya = { name: "Maya Chen", address: "maya@northwind.example" };
const priya = { name: "Priya Raman", address: "priya@fieldwork.example" };
const omar = { name: "Omar Haddad", address: "omar@harbor.example" };

function fixture(): Snapshot {
  uid = 1;
  const rows: EnvelopeRow[] = [
    // 1. Maya asks something 20h ago, no reply → needs reply
    row({ folder: "inbox", from: maya, date: NOW - 20 * HOUR, messageId: "<m1@nw>", subject: "Sign-off?", seen: false }),
    // 2. Maya 5d ago, answered 2h later → latency sample, not needs-reply
    row({ folder: "inbox", from: maya, date: NOW - 120 * HOUR, messageId: "<m2@nw>", subject: "Deck", answered: true }),
    row({ folder: "sent", from: ME, to: [maya], date: NOW - 118 * HOUR, sentAt: NOW - 118 * HOUR, messageId: "<s2@raven>", inReplyTo: "<m2@nw>", references: ["<m2@nw>"], subject: "Re: Deck" }),
    // 3. Priya baseline: she replied 3h after my earlier message
    row({ folder: "sent", from: ME, to: [priya], date: NOW - 200 * HOUR, sentAt: NOW - 200 * HOUR, messageId: "<s3@raven>", subject: "Kickoff" }),
    row({ folder: "inbox", from: priya, date: NOW - 197 * HOUR, messageId: "<p3@fw>", inReplyTo: "<s3@raven>", references: ["<s3@raven>"], subject: "Re: Kickoff", answered: true }),
    // then my follow-up to her (reply), answered by nobody for 72h → waiting (≥48h, >3×3h)
    row({ folder: "sent", from: ME, to: [priya], date: NOW - 72 * HOUR, sentAt: NOW - 72 * HOUR, messageId: "<s4@raven>", inReplyTo: "<p3@fw>", references: ["<s3@raven>", "<p3@fw>"], subject: "Re: Kickoff", preview: "Any update on the kickoff date?" }),
    // 4. Omar: sent 24h ago → not waiting yet
    row({ folder: "sent", from: ME, to: [omar], date: NOW - 24 * HOUR, sentAt: NOW - 24 * HOUR, messageId: "<s5@raven>", subject: "Quote" }),
    // 5. Receipt from a role address → transactions, never needs-reply
    row({ folder: "inbox", from: { name: "Billing", address: "billing@fastmail.example" }, date: NOW - 6 * HOUR, subject: "Invoice #1842 — payment received", hasAttachments: true, attachmentBytes: 48_000 }),
    // 6. CI notification
    row({ folder: "inbox", from: { name: "CI Bot", address: "ci@github.example" }, date: NOW - 3 * HOUR, subject: "Build passing on main", autoSubmitted: true }),
    // 7. Cc-only human mail → not needs reply
    row({ folder: "inbox", from: omar, to: [maya], cc: [ME], date: NOW - 10 * HOUR, messageId: "<o7@hb>", subject: "FYI plan" }),
    // 8. Newsletter: 4 issues, 1 opened
    ...[1, 2, 3, 4].map((i) =>
      row({
        folder: "inbox",
        from: { name: "Reads Digest", address: "digest@reads.example" },
        date: NOW - i * 48 * HOUR,
        subject: `Weekly roundup #${i}`,
        listId: "Reads Digest <reads.list.example>",
        listUnsubscribe: "<https://reads.example/u/x>, <mailto:unsub@reads.example?subject=unsubscribe>",
        bulk: true,
        seen: i === 4,
      }),
    ),
  ];
  return {
    v: 1,
    account: ME.address,
    fetchedAt: NOW,
    days: 30,
    inbox: { path: "INBOX", unseen: 4, total: 120 },
    sent: { path: "Sent" },
    rows,
    truncated: false,
  };
}

describe("computeOverview", () => {
  const overview = computeOverview(fixture(), { now: NOW, tz: "UTC", self: [ME.address] });

  test("needs reply = unanswered human mail addressed to you", () => {
    expect(overview.obligations.needsReply.map((r) => r.subject)).toEqual(["Sign-off?"]);
    expect(overview.kpis.needsReply).toBe(1);
    expect(overview.obligations.replyDebtHours).toBe(20);
  });

  test("waiting on respects the contact's own baseline and skips last-word replies", () => {
    expect(overview.obligations.waitingOn.map((w) => w.to.address)).toEqual([priya.address]);
    expect(overview.obligations.waitingOn[0]!.baselineHours).toBe(3);
  });

  test("reply latency pairs sent ↔ inbound by In-Reply-To", () => {
    // Maya answered in 2h; the Priya follow-up answered her reply 125h later.
    expect(overview.replyTimes.yours).toEqual({ medianMin: 3810, p90Min: 7500, samples: 2 });
    expect(overview.replyTimes.theirs.medianMin).toBe(180);
  });

  test("reply times count people only — RSVPs to bots don't flatter the median", () => {
    const snap = fixture();
    const calendar = { name: "Calendar", address: "calendar-notification@cal.example" };
    snap.rows.push(
      row({ folder: "inbox", from: calendar, date: NOW - 30 * HOUR, messageId: "<c1@cal>", subject: "Invitation: Standup @ Fri", autoSubmitted: true, hasCalendar: true }),
      row({ folder: "sent", from: ME, to: [calendar], date: NOW - 29.9 * HOUR, sentAt: NOW - 29.9 * HOUR, messageId: "<s9@raven>", inReplyTo: "<c1@cal>", subject: "Accepted: Standup @ Fri" }),
    );
    const withRsvp = computeOverview(snap, { now: NOW, tz: "UTC", self: [ME.address] });
    expect(withRsvp.replyTimes.yours).toEqual(overview.replyTimes.yours);
  });

  test("hot threads = the busiest human conversations this week", () => {
    expect(overview.hotThreads.map(({ subject, messages, people }) => ({ subject, messages, people }))).toEqual([
      { subject: "Re: Deck", messages: 2, people: ["Maya Chen"] },
    ]);
  });

  test("mail mix buckets", () => {
    const mix = Object.fromEntries(overview.mix.map((m) => [m.bucket, m.count]));
    expect(mix).toEqual({ people: 4, notifications: 1, newsletters: 4, transactions: 1 });
  });

  test("newsletter grade + unsubscribe targets", () => {
    const reads = overview.newsletters[0]!;
    expect(reads.issues).toBe(4);
    expect(reads.openRate).toBe(0.25);
    expect(reads.grade).toBe("C");
    expect(reads.unsubscribe).toEqual({
      https: "https://reads.example/u/x",
      mailto: "mailto:unsub@reads.example?subject=unsubscribe",
    });
  });

  test("newsletters are uncapped; shared senders are named by their List-Id", () => {
    uid = 1;
    const news = (i: number) =>
      row({ folder: "inbox", from: { name: `Shop ${i}`, address: `news@shop${i}.example` }, date: NOW - (i + 1) * HOUR, listUnsubscribe: "<mailto:u@x>", seen: false });
    const github = (repo: string, poster: string) =>
      row({ folder: "inbox", from: { name: poster, address: "notifications@github.com" }, date: NOW - HOUR, listId: `${repo} <${repo.replace("/", ".")}.github.com>`, listUnsubscribe: "<mailto:u@x>" });
    const rows = [...Array.from({ length: 20 }, (_, i) => news(i)), github("polylane/app", "Ayomikun Araoye"), github("polylane/web", "polylane[bot]")];
    const o = computeOverview(
      { v: 1, account: ME.address, fetchedAt: NOW, days: 30, inbox: { path: "INBOX", unseen: 0, total: 0 }, sent: { path: null }, rows, truncated: false },
      { now: NOW, tz: "UTC", self: [ME.address] },
    );
    expect(o.newsletters.filter((n) => n.grade === "F")).toHaveLength(20);
    expect(o.newsletters.map((n) => n.name)).toContain("polylane/app");
    expect(o.newsletters.map((n) => n.name)).toContain("polylane/web");
    expect(o.newsletters.map((n) => n.name)).toContain("Shop 3");
  });

  test("attachments + kpis", () => {
    expect(overview.attachments.count).toBe(1);
    expect(overview.attachments.bytes).toBe(48_000);
    expect(overview.kpis.unread).toBe(4);
    expect(overview.volume.days).toHaveLength(30);
    expect(overview.volume.days.at(-1)!.date).toBe("2026-09-24");
  });

  test("senders carry 30 daily + 4 weekly buckets", () => {
    const m = overview.senders.find((s) => s.address === maya.address)!;
    expect(m.daily).toHaveLength(30);
    expect(m.weekly).toHaveLength(4);
    expect(m.count).toBe(2);
    expect(m.needsReply).toBe(1);
    expect(m.yourReplyMedianMin).toBe(120);
  });

  test("brief ranks the unanswered human ask first", () => {
    expect(overview.brief[0]?.subject).toBe("Sign-off?");
    expect(overview.brief[0]?.why).toContain("Needs your reply");
  });

  test("timezone decides the day and the hour bin", () => {
    const tokyo = computeOverview(fixture(), { now: NOW, tz: "Asia/Tokyo", self: [ME.address] });
    expect(tokyo.volume.days.at(-1)!.date).toBe("2026-09-25");
  });
});

describe("bins", () => {
  test("localizer across DST fall-back keeps both 1am hours", () => {
    const ny = makeLocalizer("America/New_York");
    const edt = ny(Date.UTC(2026, 10, 1, 5, 30)); // 01:30 EDT
    const est = ny(Date.UTC(2026, 10, 1, 6, 30)); // 01:30 EST
    expect([edt.hour, est.hour]).toEqual([1, 1]);
    expect(edt.dateKey).toBe("2026-11-01");
    expect(edt.weekday).toBe(6);
  });

  test("calendar keys never skip or repeat", () => {
    const keys = windowDateKeys("2026-11-02", 3);
    expect(keys).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOfKey("2026-09-24")).toBe(3);
  });
});

describe("check times + focus", () => {
  test("two clusters → two checks with ≥80% coverage", () => {
    const minutes = [...Array(10).fill(8 * 60 + 30), ...Array(8).fill(13 * 60 + 40), 21 * 60];
    const { checkTimes, coverage } = pickCheckTimes(minutes);
    expect(checkTimes).toEqual([9, 14]);
    expect(coverage).toBeGreaterThanOrEqual(0.8);
  });

  test("focus windows between checks", () => {
    expect(focusWindows([9, 14])).toEqual([
      { start: 10, end: 14 },
      { start: 15, end: 18 },
    ]);
    expect(focusWindows([])).toEqual([{ start: 8, end: 18 }]);
  });
});

describe("weather", () => {
  test("calm day is clear, heavy debt storms", () => {
    const calm = inboxWeather({ needsReply: 0, oldestNeedsReplyHours: 0, urgentToday: 0, waitingOn: 0, paceRatio: 0.7, weekdayName: "Thursday", front: "9am–11am" });
    expect(calm.state).toBe("clear");
    expect(calm.forecast).toBe("Lighter than a usual Thursday · heavy front 9am–11am");
    const storm = inboxWeather({ needsReply: 9, oldestNeedsReplyHours: 120, urgentToday: 4, waitingOn: 5, paceRatio: 1.5, weekdayName: "Monday", front: null });
    expect(storm.state).toBe("storm");
  });
});

describe("headers", () => {
  test("parse folded block + date offsets + unsubscribe", () => {
    const block = parseHeaderBlock("List-Id: Reads\r\n <reads.list.example>\r\nDate: Thu, 24 Sep 2026 09:12:00 +0900\r\n");
    expect(block.get("list-id")).toBe("Reads <reads.list.example>");
    expect(parseDateHeader(block.get("date"))).toEqual({ epoch: Date.UTC(2026, 8, 24, 0, 12), offsetMin: 540 });
    expect(parseDateHeader("Mon, 21 Sep 2026 10:00:00 -0500 (EST)")?.offsetMin).toBe(-300);
    expect(parseListUnsubscribe("<mailto:a@b.example>")).toEqual({ https: undefined, mailto: "mailto:a@b.example" });
  });
});
