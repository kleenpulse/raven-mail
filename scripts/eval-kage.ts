/**
 * Scores Kage against the keyword heuristics (and Jev, when TYPESAFE_API_KEY
 * works) and writes `.test-results/kage-eval.json` for /dev/kage.
 * `bun run eval:kage [--split dev|holdout|blind] [--misses] [--reveal-blind] [--write-baseline]`.
 *
 * Blind cases are never listed unless --reveal-blind is passed: their totals
 * are the honest number, and reading them case by case spends that honesty.
 */

import { writeFile } from "node:fs/promises";

export {};

// Server modules import "server-only", which throws outside React Server Components.
Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { runKageEval, writeKageEval, baselineOf, regressions, BASELINE_FILE, SPLITS } = await import("@/lib/dev/kage-eval");
const { wilson } = await import("@/lib/dev/kage-stats");
type Rate = import("@/lib/dev/kage-eval").Rate;
type EngineMetrics = import("@/lib/dev/kage-eval").EngineMetrics;
type KageBaseline = import("@/lib/dev/kage-eval").KageBaseline;

const args = process.argv.slice(2);
const only = args.includes("--split") ? args[args.indexOf("--split") + 1] : null;
const revealBlind = args.includes("--reveal-blind");

const report = await runKageEval({ apiKey: process.env.TYPESAFE_API_KEY?.trim(), revealBlind });
await writeKageEval(report);

const ROWS: [keyof EngineMetrics, string][] = [
  ["intent", "Ask intent"],
  ["intentBrier", "Intent Brier (lower is better)"],
  ["intentEce", "Intent ECE (lower is better)"],
  ["unreadOnly", "Unread-only"],
  ["scope", "Scope"],
  ["sender", "Sender"],
  ["category", "Triage category"],
  ["categoryEce", "Category ECE (lower is better)"],
  ["hostileCategory", "  …hostile emails"],
  ["needsReply", "Needs reply"],
  ["urgencyMae", "Urgency MAE (lower is better)"],
  ["rankTop1", "Rank top-1"],
  ["rankTop3", "Rank top-3"],
  ["rankNone", "Rank says none"],
  ["p50ms", "Latency p50 ms"],
  ["p95ms", "Latency p95 ms"],
  ["degraded", "Fell back to heuristics"],
];
const pct = (x: number) => Math.round(x * 100);
function cell(v: Rate | number): string {
  if (typeof v === "number") return String(v);
  const ci = wilson(v);
  return ci ? `${pct(v.hits / v.total)}% (${pct(ci[0])}–${pct(ci[1])})` : "–";
}
const WIDTH = 16;

console.log(`Jev: ${report.jev.note}`);
for (const split of SPLITS.filter((s) => !only || s === only)) {
  const n = report.metrics[split].kage;
  console.log(`\n${split.toUpperCase()}  (${n?.intent.total ?? 0} asks · ${n?.category.total ?? 0} emails · ${(n?.rankTop1.total ?? 0) + (n?.rankNone.total ?? 0)} searches; 95% intervals in brackets)`);
  console.log(["metric".padEnd(32), ...report.engines.map((e) => e.padStart(WIDTH))].join(""));
  for (const [key, label] of ROWS) {
    console.log([label.padEnd(32), ...report.engines.map((e) => cell(report.metrics[split][e]![key]).padStart(WIDTH))].join(""));
  }
  const agree = report.agreement[split];
  for (const kind of ["ask", "mail", "rank"] as const) {
    const a = agree[kind];
    if (a) console.log(`  ${kind.padEnd(5)} both right ${a.both} · only Kage ${a.kageOnly} · only keywords ${a.heuristicOnly} · both wrong ${a.neither}`);
  }
  if (args.includes("--misses")) {
    if (split === "blind" && report.blindHidden) {
      console.log("  blind misses hidden: pass --reveal-blind to list them (this spends the blind split)");
      continue;
    }
    for (const c of report.cases.filter((c) => c.split === split && c.answers.kage && !c.answers.kage.ok)) {
      console.log(`  kage miss [${c.kind}] ${c.input} → ${c.answers.kage!.value} (want ${c.expected})`);
    }
  }
}

if (args.includes("--write-baseline")) {
  await writeFile(BASELINE_FILE, `${JSON.stringify(baselineOf(report), null, 2)}\n`);
  console.log(`\nPinned Kage's dev and holdout numbers in ${BASELINE_FILE}`);
} else {
  const pinned = (await Bun.file(BASELINE_FILE).json().catch(() => null)) as KageBaseline | null;
  if (pinned) {
    const lost = regressions(report, pinned);
    console.log(lost.length ? `\nBelow baseline:\n  ${lost.join("\n  ")}` : "\nBaseline holds.");
  }
}
console.log(`\nWrote .test-results/kage-eval.json in ${report.ms}ms`);
