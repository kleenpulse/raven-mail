import { person, type EnrichedRow } from "@/lib/insights/metrics";
import type { PersonRef } from "@/lib/insights/types";
import { INTENT_META, SUGGESTED_INTENTS } from "@/lib/jev/ask/catalog";
import type { Composed } from "@/lib/jev/ask/retrieve";
import { timeframeLabel } from "@/lib/jev/ask/timeframe";
import type { AskAnswer, AskPlan, Intent } from "@/lib/jev/ask/types";

// Pure answer assembly, shared by the live pipeline and the landing page's demo mailbox.

const lc = (s: string) => s.trim().toLowerCase();

/** Contacts Jev may pick from: people you correspond with first, then everyone else by volume. */
export function knownSenders(rows: EnrichedRow[], self: string): PersonRef[] {
  const tally = new Map<string, { ref: PersonRef; count: number; person: boolean }>();
  const bump = (address: string, name: string | undefined, isPerson: boolean) => {
    const key = lc(address);
    if (!key || key === lc(self)) return;
    const entry = tally.get(key) ?? { ref: person({ address, name }), count: 0, person: false };
    entry.count += 1;
    entry.person ||= isPerson;
    if (name && !entry.ref.name.includes(" ")) entry.ref = person({ address, name });
    tally.set(key, entry);
  };
  for (const r of rows) {
    if (r.folder === "inbox") bump(r.from.address, r.from.name, r.bucket === "people");
    else for (const a of r.to) bump(a.address, a.name, true);
  }
  return [...tally.values()]
    .sort((a, b) => Number(b.person) - Number(a.person) || b.count - a.count)
    .map((e) => e.ref);
}

/** Stage detail once the plan is known, e.g. "Needs your reply · 92% via Jev". */
export function understoodDetail(plan: AskPlan): string {
  const via = plan.source === "jev" ? "Jev" : plan.source === "forced" ? "suggestion" : "keyword match";
  return `${INTENT_META[plan.intent].label} · ${Math.round(plan.intentConfidence * 100)}% via ${via}`;
}

export function scanDetail(plan: AskPlan, messages: number): string {
  return `Scanning ${messages.toLocaleString()} messages · ${timeframeLabel(plan.timeframe)}`;
}

function searchedLabel(plan: AskPlan, widened: boolean): string {
  const scope = plan.scope === "sent" ? "Sent" : plan.scope === "all" ? "Inbox + Sent" : "Inbox";
  const parts = [widened ? "Whole Inbox" : scope, timeframeLabel(plan.timeframe)];
  if (plan.sender) parts.push(`${plan.scope === "sent" ? "to" : "from"} ${plan.sender.address}`);
  if (plan.unreadOnly) parts.push("unread");
  if (plan.keywords.length && (plan.intent === "find_topic" || plan.intent === "other")) {
    parts.push(`“${plan.keywords.join(" ")}”`);
  }
  if (plan.filter) parts.push(`“${plan.filter}”`);
  return parts.join(" · ");
}

export function finalize(plan: AskPlan, question: string, composed: Composed, widened: boolean): AskAnswer {
  const unsure = plan.intent === "other" || plan.intentConfidence < 0.5;
  const options: Intent[] = unsure
    ? (plan.alternatives.length ? plan.alternatives.map((a) => a.intent) : SUGGESTED_INTENTS)
        .filter((i) => i !== plan.intent && INTENT_META[i].example)
        .slice(0, 4)
    : [];
  return {
    id: crypto.randomUUID(),
    question,
    ...composed,
    plan,
    confidence: plan.intentConfidence,
    clarify: options.length
      ? { question: "Not quite? Try one of these:", options: options.map((i) => ({ label: INTENT_META[i].example, intent: i })) }
      : undefined,
    followUps: INTENT_META[plan.intent].related
      .map((i) => INTENT_META[i].example)
      .filter(Boolean)
      .slice(0, 3),
    searched: searchedLabel(plan, widened),
    narration: null,
  };
}
