/**
 * Fits the power on Kage's Ask intent probabilities (`INTENT_POWER` in
 * lib/kage/calibrate.ts). `bun scripts/kage-fit-calibrate.ts`.
 *
 * Kage's softmax temperature is shared by every choice question; cooler, the
 * rules misfire and triage tips into overconfidence. So Ask intent, which
 * comes out underconfident, gets its own one-number fit in `planAsk`, scored
 * through `planAsk` (second opinion included) by Brier on the dev split. A
 * power never changes an answer, only how sure it is, and it is one number,
 * so the lowest dev Brier wins outright. Holdout is printed for the chosen
 * power and for 1 (off). Blind is not imported.
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
const { INTENT_POWER } = await import("@/lib/kage/calibrate");
const { planAsk } = await import("@/lib/jev/ask/plan");
const { ece } = await import("@/lib/dev/kage-stats");
const { ASK_CASES, CONTACTS } = await import("@/test/fixtures/kage/ask");

type Split = "dev" | "holdout";
type Point = { ok: boolean; confidence: number };

const POWERS = Array.from({ length: 31 }, (_, i) => Math.round((0.5 + i * 0.1) * 10) / 10);
const jev = { client: kage, source: "kage" as const };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function points(intentPower: number, split: Split): Promise<Point[]> {
  const out: Point[] = [];
  for (const c of ASK_CASES.filter((c) => c.split === split)) {
    const plan = await planAsk({ question: c.q }, CONTACTS, jev, undefined, { intentPower });
    out.push({ ok: plan.intent === c.intent || (c.alt ?? []).includes(plan.intent), confidence: plan.intentConfidence });
  }
  return out;
}

function summary(pts: Point[]) {
  const errors = pts.map((p) => (Number(p.ok) - p.confidence) ** 2);
  const brier = mean(errors);
  return {
    brier,
    se: Math.sqrt(mean(errors.map((e) => (e - brier) ** 2)) / (errors.length || 1)),
    ece: ece(pts),
    acc: mean(pts.map((p) => Number(p.ok))),
    conf: mean(pts.map((p) => p.confidence)),
  };
}

const fmt = (power: number, s: ReturnType<typeof summary>) =>
  [
    String(power).padEnd(7),
    `${r3(s.brier)} ± ${r3(s.se)}`.padStart(16),
    String(r3(s.ece)).padStart(8),
    `${Math.round(s.acc * 100)}%`.padStart(6),
    String(r3(s.conf)).padStart(10),
  ].join("");
const header = ["power".padEnd(7), "brier".padStart(16), "ece".padStart(8), "acc".padStart(6), "mean conf".padStart(10)].join("");

const rows: { power: number; s: ReturnType<typeof summary> }[] = [];
for (const power of POWERS) rows.push({ power, s: summary(await points(power, "dev")) });
const best = [...rows].sort((a, b) => a.s.brier - b.s.brier)[0]!;

console.log(`ASK INTENT — dev\n${header}`);
for (const r of rows) console.log(`${fmt(r.power, r.s)}${r === best ? "   ← chosen" : ""}${r.power === 1 ? "   (off)" : ""}`);
console.log(`\nHOLDOUT (report only)\n${header}`);
console.log(`${fmt(best.power, summary(await points(best.power, "holdout")))}   ← chosen`);
console.log(`${fmt(1, summary(await points(1, "holdout")))}   ← off`);
console.log(`\nchosen ${best.power}; committed ${INTENT_POWER}`);
