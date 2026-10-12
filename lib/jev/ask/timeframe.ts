import { dayDiff, shiftDateKey, type LocalParts } from "@/lib/insights/bins";
import { TIMEFRAME_META } from "@/lib/jev/ask/catalog";
import type { Timeframe } from "@/lib/jev/ask/types";

/** Jev reads dates as text, so explicit phrases are resolved here and win. */
const PHRASES: [RegExp, Timeframe][] = [
  [/\b(today|this morning|tonight|so far today)\b/i, "today"],
  [/\byesterday\b/i, "yesterday"],
  [/\bthis week\b/i, "this_week"],
  [/\b(last|past) (7 days|week)\b|\b(recently|lately)\b/i, "last_7_days"],
  [/\bthis month\b/i, "this_month"],
  [/\b(last|past) (30 days|month|few weeks)\b/i, "last_30_days"],
  [/\b(ever|all time|any ?time)\b/i, "any"],
];

export function explicitTimeframe(question: string): Timeframe | null {
  for (const [re, tf] of PHRASES) if (re.test(question)) return tf;
  return null;
}

export function matchesTimeframe(dateKey: string, today: LocalParts, tf: Timeframe): boolean {
  const ago = dayDiff(dateKey, today.dateKey);
  switch (tf) {
    case "today":
      return ago === 0;
    case "yesterday":
      return ago === 1;
    case "this_week":
      return dateKey >= shiftDateKey(today.dateKey, -today.weekday) && ago >= 0;
    case "last_7_days":
      return ago >= 0 && ago < 7;
    case "this_month":
      return dateKey.slice(0, 7) === today.dateKey.slice(0, 7) && ago >= 0;
    case "last_30_days":
      return ago >= 0 && ago < 30;
    case "any":
      return true;
  }
}

export function timeframeLabel(tf: Timeframe): string {
  return TIMEFRAME_META[tf].label;
}
