import { describe, expect, test } from "bun:test";
import { DEV_SELF, generateSyntheticMail } from "@/lib/mail/dev-seed";
import type { MailMessage } from "@/lib/mail/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Local-time anchors: the generator lays hours out in the machine's zone, and the obligation
// counts must hold whatever weekday/hour the dev server happens to boot at.
const SCENARIOS: [string, number][] = [
  ["Thursday afternoon", new Date(2026, 8, 24, 15, 0).getTime()],
  ["Monday before work", new Date(2026, 8, 21, 7, 30).getTime()],
  ["Saturday noon", new Date(2026, 8, 26, 12, 0).getTime()],
  ["Sunday near midnight", new Date(2026, 8, 27, 23, 50).getTime()],
];
const NOW = SCENARIOS[0]![1];
const mail = generateSyntheticMail({ now: NOW });

const at = (m: MailMessage) => Date.parse(m.date);
const inbox = (list: MailMessage[]) => list.filter((m) => m.folder === "INBOX");
const sent = (list: MailMessage[]) => list.filter((m) => m.folder === "Sent");
const automated = (m: MailMessage) =>
  Boolean(m.headers["list-id"] || m.headers["list-unsubscribe"]) ||
  (m.headers["auto-submitted"] ?? "no").toLowerCase() !== "no" ||
  /no-?reply/i.test(m.from.address);
const threadOf = (m: MailMessage) => m.references?.[0] ?? m.inReplyTo ?? m.messageId!;

function latestByThread(list: MailMessage[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const m of list) latest.set(threadOf(m), Math.max(latest.get(threadOf(m)) ?? 0, at(m)));
  return latest;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Last message inbound, from a person, you in To, not \Answered, no Sent reply, ≤ 14 days. */
function needsReply(list: MailMessage[], now: number): MailMessage[] {
  const latest = latestByThread(list);
  const replied = new Set(sent(list).map((m) => m.inReplyTo));
  return inbox(list).filter(
    (m) =>
      !automated(m) &&
      at(m) === latest.get(threadOf(m)) &&
      m.to.some((a) => a.address === DEV_SELF.address) &&
      !m.flags.answered &&
      !replied.has(m.messageId) &&
      now - at(m) <= 14 * DAY,
  );
}

/** Your Sent message is last in thread, to a person, unanswered, older than max(48h, 3× their median reply). */
function ghosted(list: MailMessage[], now: number): MailMessage[] {
  const people = new Set(inbox(list).filter((m) => !automated(m)).map((m) => m.from.address));
  const sentById = new Map(sent(list).map((m) => [m.messageId, m]));
  const theirs = new Map<string, number[]>();
  for (const m of inbox(list)) {
    const original = m.inReplyTo ? sentById.get(m.inReplyTo) : undefined;
    if (original) theirs.set(m.from.address, [...(theirs.get(m.from.address) ?? []), at(m) - at(original)]);
  }
  const referenced = new Set(inbox(list).flatMap((m) => [m.inReplyTo, ...(m.references ?? [])]));
  const latest = latestByThread(list);
  return sent(list).filter((m) => {
    const to = m.to[0]?.address;
    if (!to || !people.has(to) || referenced.has(m.messageId) || at(m) !== latest.get(threadOf(m))) return false;
    const baseline = median(theirs.get(to) ?? []) ?? 0;
    return now - at(m) > Math.max(48 * HOUR, 3 * baseline);
  });
}

describe("generateSyntheticMail", () => {
  test("is deterministic for the same now and seed", () => {
    expect(generateSyntheticMail({ now: NOW })).toEqual(mail);
    expect(generateSyntheticMail({ now: NOW, seed: 7 })).toEqual(generateSyntheticMail({ now: NOW, seed: 7 }));
    expect(generateSyntheticMail({ now: NOW, seed: 7 })).not.toEqual(mail);
  });

  test("keeps every message inside the 45-day window", () => {
    for (const m of mail) {
      expect(at(m)).toBeLessThanOrEqual(NOW);
      expect(at(m)).toBeGreaterThanOrEqual(NOW - 45 * DAY);
    }
  });

  test("only fills Inbox and Sent; Sent is from you and seen", () => {
    expect(new Set(mail.map((m) => m.folder))).toEqual(new Set(["INBOX", "Sent"]));
    for (const m of sent(mail)) {
      expect(m.from).toEqual(DEV_SELF);
      expect(m.flags.seen).toBe(true);
    }
  });

  test("uids start at 1000, are unique per folder, and rise with date", () => {
    expect(Math.min(...mail.map((m) => Number(m.uid)))).toBe(1000);
    for (const folder of ["INBOX", "Sent"]) {
      const list = mail.filter((m) => m.folder === folder).sort((a, b) => Number(a.uid) - Number(b.uid));
      expect(new Set(list.map((m) => m.uid)).size).toBe(list.length);
      for (let i = 1; i < list.length; i++) expect(at(list[i]!)).toBeGreaterThanOrEqual(at(list[i - 1]!));
    }
    expect(new Set(mail.map((m) => m.messageId)).size).toBe(mail.length);
  });

  test("every Sent reply points at an inbound message, which is marked answered", () => {
    const byId = new Map(inbox(mail).map((m) => [m.messageId, m]));
    const replies = sent(mail).filter((m) => m.inReplyTo);
    expect(replies.length).toBeGreaterThan(50);
    for (const m of replies) {
      const original = byId.get(m.inReplyTo);
      expect(original).toBeDefined();
      expect(original!.flags.answered).toBe(true);
      expect(at(m)).toBeGreaterThan(at(original!));
      expect(m.references?.at(-1)).toBe(m.inReplyTo);
    }
    const chains = mail.filter((m) => (m.references?.length ?? 0) >= 3);
    expect(chains.length).toBeGreaterThan(5);
  });

  test("headers carry the essentials, and the Date header is the same instant as date", () => {
    for (const m of mail) {
      expect(m.headers.from).toContain(m.from.address);
      expect(m.headers["x-dev-mode"]).toBe("true");
      expect(m.headers.date).toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/);
      expect(Date.parse(m.headers.date!)).toBe(at(m));
      if (m.references) expect(m.headers.references).toBe(m.references.join(" "));
      else expect(m.headers.references).toBeUndefined();
      expect(m.text.length).toBeLessThanOrEqual(400);
    }
  });

  test("senders keep their own clock in the Date header", () => {
    const local = (m: MailMessage) => {
      const off = -new Date(at(m)).getTimezoneOffset();
      const abs = Math.abs(off);
      return `${off < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
    };
    const from = (address: string) => mail.filter((m) => m.from.address === address);
    expect(from("lina@kaizen-studio.example").length).toBeGreaterThan(0);
    for (const m of from("lina@kaizen-studio.example")) expect(m.headers.date!.endsWith("+0900")).toBe(true);
    for (const m of from("omar@harbor.example")) expect(m.headers.date!.endsWith("-0500")).toBe(true);
    for (const m of from("chloe@atelier.example")) expect(m.headers.date!.endsWith("+0200")).toBe(true);
    for (const m of [...sent(mail), ...from("maya.chen@northwind.example")]) expect(m.headers.date!.endsWith(local(m))).toBe(true);
  });

  test("six newsletters with complete list headers and distinct open rates", () => {
    const lists = new Map<string, MailMessage[]>();
    for (const m of inbox(mail)) {
      const id = m.headers["list-id"];
      if (id) lists.set(id, [...(lists.get(id) ?? []), m]);
    }
    expect(lists.size).toBe(6);
    for (const [id, issues] of lists) {
      const slug = id.match(/^<(.+)\.list\.example>$/)?.[1];
      expect(slug).toBeDefined();
      for (const m of issues) {
        expect(m.headers["list-unsubscribe"]).toMatch(new RegExp(`^<https://${slug}\\.example/u/\\w+>, <mailto:unsubscribe@${slug}\\.example\\?subject=unsubscribe>$`));
        expect(m.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");
        expect(m.headers.precedence).toBe("bulk");
      }
    }
    const rate = (slug: string) => {
      const issues = lists.get(`<${slug}.list.example>`)!;
      return issues.filter((m) => m.flags.seen).length / issues.length;
    };
    expect(rate("producthunt-daily")).toBe(0);
    expect(rate("shop-deals")).toBe(0);
    expect(rate("reads-digest")).toBeGreaterThanOrEqual(0.7);
    expect(rate("design-notes")).toBeGreaterThan(0.45);
    expect(rate("morning-brief")).toBeGreaterThan(0.3);
    expect(rate("morning-brief")).toBeLessThan(0.5);
    expect(rate("frontend-weekly")).toBeLessThan(0.25);
  });

  test("calendar invites carry an .ics part, at least three in the last 14 days", () => {
    const invites = inbox(mail).filter((m) => m.attachments.some((a) => a.contentType === "text/calendar"));
    for (const m of invites) {
      expect(m.from.address).toBe("calendar-notification@calendar.example");
      expect(m.headers["auto-submitted"]).toBe("auto-generated");
      expect(m.attachments[0]).toMatchObject({ filename: "invite.ics", contentType: "text/calendar" });
    }
    expect(invites.filter((m) => NOW - at(m) <= 14 * DAY).length).toBeGreaterThanOrEqual(3);
  });

  test("attachments include the big deck, the contract, receipts and e-tickets", () => {
    const files = mail.flatMap((m) => m.attachments.map((a) => ({ ...a, from: m.from.address })));
    expect(files.find((f) => f.filename === "deck.pdf")?.size).toBeGreaterThanOrEqual(4_000_000);
    expect(files.some((f) => f.filename === "contract.pdf" && f.from === "lina@kaizen-studio.example")).toBe(true);
    const receipts = files.filter((f) => f.from === "receipts@stripe.example");
    expect(receipts.length).toBeGreaterThan(3);
    for (const f of receipts) expect(f.size).toBeGreaterThanOrEqual(40_000);
    for (const f of files.filter((f) => f.from === "tickets@skyline-air.example")) expect(f.size).toBeGreaterThan(1_400_000);
  });

  test("daily volume follows the weekday/weekend rhythm", () => {
    const today = new Date(NOW);
    today.setHours(0, 0, 0, 0);
    for (let d = 1; d < 45; d++) {
      const start = new Date(today);
      start.setDate(start.getDate() - d);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const day = mail.filter((m) => at(m) >= start.getTime() && at(m) < end.getTime());
      const received = inbox(day).length;
      const out = sent(day).length;
      if (start.getDay() === 0 || start.getDay() === 6) {
        expect(received).toBeGreaterThanOrEqual(3);
        expect(received).toBeLessThanOrEqual(6);
        expect(out).toBeLessThanOrEqual(1);
      } else {
        expect(received).toBeGreaterThanOrEqual(10);
        expect(received).toBeLessThanOrEqual(16);
        expect(out).toBeGreaterThanOrEqual(3);
        expect(out).toBeLessThanOrEqual(6);
      }
    }
    // The dashboard reads 30 days; that slice is the ≈350–450 message mailbox it sees.
    const month = mail.filter((m) => NOW - at(m) <= 30 * DAY).length;
    expect(month).toBeGreaterThanOrEqual(350);
    expect(month).toBeLessThanOrEqual(480);
  });

  test("people mail is mostly read except the newest six; a few things are flagged", () => {
    const people = inbox(mail).filter((m) => !automated(m)).sort((a, b) => at(b) - at(a));
    expect(people.slice(0, 6).every((m) => !m.flags.seen)).toBe(true);
    expect(people.slice(6).every((m) => m.flags.seen)).toBe(true);
    const flagged = mail.filter((m) => m.flags.flagged).length;
    expect(flagged).toBeGreaterThanOrEqual(2);
    expect(flagged).toBeLessThanOrEqual(6);
    const ccOnly = people.filter((m) => !m.to.some((a) => a.address === DEV_SELF.address));
    expect(ccOnly.length).toBeGreaterThanOrEqual(2);
    for (const m of ccOnly) expect(m.cc).toContainEqual(DEV_SELF);
  });

  describe.each(SCENARIOS)("obligations when now is %s", (_label, now) => {
    const list = generateSyntheticMail({ now });

    test("needs-reply holds 5–9 asks", () => {
      const needs = needsReply(list, now);
      expect(needs.length).toBeGreaterThanOrEqual(5);
      expect(needs.length).toBeLessThanOrEqual(9);
    });

    test("ghosted holds 3–6 sends, including Priya's from about two days ago", () => {
      const waiting = ghosted(list, now);
      expect(waiting.length).toBeGreaterThanOrEqual(3);
      expect(waiting.length).toBeLessThanOrEqual(6);
      for (const m of waiting) {
        expect(now - at(m)).toBeGreaterThanOrEqual(2 * DAY);
        expect(now - at(m)).toBeLessThanOrEqual(10 * DAY);
      }
      const priya = waiting.find((m) => m.to[0]?.address === "priya@fieldwork.example");
      expect(priya).toBeDefined();
      expect(now - at(priya!)).toBeLessThan(3 * DAY);
    });
  });
});
