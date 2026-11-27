import type { ThreadRow } from "@/lib/mail/thread";
import { heuristicTriage } from "@/lib/triage/heuristic";
import type { MailSummary, TriageCategory } from "@/lib/mail/types";

export const OPTIONAL_TABS = ["updates", "newsletters", "receipts", "promotions", "social"] as const;
export type OptionalTab = (typeof OPTIONAL_TABS)[number];
export const SPLIT_TABS = ["all", "important", ...OPTIONAL_TABS] as const;
export type SplitTab = (typeof SPLIT_TABS)[number];
export type HomeTab = Exclude<SplitTab, "all">;
export const HOME_TABS = ["important", ...OPTIONAL_TABS] as const satisfies readonly HomeTab[];

export const TAB_LABEL: Record<SplitTab, string> = {
  all: "All",
  important: "Important",
  updates: "Updates",
  newsletters: "Newsletters",
  receipts: "Receipts",
  promotions: "Promotions",
  social: "Social",
};

export const TAB_FILL = 25;

export function tabOf(category: TriageCategory, shown: readonly OptionalTab[]): HomeTab {
  return (shown as readonly string[]).includes(category) ? (category as OptionalTab) : "important";
}

type Triaged = Pick<MailSummary, "folder" | "uid" | "subject" | "preview" | "from">;

export function categoryOf(m: Triaged, deep: ReadonlyMap<string, { category: TriageCategory }>): TriageCategory {
  return (
    deep.get(`${m.folder}:${m.uid}`)?.category ??
    heuristicTriage({ subject: m.subject, snippet: m.preview, from: m.from.address }).category
  );
}

export function ofKinds<T extends Triaged>(
  messages: readonly T[],
  kinds: readonly HomeTab[],
  deep: ReadonlyMap<string, { category: TriageCategory }>,
): T[] {
  return messages.filter((m) => kinds.includes(tabOf(categoryOf(m, deep), OPTIONAL_TABS)));
}

export type SplitResult = {
  tabs: { id: SplitTab; label: string; rows: number; unread: number }[];
  byTab: Map<SplitTab, ThreadRow[]>;
};

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
