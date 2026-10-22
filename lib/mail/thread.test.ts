import { describe, expect, test } from "bun:test";
import {
  conversationTargets,
  groupThreads,
  memberUids,
  normalizeSubject,
  rowOf,
  singleRows,
  threadHeaderIds,
} from "@/lib/mail/thread";
import type { MailSummary } from "@/lib/mail/types";

const ME = "me@raven.dev";
const day = (n: number) => new Date(Date.UTC(2026, 9, 20) - n * 86_400_000).toISOString();

let next = 100;
function row(over: Omit<Partial<MailSummary>, "from"> & { from?: string }): MailSummary {
  const uid = String(next--);
  const { from = "maya@x.com", ...rest } = over;
  return {
    uid,
    folder: "INBOX",
    subject: "Q3 plan",
    from: { address: from, name: from === ME ? "Me" : from.split("@")[0] },
    to: [{ address: ME }],
    preview: "",
    date: day(0),
    flags: { seen: true, flagged: false, answered: false, draft: false },
    hasAttachments: false,
    messageId: `<${uid}@x>`,
    ...rest,
  };
}

const shape = (rows: MailSummary[]) => groupThreads(rows, ME).map((t) => t.members.map((m) => m.uid));

describe("normalizeSubject", () => {
  test.each([
    ["Re: Q3 plan", "q3 plan"],
    ["RE: Fwd: re: Q3  plan ", "q3 plan"],
    ["AW: SV: Antw: Q3 plan", "q3 plan"],
    ["Re[2]: Q3 plan", "q3 plan"],
    ["[team] Re: Q3 plan", "q3 plan"],
    ["Fw: Q3 plan", "q3 plan"],
    ["Rebuild the Q3 plan", "rebuild the q3 plan"],
  ])("%p → %p", (input, out) => {
    expect(normalizeSubject(input)).toBe(out);
  });
});

describe("groupThreads", () => {
  test("joins a header chain, newest member first, rows in newest order", () => {
    const a = row({ date: day(3) });
    const b = row({ date: day(2), inReplyTo: a.messageId, references: [a.messageId!] });
    const other = row({ subject: "Lunch?", date: day(1), from: "sam@x.com" });
    const c = row({ date: day(0), inReplyTo: b.messageId, references: [a.messageId!, b.messageId!] });
    expect(shape([c, other, b, a])).toEqual([[c.uid, b.uid, a.uid], [other.uid]]);
  });

  test("a trimmed References still joins through In-Reply-To, and a missing middle through References", () => {
    const a = row({ date: day(3) });
    const b = row({ date: day(2), inReplyTo: a.messageId });
    // b's own copy isn't loaded; c names the root in References only.
    const c = row({ date: day(0), references: [a.messageId!, "<gone@x>"], inReplyTo: "<gone@x>" });
    expect(shape([c, b, a])).toEqual([[c.uid, b.uid, a.uid]]);
  });

  test("the server's thread id wins even with no headers", () => {
    const a = row({ subject: "Totally different", threadId: "T1", messageId: undefined });
    const b = row({ subject: "Something else", threadId: "T1", messageId: undefined, from: "sam@x.com" });
    expect(shape([a, b])).toEqual([[a.uid, b.uid]]);
  });

  test("a headerless reply joins on subject when it shares a person", () => {
    const original = row({ subject: "Venue options", date: day(5), to: [{ address: ME }, { address: "sam@x.com" }] });
    const reply = row({ subject: "Re: venue options", date: day(1), from: "sam@x.com", messageId: "<m@x>" });
    expect(shape([reply, original])).toEqual([[reply.uid, original.uid]]);
  });

  test("same subject without a reply prefix never merges (receipts, newsletters)", () => {
    const a = row({ subject: "Your receipt", from: "shop@x.com", date: day(2) });
    const b = row({ subject: "Your receipt", from: "shop@x.com", date: day(1) });
    expect(shape([b, a])).toEqual([[b.uid], [a.uid]]);
  });

  test("a subject match needs a shared person besides you, and the 30-day window", () => {
    const original = row({ subject: "Plan", date: day(40), from: "maya@x.com" });
    const stranger = row({ subject: "Re: Plan", date: day(1), from: "bob@y.com" });
    const late = row({ subject: "Re: Plan", date: day(0), from: "maya@x.com" });
    expect(shape([late, stranger, original])).toEqual([[late.uid], [stranger.uid], [original.uid]]);
  });

  test("a reply that carries headers never falls back to subject", () => {
    const original = row({ subject: "Venue options", date: day(5) });
    const reply = row({ subject: "Re: Venue options", date: day(1), inReplyTo: "<elsewhere@x>" });
    expect(shape([reply, original])).toEqual([[reply.uid], [original.uid]]);
  });

  test("row summary: unread, flagged, attachments, people oldest first with You, thread ids", () => {
    const a = row({ date: day(3), from: "maya@x.com", threadId: "T9" });
    const b = row({ date: day(2), from: ME, inReplyTo: a.messageId, flags: { seen: true, flagged: true, answered: false, draft: false } });
    const c = row({ date: day(0), from: "maya@x.com", inReplyTo: b.messageId, hasAttachments: true, flags: { seen: false, flagged: false, answered: false, draft: false } });
    const [t] = groupThreads([c, b, a], ME);
    expect(t).toMatchObject({ key: c.uid, unread: true, flagged: true, hasAttachments: true, people: ["maya", "You"], threadIds: ["T9"] });
    expect(t!.latest.uid).toBe(c.uid);
  });
});

describe("helpers", () => {
  test("memberUids expands selected rows to every message they hold", () => {
    const a = row({ date: day(2) });
    const b = row({ date: day(0), inReplyTo: a.messageId });
    const solo = row({ subject: "Other", from: "sam@x.com" });
    const rows = groupThreads([b, solo, a], ME);
    expect(memberUids(rows, [b.uid]).sort()).toEqual([a.uid, b.uid].sort());
    expect(memberUids(rows, [solo.uid])).toEqual([solo.uid]);
  });

  test("rowOf finds an older member opened from a link", () => {
    const a = row({ date: day(2) });
    const b = row({ date: day(0), inReplyTo: a.messageId });
    const rows = groupThreads([b, a], ME);
    expect(rowOf(rows, a.uid)).toBe(0);
    expect(rowOf(rows, "nope")).toBe(-1);
    expect(rowOf(rows, null)).toBe(-1);
  });

  test("singleRows keeps one row per message and never reaches the whole thread", () => {
    const a = row({ threadId: "T1" });
    const b = row({ threadId: "T1" });
    const rows = singleRows([a, b], ME);
    expect(rows.map((r) => r.key)).toEqual([a.uid, b.uid]);
    expect(rows.every((r) => r.threadIds.length === 0)).toBe(true);
  });
});

describe("threadHeaderIds", () => {
  test("root, parents and self, once each, well-formed only", () => {
    expect(
      threadHeaderIds({ messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>", "junk", "<bad id@x>"] }),
    ).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });

  test("a long chain keeps the root and the newest", () => {
    const refs = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`);
    const ids = threadHeaderIds({ messageId: "<self@x>", references: refs }, 5);
    expect(ids).toEqual(["<r0@x>", "<r27@x>", "<r28@x>", "<r29@x>", "<self@x>"]);
  });

  test("nothing to go on, nothing to search", () => {
    expect(threadHeaderIds({})).toEqual([]);
  });
});

describe("conversationTargets", () => {
  const m = (uid: string, folder: string, threadId?: string) => row({ uid, folder, threadId });

  test("every member in the open folder, Sent copies left alone, thread ids carried", () => {
    const t = { messages: [m("1", "INBOX", "T"), m("5", "Sent", "T"), m("9", "INBOX", "T")] };
    expect(conversationTargets(t, "INBOX", "9")).toEqual({ uids: ["1", "9"], threadIds: ["T"] });
  });

  test("header-chain threads carry no thread ids", () => {
    const t = { messages: [m("1", "INBOX"), m("9", "INBOX")] };
    expect(conversationTargets(t, "INBOX", "9")).toEqual({ uids: ["1", "9"], threadIds: undefined });
  });

  test("no thread yet (loading, partial, threading off), or the message isn't in it: just the message", () => {
    expect(conversationTargets(undefined, "INBOX", "9")).toEqual({ uids: ["9"] });
    expect(conversationTargets({ messages: [] }, "INBOX", "9")).toEqual({ uids: ["9"] });
    expect(conversationTargets({ messages: [m("1", "INBOX")] }, "INBOX", "9")).toEqual({ uids: ["9"] });
  });
});
