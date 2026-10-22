import { describe, expect, test } from "bun:test";
import { OPTIONAL_TABS, splitRows, tabOf } from "@/lib/mail/split-inbox";
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
      { id: "important", label: "Important", rows: 2, unread: 1 },
      { id: "updates", label: "Updates", rows: 2, unread: 1 },
      { id: "promotions", label: "Promotions", rows: 1, unread: 1 },
    ]);
    expect(byTab.get("updates")!.map((r) => r.key)).toEqual(["b", "c"]);
  });

  test("tabs follow the fixed order, not the order they were turned on", () => {
    const { tabs } = splitRows([], () => "other", ["social", "updates"]);
    expect(tabs.map((t) => t.id)).toEqual(["important", "updates", "social"]);
  });

  test("every row lands somewhere", () => {
    const { byTab } = splitRows(rows, (r) => cats[r.key]!, []);
    expect(byTab.get("important")!).toHaveLength(5);
  });
});
