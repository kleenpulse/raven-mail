/**
 * Fits how Kage reads triage urgency (`KAGE_TUNING.scale` in
 * lib/kage/engine.ts): the cumulative-logit cut points, the slope, how much
 * the "can wait" level holds an email down, and the `#sender_bulk` /
 * `#asks_me` shifts (a `#when` shift fitted to 0 and was removed at
 * Checkpoint E). `bun scripts/kage-fit-urgency.ts [--cases]`.
 *
 * Scored by urgency MAE on the dev split (|score / 3 − label / 3|, as the
 * eval does). The rubric's evidence doesn't depend on the scale, so each email
 * is read once, through `jevTriage` with a client that records the request,
 * and the grid runs on that.
 *
 * MAE alone is a trap here: most mail is level 0 and the rubric's four short
 * lines give little to read, so "always 0" beats every engine, and the lowest
 * MAE keeps holding everything at 0 harder (no interior optimum: dev falls,
 * holdout rises). So:
 * 1. A step, not a trade: settings that make Ask's "anything pressing" filter
 *    (urgency ≥ 0.5) lose a level-2+ hit or gain a false alarm against Kage
 *    before Phase 4 are thrown out.
 * 2. Among the rest within one paired standard error of the best dev MAE, the
 *    mildest wins: the lowest first cut (evidence-free mail's P(≥ 1) is
 *    σ(−cut₁)), then the fewest active terms, then the lowest MAE.
 * Ordering (pairs put the right way round) and the pressing counts are printed
 * alongside. The chosen setting is checked end to end through `jevTriage`.
 * Holdout is printed for the chosen, committed and pre-Phase-4 settings only.
 * Blind is not imported. `--cases` lists the dev emails.
 */

export {};

// Server modules import "server-only", which throws outside React Server Components.
Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { decide, rubricEvidence, scaleLevels, KAGE_TUNING } = await import("@/lib/kage/engine");
const { jevTriage } = await import("@/lib/triage/jev");
const { heuristicTriage } = await import("@/lib/triage/heuristic");
const { TRIAGE_CASES } = await import("@/test/fixtures/kage/triage");
type ScaleTuning = import("@/lib/kage/engine").ScaleTuning;
type ScaleEvidence = import("@/lib/kage/engine").ScaleEvidence;
type DecisionClient = import("@/lib/kage").DecisionClient;
type SystemOneRequest = Parameters<DecisionClient["systemOne"]>[0];

type Split = "dev" | "holdout";
type Item = { label: number; evidence: ScaleEvidence; heuristic: number; subject: string; from: string };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function items(split: Split): Promise<Item[]> {
  const out: Item[] = [];
  for (const c of TRIAGE_CASES.filter((c) => c.split === split)) {
    const input = { subject: c.subject, from: c.from, snippet: c.snippet };
    let request: SystemOneRequest | undefined;
    const client: DecisionClient = {
      systemOne: async (r) => {
        request = r;
        return decide(r);
      },
    };
    await jevTriage(input, { jev: { client, source: "kage" } });
    out.push({
      label: c.urgency,
      evidence: rubricEvidence(request!, "urgency"),
      heuristic: heuristicTriage(input).urgency,
      subject: c.subject,
      from: c.from,
    });
  }
  return out;
}

/** Urgency as jevTriage reports it: the expected level over 3, clamped to 0–1. */
function urgency(evidence: ScaleEvidence, scale: ScaleTuning): number {
  const expected = scaleLevels(evidence, scale).reduce((sum, p, i) => sum + p * i, 0);
  return Math.max(0, Math.min(1, expected / 3));
}

/**
 * Kage's urgency before Phase 4, rebuilt from the same evidence: a softmax
 * over the levels (temperature 2), level 0 starting at 3.5, levels below 0.25
 * of evidence sharing one slot at score 0.
 */
function before({ lexical }: ScaleEvidence): number {
  const scores = lexical.map((s, i) => (i === 0 ? 3.5 + s : s));
  const live = scores.map((s, i) => i === 0 || s >= 0.25);
  const exp = scores.map((s, i) => (live[i] ? Math.exp(s / 2) : 0));
  const empty = live.filter((l) => !l).length;
  const total = exp.reduce((a, b) => a + b, 0) + (empty ? 1 : 0);
  const probs = exp.map((e, i) => (live[i] ? e / total : 1 / empty / total));
  return Math.max(0, Math.min(1, probs.reduce((sum, p, i) => sum + p * i, 0) / 3));
}

const errors = (data: Item[], scale: ScaleTuning) => data.map((d) => Math.abs(urgency(d.evidence, scale) - d.label / 3));
const levelAcc = (data: Item[], scale: ScaleTuning) => mean(data.map((d) => Number(Math.round(urgency(d.evidence, scale) * 3) === d.label)));

/**
 * Ordering: over pairs of emails with different labels, the share the score
 * puts the right way round (a tie counts half). MAE alone rewards calling
 * everything level 0, since most mail is; the app sorts and filters by
 * urgency, so the order is what it uses.
 */
function concordance(labels: number[], scores: number[]): number {
  let right = 0;
  let pairs = 0;
  for (let i = 0; i < labels.length; i++)
    for (let j = 0; j < labels.length; j++) {
      if (labels[i]! <= labels[j]!) continue;
      pairs++;
      const d = scores[i]! - scores[j]!;
      right += Math.abs(d) < 1e-6 ? 0.5 : d > 0 ? 1 : 0;
    }
  return pairs ? right / pairs : 0.5;
}
const order = (data: Item[], scale: ScaleTuning) => concordance(data.map((d) => d.label), data.map((d) => urgency(d.evidence, scale)));
const keywordOrder = (data: Item[]) => concordance(data.map((d) => d.label), data.map((d) => d.heuristic));
/** Ask's "anything pressing" filter (urgency ≥ 0.5) against emails labelled level 2 or 3: hits / false alarms of all. */
function pressingCounts(data: Item[], score: (d: Item) => number) {
  const flagged = data.filter((d) => score(d) >= 0.5);
  return { hit: flagged.filter((d) => d.label >= 2).length, of: data.filter((d) => d.label >= 2).length, false: flagged.filter((d) => d.label < 2).length };
}
const pressing = (data: Item[], score: (d: Item) => number) => {
  const p = pressingCounts(data, score);
  return `${p.hit}/${p.of} hit, ${p.false} false`;
};
const zeroMae = (data: Item[]) => r3(mean(data.map((d) => d.label / 3)));

function pairedSe(a: number[], b: number[]): number {
  const d = a.map((x, i) => x - b[i]!);
  const m = mean(d);
  return Math.sqrt(mean(d.map((x) => (x - m) ** 2)) / (d.length || 1));
}

const SLOPES = [0.15, 0.25, 0.5, 0.75, 1];
const FLOORS = [0, 0.5, 1, 2, 3, 4, 6];
const FIRST = [0, 1, 2, 3, 4, 5, 6, 8];
const GAPS = [0.5, 1, 2, 3, 4];
const BULKS = [0, 1, 2, 4, 8];
const ASKS = [0, 0.5, 1, 1.5, 2];

const grid: ScaleTuning[] = [];
for (const slope of SLOPES)
  for (const floor of FLOORS)
    for (const c1 of FIRST)
      for (const g2 of GAPS)
        for (const g3 of GAPS)
          for (const bulk of BULKS)
            for (const asks of ASKS) grid.push({ cuts: [c1, c1 + g2, c1 + g2 + g3], slope, floor, bulk, asks });

const active = (s: ScaleTuning) => Number(s.floor !== 0) + Number(s.bulk !== 0) + Number(s.asks !== 0);
const name = (s: ScaleTuning) => `cuts=${s.cuts.join("/")} slope=${s.slope} floor=${s.floor} bulk=${s.bulk} asks=${s.asks}`;

const dev = await items("dev");
const committed = { scale: KAGE_TUNING.scale, mae: mean(errors(dev, KAGE_TUNING.scale)) };
// A step, not a trade: "anything pressing" may not lose a hit or gain a false alarm.
const floorPressing = pressingCounts(dev, (d) => before(d.evidence));
const all = grid.map((scale) => {
  const e = errors(dev, scale);
  return { scale, e, mae: mean(e) };
});
all.sort((a, b) => a.mae - b.mae);
const fits = all.filter((f) => {
  const p = pressingCounts(dev, (d) => urgency(d.evidence, f.scale));
  return p.hit >= floorPressing.hit && p.false <= floorPressing.false;
});
const best = fits[0]!;
const window = fits.filter((f) => f.mae <= best.mae + pairedSe(f.e, best.e) + 1e-9);
// Mildest: the lowest first cut, which holds evidence-free mail at level 0 least hard
// (its P(≥ 1) is σ(−cut₁)). Then fewer active terms, then the lowest MAE.
const chosen = [...window].sort((a, b) => a.scale.cuts[0]! - b.scale.cuts[0]! || active(a.scale) - active(b.scale) || a.mae - b.mae)[0]!;
const beforeRow = (data: Item[]) =>
  `${"before Phase 4".padEnd(62)} MAE ${String(r3(mean(data.map((d) => Math.abs(before(d.evidence) - d.label / 3))))).padEnd(6)} order ${String(r3(concordance(data.map((d) => d.label), data.map((d) => before(d.evidence))))).padEnd(6)} pressing ${pressing(data, (d) => before(d.evidence))}`;
const heuristicMae = (data: Item[]) => r3(mean(data.map((d) => Math.abs(d.heuristic - d.label / 3))));

const row = (scale: ScaleTuning, data: Item[]) =>
  `${name(scale).padEnd(62)} MAE ${String(r3(mean(errors(data, scale)))).padEnd(6)} order ${String(r3(order(data, scale))).padEnd(6)} level acc ${Math.round(levelAcc(data, scale) * 100)}%  pressing ${pressing(data, (d) => urgency(d.evidence, scale))}`;

console.log(`DEV — ${grid.length} settings, ${dev.length} emails; keywords MAE ${heuristicMae(dev)} order ${r3(keywordOrder(dev))} pressing ${pressing(dev, (d) => d.heuristic)}; always 0: MAE ${zeroMae(dev)} order 0.5\n`);
for (const f of all.slice(0, 3)) console.log(row(f.scale, dev));
console.log(`\n${all.length - fits.length} thrown out (pressing lost a hit or gained a false alarm vs before Phase 4: ${floorPressing.hit}/${floorPressing.of} hit, ${floorPressing.false} false)
best ${r3(best.mae)}; ${window.length} settings within one paired SE`);
for (const n of [0, 1, 2, 3]) {
  const f = window.filter((w) => active(w.scale) === n).sort((a, b) => a.mae - b.mae)[0];
  if (f) console.log(`  ${n} active: ${row(f.scale, dev)}`);
}
// The plan's shape terms, on their own: the best setting that uses each.
for (const [label, keep] of [["bulk on", (s: ScaleTuning) => s.bulk > 0], ["asks on", (s: ScaleTuning) => s.asks > 0]] as const) {
  const f = fits.find((x) => keep(x.scale));
  if (f) console.log(`  best with ${label}: ${row(f.scale, dev)}${window.includes(f) ? "" : "  (outside the window)"}`);
}
console.log(`\nchosen   ${row(chosen.scale, dev)}`);
console.log(`committed ${row(committed.scale, dev)}`);
console.log(`          ${beforeRow(dev)}`);

// End to end through jevTriage, to prove the shortcut matches the engine.
let e2e = 0;
const tuned = { ...KAGE_TUNING, scale: chosen.scale };
for (const c of TRIAGE_CASES.filter((c) => c.split === "dev")) {
  const client: DecisionClient = { systemOne: async (r) => decide(r, tuned) };
  const t = await jevTriage({ subject: c.subject, from: c.from, snippet: c.snippet }, { jev: { client, source: "kage" } });
  e2e += Math.abs(t.urgency - c.urgency / 3);
}
console.log(`chosen, end to end through jevTriage: MAE ${r3(e2e / dev.length)}`);

if (process.argv.includes("--cases")) {
  console.log("\nDEV CASES (label · chosen · committed · keywords · evidence per level · bulk)");
  for (const d of dev) {
    const lex = d.evidence.lexical.map((x) => x.toFixed(1)).join(" ");
    console.log(
      `${d.label}  ${(urgency(d.evidence, chosen.scale) * 3).toFixed(1)}  ${(urgency(d.evidence, committed.scale) * 3).toFixed(1)}  ${(d.heuristic * 3).toFixed(1)}  [${lex}] ${d.evidence.bulk}  ${d.subject.slice(0, 50)} — ${d.from}`,
    );
  }
}

const holdout = await items("holdout");
console.log(`\nHOLDOUT (report only, ${holdout.length} emails; keywords MAE ${heuristicMae(holdout)} order ${r3(keywordOrder(holdout))} pressing ${pressing(holdout, (d) => d.heuristic)}; always 0: MAE ${zeroMae(holdout)})`);
console.log(`chosen    ${row(chosen.scale, holdout)}`);
console.log(`committed ${row(committed.scale, holdout)}`);
console.log(`          ${beforeRow(holdout)}`);
