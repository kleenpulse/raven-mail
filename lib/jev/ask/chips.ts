import type { Overview } from "@/lib/insights/types";
import type { Intent } from "@/lib/jev/ask/types";

export type SmartChip = { label: string; intent: Intent };

/**
 * Suggested asks built from the live numbers (research: prompt chips fix the
 * blank-box problem when they reflect real state). Chips force their intent,
 * so they never spend a Jev planning call.
 */
export function smartChips(overview: Overview): SmartChip[] {
  const chips: SmartChip[] = [];
  const { kpis } = overview;
  if (kpis.needsReply > 0) {
    const people = new Set(overview.obligations.needsReply.map((r) => r.from.address.toLowerCase())).size;
    chips.push({
      label: people > 1 ? `${people} people waiting — who?` : "Who’s waiting on my reply?",
      intent: "needs_reply",
    });
  }
  if (kpis.urgentToday > 0) chips.push({ label: "What’s urgent today?", intent: "urgent" });
  if (kpis.waitingOn > 0) chips.push({ label: "Who owes me a reply?", intent: "awaiting_others" });
  const topPerson = overview.senders.find((s) => s.bucket === "people" && s.weekly[3]! > 0);
  if (topPerson) chips.push({ label: `Emails from ${topPerson.name.split(" ")[0]} this week`, intent: "from_person" });
  if (overview.newsletters.some((n) => n.grade === "D" || n.grade === "F")) {
    chips.push({ label: "Newsletters I never open", intent: "newsletters" });
  }
  if (overview.mix.find((m) => m.bucket === "transactions")?.count) {
    chips.push({ label: "Receipts from this month", intent: "receipts" });
  }
  chips.push({ label: "What did I miss today?", intent: "unread_summary" });
  chips.push({ label: "How fast do I reply?", intent: "response_time" });
  const seen = new Set<string>();
  return chips.filter((c) => !seen.has(c.intent) && seen.add(c.intent)).slice(0, 6);
}
