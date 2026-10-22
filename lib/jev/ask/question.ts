import { heuristicPlan } from "@/lib/jev/ask/heuristic-plan";

const LEADS = /^(who|whom|whose|what|which|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|any|anything|show|find|list|tell|give)\b/i;

/**
 * Whether typed text is better sent to Ask Jev than matched against commands.
 * Only orders the palette's rows; a wrong guess costs one arrow key.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  const words = t.split(/\s+/).length;
  // "show" or "find" alone is still someone looking for a command.
  if (words >= 2 && LEADS.test(t)) return true;
  if (words < 3) return false;
  const { intent } = heuristicPlan(t, []);
  return intent !== "find_topic" && intent !== "other";
}
