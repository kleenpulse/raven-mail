/**
 * Kage with the keyword heuristics as a second opinion. Callers already work
 * out the heuristic answer, so it costs nothing to ask: when the two agree,
 * the surer one's confidence stands; when they disagree and Kage is unsure,
 * the heuristic wins. Only for Kage answers — Jev's answers are left alone.
 */

export type Opinion<L> = { label: L; confidence: number };
export type Arbitrated<L> = Opinion<L> & { by: "kage" | "heuristic" };

export function arbitrate<L>(kage: Opinion<L>, heuristic: Opinion<L>, threshold: number): Arbitrated<L> {
  if (kage.label === heuristic.label) {
    return { label: kage.label, confidence: Math.max(kage.confidence, heuristic.confidence), by: "kage" };
  }
  if (kage.confidence < threshold) return { ...heuristic, by: "heuristic" };
  return { ...kage, by: "kage" };
}

/** Kage's confidence that its yes/no is right: how far `noul` sits on its side of the cut. */
export function noulConfidence(noul: number, cut: number): number {
  return noul >= cut ? noul : 1 - noul;
}

/** Below these, a disagreeing heuristic overrules Kage. At 0 it never does; agreement still lifts confidence. */
export type ArbitrationThresholds = { intent: number; category: number; needsReply: number };

/**
 * Fitted on dev by scripts/kage-fit-arbitrate.ts. Intent: 0 — the heuristic
 * only beats Kage on dev where Kage is very sure (operator mix-ups like
 * "unread invoices"), never where it is unsure. Refitted after the email
 * shape features (2026-10-30): category 0 (0.45 now costs a dev case) and
 * needsReply 0 (0.6 scores the same on dev and holdout; the fit takes the
 * lowest). Before shape, needsReply 0.6 lifted dev 84% → 87%.
 */
export const ARBITRATION: ArbitrationThresholds = { intent: 0, category: 0, needsReply: 0 };
