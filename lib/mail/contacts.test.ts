import { describe, expect, test } from "bun:test";
import { rankContacts } from "@/lib/mail/contacts";
import { matchContacts } from "@/lib/mail/contact-match";
import type { EnvelopeRow } from "@/lib/insights/types";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 86_400_000;
let n = 0;

function row(over: Partial<EnvelopeRow> & Pick<EnvelopeRow, "folder" | "from">): EnvelopeRow {
  n++;
  return {
    id: `x:${n}`,
    path: over.folder === "sent" ? "Sent" : "INBOX",
    uid: n,
    date: NOW,
    to: [],
    cc: [],
    subject: "s",
    references: [],
    seen: true,
    flagged: false,
    answered: false,
    size: 1,
    hasAttachments: false,
    attachmentBytes: 0,
    hasCalendar: false,
    autoSubmitted: false,
    bulk: false,
    ...over,
  };
}

const me = { address: "me@raven.dev" };
const opts = { self: ["ME@raven.dev"], now: NOW };

describe("rankContacts", () => {
  test("people you write to outrank people who write to you, at the same age", () => {
    const ranked = rankContacts(
      [
        row({ folder: "inbox", from: { name: "Ana", address: "ana@x.com" }, to: [me] }),
        row({ folder: "sent", from: me, to: [{ name: "Leo", address: "leo@x.com" }] }),
      ],
      opts,
    );
    expect(ranked.map((c) => c.address)).toEqual(["leo@x.com", "ana@x.com"]);
  });

  test("recent beats old; many beats one", () => {
    const ranked = rankContacts(
      [
        row({ folder: "inbox", from: { address: "old@x.com" }, date: NOW - 28 * DAY }),
        row({ folder: "inbox", from: { address: "old@x.com" }, date: NOW - 27 * DAY }),
        row({ folder: "inbox", from: { address: "new@x.com" }, date: NOW - DAY }),
        row({ folder: "inbox", from: { address: "often@x.com" }, date: NOW - 3 * DAY }),
        row({ folder: "inbox", from: { address: "often@x.com" }, date: NOW - 3 * DAY }),
        row({ folder: "inbox", from: { address: "often@x.com" }, date: NOW - 3 * DAY }),
      ],
      opts,
    );
    expect(ranked.map((c) => c.address)).toEqual(["often@x.com", "new@x.com", "old@x.com"]);
  });

  test("leaves out you, no-reply and role addresses, mailing lists and junk", () => {
    const ranked = rankContacts(
      [
        row({ folder: "inbox", from: { address: "no-reply@shop.com" } }),
        row({ folder: "inbox", from: { address: "news@paper.com" }, listId: "<news.paper.com>" }),
        row({ folder: "inbox", from: me }),
        row({ folder: "inbox", from: { address: "not an address" } }),
        row({ folder: "inbox", from: { address: "sam@x.com" }, cc: [me, { address: "lee@x.com" }] }),
      ],
      opts,
    );
    expect(ranked.map((c) => c.address)).toEqual(["sam@x.com", "lee@x.com"]);
  });

  test("keeps the newest name, merges case, and drops a name that is just the address", () => {
    const ranked = rankContacts(
      [
        row({ folder: "inbox", from: { name: "Chen, Maya", address: "Maya@x.com" }, date: NOW - 2 * DAY }),
        row({ folder: "inbox", from: { name: "Maya Chen", address: "maya@x.com" }, date: NOW - DAY }),
        row({ folder: "inbox", from: { name: "bo@x.com", address: "bo@x.com" } }),
      ],
      opts,
    );
    expect(ranked.find((c) => c.address.toLowerCase() === "maya@x.com")?.name).toBe("Maya Chen");
    expect(ranked.filter((c) => c.address.toLowerCase() === "maya@x.com")).toHaveLength(1);
    expect(ranked.find((c) => c.address === "bo@x.com")?.name).toBeUndefined();
  });
});

describe("matchContacts", () => {
  const list = [
    { name: "Chen, Maya", address: "maya@northwind.com", score: 3 },
    { name: "🦉 Night Owl", address: "owl@x.com", score: 2 },
    { address: "sam@acme.io", score: 1 },
  ];

  test("any name word, the address, or the domain, in rank order", () => {
    expect(matchContacts(list, "may", new Set()).map((c) => c.address)).toEqual(["maya@northwind.com"]);
    expect(matchContacts(list, "chen", new Set()).map((c) => c.address)).toEqual(["maya@northwind.com"]);
    expect(matchContacts(list, "night", new Set()).map((c) => c.address)).toEqual(["owl@x.com"]);
    expect(matchContacts(list, "acme", new Set()).map((c) => c.address)).toEqual(["sam@acme.io"]);
    expect(matchContacts(list, "  ", new Set())).toEqual([]);
  });

  test("addresses already in the field aren't offered again", () => {
    expect(matchContacts(list, "m", new Set(["maya@northwind.com"]))).toEqual([]);
  });
});
