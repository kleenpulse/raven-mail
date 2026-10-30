import type { ThreadRow } from "@/lib/mail/thread";
import type { TriageCategory } from "@/lib/mail/types";

/*
 * Inbox tabs from the triage category each row already gets. Pure, so the
 * list, j/k in the shell and the tests all split the same way.
 */

export const OPTIONAL_TABS = ["updates", "newsletters", "receipts", "promotions", "social"] as const;
export type OptionalTab = (typeof OPTIONAL_TABS)[number];
export const SPLIT_TABS = ["all", "important", ...OPTIONAL_TABS] as const;
export type SplitTab = (typeof SPLIT_TABS)[number];
/** The tab a row belongs to; All is a view over every row, not a home. */
export type HomeTab = Exclude<SplitTab, "all">;

export const TAB_LABEL: Record<SplitTab, string> = {
  all: "All",
  important: "Important",
  updates: "Updates",
  newsletters: "Newsletters",
  receipts: "Receipts",
  promotions: "Promotions",
  social: "Social",
};

/** How many rows a tab should show before the list stops loading more on its own. */
export const TAB_FILL = 25;

/** People's mail, anything unsorted, and any category whose tab is turned off land in Important. */
export function tabOf(category: TriageCategory, shown: readonly OptionalTab[]): HomeTab {
  return (shown as readonly string[]).includes(category) ? (category as OptionalTab) : "important";
}

export type SplitResult = {
  tabs: { id: SplitTab; label: string; rows: number; unread: number }[];
  byTab: Map<SplitTab, ThreadRow[]>;
};

/** Each row goes to the tab of its newest message, and to All; counts are for what's loaded. */
export function splitRows(
  rows: ThreadRow[],
  categoryOf: (row: ThreadRow) => TriageCategory,
  shown: readonly OptionalTab[],
): SplitResult {
  const visible: SplitTab[] = ["all", "important", ...OPTIONAL_TABS.filter((t) => shown.includes(t))];
  const byTab = new Map<SplitTab, ThreadRow[]>(visible.map((t) => [t, []]));
  byTab.set("all", rows);
  for (const row of rows) byTab.get(tabOf(categoryOf(row), shown))!.push(row);
  return {
    byTab,
    tabs: visible.map((id) => {
      const list = byTab.get(id)!;
      return { id, label: TAB_LABEL[id], rows: list.length, unread: list.filter((r) => r.unread).length };
    }),
  };
}
