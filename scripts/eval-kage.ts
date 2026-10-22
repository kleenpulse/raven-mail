/**
 * Scores Kage against the keyword heuristics (and Jev, when TYPESAFE_API_KEY
 * works) and writes `.test-results/kage-eval.json` for /dev/kage.
 * `bun run eval:kage [--split dev|holdout|blind] [--misses]`.
 */

export {};

// Server modules import "server-only", which throws outside React Server Components.
Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { runKageEval, writeKageEval, SPLITS } = await import("@/lib/dev/kage-eval");
type Rate = import("@/lib/dev/kage-eval").Rate;
type EngineMetrics = import("@/lib/dev/kage-eval").EngineMetrics;

const args = process.argv.slice(2);
const only = args.includes("--split") ? args[args.indexOf("--split") + 1] : null;

const report = await runKageEval({ apiKey: process.env.TYPESAFE_API_KEY?.trim() });
await writeKageEval(report);

const ROWS: [keyof EngineMetrics, string][] = [
  ["intent", "Ask intent"],
  ["intentBrier", "Intent Brier (lower is better)"],
  ["unreadOnly", "Unread-only"],
  ["scope", "Scope"],
  ["sender", "Sender"],
  ["category", "Triage category"],
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
const cell = (v: Rate | number) =>
  typeof v === "number" ? String(v) : v.total ? `${Math.round((v.hits / v.total) * 100)}%` : "–";

console.log(`Jev: ${report.jev.note}`);
for (const split of SPLITS.filter((s) => !only || s === only)) {
  console.log(`\n${split.toUpperCase()}`);
  console.log(["metric".padEnd(32), ...report.engines.map((n) => n.padStart(10))].join(""));
  for (const [key, label] of ROWS) {
    console.log([label.padEnd(32), ...report.engines.map((n) => cell(report.metrics[split][n]![key]).padStart(10))].join(""));
  }
  if (args.includes("--misses")) {
    for (const c of report.cases.filter((c) => c.split === split && c.answers.kage && !c.answers.kage.ok)) {
      console.log(`  kage miss [${c.kind}] ${c.input} → ${c.answers.kage!.value} (want ${c.expected})`);
    }
  }
}
console.log(`\nWrote .test-results/kage-eval.json in ${report.ms}ms`);
