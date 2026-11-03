import { describe, expect, test } from "bun:test";
import { HOME_TABS, OPTIONAL_TABS, categoryOf, ofKinds, splitRows, tabOf } from "@/lib/mail/split-inbox";
import type { ThreadRow } from "@/lib/mail/thread";
import type { TriageCategory } from "@/lib/mail/types";

const row = (key: string, unread = false) => ({ key, unread }) as unknown as ThreadRow;

describe("tabOf", () => {
  test("a shown category has its own tab", () => {
    expect(tabOf("updates", OPTIONAL_TABS)).toBe("updates");
    expect(tabOf("social", OPTIONAL_TABS)).toBe("social");
  });

  test("people's mail and anything unsorted are Important", () => {
    expect(tabOf("primary", OPTIONAL_TABS)).toBe("important");
    expect(tabOf("other", OPTIONAL_TABS)).toBe("important");
  });

  test("a category whose tab is off folds into Important, never vanishes", () => {
    expect(tabOf("promotions", ["updates"])).toBe("important");
  });
});

describe("splitRows", () => {
  const cats: Record<string, TriageCategory> = { a: "primary", b: "updates", c: "updates", d: "promotions", e: "other" };
  const rows = [row("a", true), row("b", true), row("c"), row("d", true), row("e")];

  test("rows land in their tab in order; counts are rows and unread", () => {
    const { tabs, byTab } = splitRows(rows, (r) => cats[r.key]!, ["updates", "promotions"]);
    expect(tabs).toEqual([
      { id: "all", label: "All", rows: 5, unread: 3 },
      { id: "important", label: "Important", rows: 2, unread: 1 },
      { id: "updates", label: "Updates", rows: 2, unread: 1 },
      { id: "promotions", label: "Promotions", rows: 1, unread: 1 },
    ]);
    expect(byTab.get("updates")!.map((r) => r.key)).toEqual(["b", "c"]);
  });

  test("tabs follow the fixed order, not the order they were turned on", () => {
    const { tabs } = splitRows([], () => "other", ["social", "updates"]);
    expect(tabs.map((t) => t.id)).toEqual(["all", "important", "updates", "social"]);
  });

  test("every row lands somewhere", () => {
    const { byTab } = splitRows(rows, (r) => cats[r.key]!, []);
    expect(byTab.get("important")!).toHaveLength(5);
  });

  test("All holds every row in order, whatever its tab", () => {
    const { byTab } = splitRows(rows, (r) => cats[r.key]!, ["updates", "promotions"]);
    expect(byTab.get("all")!.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

const msg = (uid: string, subject = "Lunch on Friday?", address = "sam@example.com") => ({
  folder: "INBOX",
  uid,
  subject,
  preview: "",
  from: { name: "", address },
});

describe("categoryOf", () => {
  test("deep triage wins over the heuristic", () => {
    const deep = new Map([["INBOX:1", { category: "receipts" as const }]]);
    expect(categoryOf(msg("1", "Our weekly newsletter digest"), deep)).toBe("receipts");
  });

  test("without deep triage, the heuristic decides", () => {
    expect(categoryOf(msg("1", "Our weekly newsletter digest", "news@example.com"), new Map())).toBe("newsletters");
  });
});

describe("ofKinds", () => {
  const deep = new Map<string, { category: TriageCategory }>([
    ["INBOX:1", { category: "primary" }],
    ["INBOX:2", { category: "newsletters" }],
    ["INBOX:3", { category: "other" }],
    ["INBOX:4", { category: "promotions" }],
  ]);
  const mail = ["1", "2", "3", "4"].map((uid) => msg(uid));

  test("every kind lets everything through", () => {
    expect(ofKinds(mail, HOME_TABS, deep)).toEqual(mail);
  });

  test("keeps only the kinds picked, in order", () => {
    expect(ofKinds(mail, ["newsletters", "promotions"], deep).map((m) => m.uid)).toEqual(["2", "4"]);
  });

  test("none picked lets nothing through", () => {
    expect(ofKinds(mail, [], deep)).toEqual([]);
  });

  test("a kind is the mail's own, not where a turned-off tab folds it", () => {
    // Promotions folds into Important when its tab is off; it still only notifies as Promotions.
    expect(ofKinds(mail, ["important"], deep).map((m) => m.uid)).toEqual(["1", "3"]);
  });
});
