/**
 * Fits the second-opinion thresholds (`ARBITRATION` in lib/kage/arbitrate.ts):
 * for Ask intent, triage category and needsReply, the Kage confidence below
 * which a disagreeing keyword heuristic wins. `bun scripts/kage-fit-arbitrate.ts`.
 *
 * Each question is swept on its own (they don't touch each other) and scored
 * by accuracy on the dev split. Dev is small, so the winner is not the best
 * threshold: among thresholds within one standard error of the best (paired,
 * case by case), the lowest wins — the least overruling of Kage that does as
 * well. A threshold that worsens dev calibration (ECE) by more than the
 * regression gate's margin is thrown out. Holdout is printed for the chosen
 * and the off setting only. Blind is not imported.
 */

export {};

// Server modules import "server-only", which throws outside React Server Components.
Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { kage } = await import("@/lib/kage");
const { ARBITRATION } = await import("@/lib/kage/arbitrate");
const { planAsk } = await import("@/lib/jev/ask/plan");
const { jevTriage } = await import("@/lib/triage/jev");
const { ece } = await import("@/lib/dev/kage-stats");
const { ASK_CASES, CONTACTS } = await import("@/test/fixtures/kage/ask");
const { TRIAGE_CASES } = await import("@/test/fixtures/kage/triage");
type ArbitrationThresholds = import("@/lib/kage/arbitrate").ArbitrationThresholds;

type Split = "dev" | "holdout";
type Question = keyof ArbitrationThresholds;
type Point = { ok: boolean; confidence?: number };

const OFF: ArbitrationThresholds = { intent: 0, category: 0, needsReply: 0 };
const THRESHOLDS = Array.from({ length: 20 }, (_, i) => i / 20);
/** Same margin as the regression gate's error metrics (lib/dev/kage-eval.ts). */
const ECE_MARGIN = 0.02;
const jev = { client: kage, source: "kage" as const };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function points(question: Question, threshold: number, split: Split): Promise<Point[]> {
  const arbitration = { ...OFF, [question]: threshold };
  const out: Point[] = [];
  if (question === "intent") {
    for (const c of ASK_CASES.filter((c) => c.split === split)) {
      const plan = await planAsk({ question: c.q }, CONTACTS, jev, undefined, { arbitration });
      out.push({ ok: plan.intent === c.intent || (c.alt ?? []).includes(plan.intent), confidence: plan.intentConfidence });
    }
    return out;
  }
  for (const c of TRIAGE_CASES.filter((c) => c.split === split)) {
    const t = await jevTriage({ subject: c.subject, from: c.from, snippet: c.snippet }, { jev, arbitration });
    out.push(
      question === "category"
        ? { ok: t.category === c.category || (c.alt ?? []).includes(t.category), confidence: t.confidence }
        : { ok: t.needsReply === c.needsReply },
    );
  }
  return out;
}

type Row = { threshold: number; pts: Point[]; acc: number; brier?: number; ece?: number };

function summarize(threshold: number, pts: Point[]): Row {
  const calibrated = pts.every((p) => p.confidence !== undefined);
  const conf = pts.map((p) => ({ ok: p.ok, confidence: p.confidence ?? 0 }));
  return {
    threshold,
    pts,
    acc: mean(pts.map((p) => Number(p.ok))),
    brier: calibrated ? r3(mean(conf.map((p) => (Number(p.ok) - p.confidence) ** 2))) : undefined,
    ece: calibrated ? r3(ece(conf)) : undefined,
  };
}

/** Standard error of the case-by-case accuracy difference between two settings. */
function pairedSe(a: Point[], b: Point[]): number {
  const d = a.map((p, i) => Number(p.ok) - Number(b[i]!.ok));
  const m = mean(d);
  return Math.sqrt(mean(d.map((x) => (x - m) ** 2)) / (d.length || 1));
}

const fmt = (r: Row) =>
  [
    String(r.threshold).padEnd(6),
    `${r.pts.filter((p) => p.ok).length}/${r.pts.length} (${Math.round(r.acc * 100)}%)`.padStart(14),
    String(r.brier ?? "—").padStart(8),
    String(r.ece ?? "—").padStart(8),
  ].join("");

const chosen = { ...OFF };
for (const question of ["intent", "category", "needsReply"] as const) {
  const rows: Row[] = [];
  for (const t of THRESHOLDS) rows.push(summarize(t, await points(question, t, "dev")));
  const off = rows[0]!;
  const allowed = rows.filter((r) => r.ece === undefined || r.ece <= off.ece! + ECE_MARGIN + 1e-9);
  const best = [...allowed].sort((a, b) => b.acc - a.acc || a.threshold - b.threshold)[0]!;
  const pick = allowed.find((r) => r.acc >= best.acc - pairedSe(best.pts, r.pts) - 1e-9)!;
  chosen[question] = pick.threshold;

  console.log(`\n${question.toUpperCase()} — dev\n${"t".padEnd(6)}${"accuracy".padStart(14)}${"brier".padStart(8)}${"ece".padStart(8)}`);
  let last = "";
  for (const r of rows) {
    const line = fmt(r);
    // Collapse runs where nothing changes.
    const key = line.slice(6);
    if (key !== last || r === best || r === pick) console.log(`${line}${allowed.includes(r) ? "" : "   ✗ ECE"}${r === best ? "   ← best" : ""}${r === pick ? "   ← chosen" : ""}`);
    last = key;
  }
  console.log(`best ${Math.round(best.acc * 100)}% at ${best.threshold}; chosen ${pick.threshold} (lowest within one paired SE)`);
  console.log(`holdout (report only): off ${fmt(summarize(0, await points(question, 0, "holdout"))).slice(6)} · chosen ${fmt(summarize(pick.threshold, await points(question, pick.threshold, "holdout"))).slice(6)}`);
}

console.log(`\nchosen ${JSON.stringify(chosen)}\ncommitted ${JSON.stringify(ARBITRATION)}`);
