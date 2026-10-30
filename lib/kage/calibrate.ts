/**
 * Calibration for one Kage answer at a time, applied by the code that reads
 * it. Kage's softmax temperature is shared by every choice question (rules,
 * triage, Ask), so a question that comes out under- or overconfident is fixed
 * here instead, without moving the others.
 */

/**
 * Raises each probability to `power` and renormalises: temperature scaling
 * after the fact (a power of 1/T on a softmax is the same as dividing its
 * scores by T). Above 1 sharpens, below 1 softens; the order never changes.
 */
export function sharpen(probabilities: Record<string, number>, power: number): Record<string, number> {
  if (power === 1) return probabilities;
  const raised = Object.entries(probabilities).map(([k, p]) => [k, Math.max(0, p) ** power] as const);
  const total = raised.reduce((sum, [, p]) => sum + p, 0);
  if (!total) return probabilities;
  return Object.fromEntries(raised.map(([k, p]) => [k, p / total]));
}

/**
 * Power for Kage's Ask intent answer, fitted on dev by
 * scripts/kage-fit-calibrate.ts (2026-10-30): the lowest dev Brier. Dev intent
 * Brier 0.080 → 0.068, ECE 0.132 → 0.074; 1.5 to 1.9 all score within 0.001.
 * Kage was right on 92% of dev asks at a mean confidence of 0.835.
 */
export const INTENT_POWER = 1.7;
