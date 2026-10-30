/**
 * Fits Kage's confidence settings (`KAGE_TUNING` in lib/kage/engine.ts): a
 * grid over temperature, the coverage pull and `none`, scored by Brier on the
 * dev split (Ask intent and triage category, averaged). The feature weights
 * (`shape`, `operator`) stay at their committed values; they were swept on
 * their own. `bun scripts/kage-fit.ts`.
 *
 * Only dev picks the winner. Holdout is printed for the winner and for the
 * current settings, never for the rest of the grid. Blind is not imported.
 * Before ranking, settings are thrown out if the trash rule fires on mail
 * that isn't a promotion, any rule gains a false positive
 * (test/fixtures/rules) or loses a true positive, or Ask intent gets a worse
 * Brier than the committed settings. Dev is small, so the winner is not the lowest
 * Brier: among settings within one standard error of it, the one with the
 * highest temperature wins, then the lowest Brier. Temperature is the only
 * field that makes Kage surer; left free, the grid drives it to its floor
 * chasing noise. The pulls only make Kage less sure, so they aren't held back.
 */

export {};

// Server modules import "server-only", which throws outside React Server Components.
Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { decide, KAGE_TUNING } = await import("@/lib/kage/engine");
const { planAsk } = await import("@/lib/jev/ask/plan");
const { jevRank } = await import("@/lib/jev/ask/rank");
const { jevTriage } = await import("@/lib/triage/jev");
const { readAnswers, ruleRequests } = await import("@/lib/rules/engine");
const { RULE_THRESHOLDS } = await import("@/lib/rules/types");
const { ece } = await import("@/lib/dev/kage-stats");
const { ASK_CASES, CONTACTS } = await import("@/test/fixtures/kage/ask");
const { TRIAGE_CASES } = await import("@/test/fixtures/kage/triage");
const { RANK_CASES } = await import("@/test/fixtures/kage/rank");
const { MAIL, RULES } = await import("@/test/fixtures/rules");
type KageTuning = import("@/lib/kage/engine").KageTuning;
type DecisionClient = import("@/lib/kage").DecisionClient;
type EnrichedRow = import("@/lib/insights/metrics").EnrichedRow;

type Split = "dev" | "holdout";
type Fit = {
  tuning: KageTuning;
  brier: number;
  /** Standard error of `brier`. */
  se: number;
  intent: number;
  intentBrier: number;
  intentEce: number;
  category: number;
  categoryBrier: number;
  categoryEce: number;
  rankTop1: string;
  rankNone: string;
  rulesTp: number;
  rulesFp: number;
  trashFp: number;
};

const NOW = Date.now();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function client(tuning: KageTuning): DecisionClient {
  return { systemOne: async (request) => decide(request, tuning) };
}

function rankRows(pool: (typeof RANK_CASES)[number]["pool"]): EnrichedRow[] {
  return pool.map(
    (p, i) =>
      ({
        uid: i,
        path: "INBOX",
        folder: "inbox",
        from: { name: p.from, address: `${p.from.toLowerCase().replace(/\W+/g, ".")}@example.com` },
        subject: p.subject,
        preview: p.preview,
        date: NOW - p.hoursAgo * 3_600_000,
      }) as unknown as EnrichedRow,
  );
}

/** Rules don't depend on the split: the whole labelled set, with the trash rule held to zero false positives. */
async function rules(c: DecisionClient) {
  let tp = 0;
  let fp = 0;
  let trashFp = 0;
  for (const m of MAIL) {
    const p = new Map<string, number>();
    for (const { ruleIds, request } of ruleRequests(RULES, m)) {
      for (const [id, v] of readAnswers(ruleIds, (await c.systemOne(request)).answers)) p.set(id, v);
    }
    for (const rule of RULES) {
      if (p.get(rule.id)! < RULE_THRESHOLDS[rule.action]) continue;
      if (m.fits.includes(rule.id)) tp++;
      else {
        fp++;
        if (rule.action === "trash") trashFp++;
      }
    }
  }
  return { rulesTp: tp, rulesFp: fp, trashFp };
}

async function score(tuning: KageTuning, split: Split): Promise<Fit> {
  const jev = { client: client(tuning), source: "kage" as const };
  const intent: { confidence: number; ok: boolean }[] = [];
  for (const c of ASK_CASES.filter((c) => c.split === split)) {
    const plan = await planAsk({ question: c.q }, CONTACTS, jev);
    intent.push({ confidence: plan.intentConfidence, ok: plan.intent === c.intent || (c.alt ?? []).includes(plan.intent) });
  }
  const category: { confidence: number; ok: boolean }[] = [];
  for (const c of TRIAGE_CASES.filter((c) => c.split === split)) {
    const t = await jevTriage({ subject: c.subject, from: c.from, snippet: c.snippet }, { jev });
    category.push({ confidence: t.confidence, ok: t.category === c.category || (c.alt ?? []).includes(t.category) });
  }
  let top1 = 0;
  let top1Of = 0;
  let none = 0;
  let noneOf = 0;
  for (const c of RANK_CASES.filter((c) => c.split === split)) {
    const rows = rankRows(c.pool);
    const ranked = (await jevRank(c.question, rows, NOW, jev)) ?? [];
    const saysNone = !ranked.length || ranked.every((x) => x.low);
    if (c.noneExpected) {
      noneOf++;
      if (saysNone) none++;
    } else {
      top1Of++;
      if (!saysNone && c.expect.includes(rows.indexOf(ranked[0]!.row))) top1++;
    }
  }
  const errors = (pts: typeof intent) => pts.map((p) => (Number(p.ok) - p.confidence) ** 2);
  const variance = (xs: number[]) => mean(xs.map((x) => (x - mean(xs)) ** 2)) / (xs.length || 1);
  const intentBrier = mean(errors(intent));
  const categoryBrier = mean(errors(category));
  return {
    tuning,
    brier: r3((intentBrier + categoryBrier) / 2),
    se: Math.sqrt(variance(errors(intent)) + variance(errors(category))) / 2,
    intent: r3(mean(intent.map((p) => Number(p.ok)))),
    intentBrier: r3(intentBrier),
    intentEce: r3(ece(intent)),
    category: r3(mean(category.map((p) => Number(p.ok)))),
    categoryBrier: r3(categoryBrier),
    categoryEce: r3(ece(category)),
    rankTop1: `${top1}/${top1Of}`,
    rankNone: `${none}/${noneOf}`,
    ...(await rules(client(tuning))),
  };
}

const TEMPERATURES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const STRENGTHS = [0, 0.5, 1, 2];
const UNKNOWNS = [0, 0.5, 1];
const SPANS = [3, 6, Infinity];
const NONES = [1, 0.5, 0.35, 0.25, 0.15, 0];

const grid: KageTuning[] = [];
for (const temperature of TEMPERATURES) {
  for (const coverage of STRENGTHS) {
    // With the pull off, the other two change nothing.
    for (const unknown of coverage ? UNKNOWNS : [1]) {
      for (const span of coverage ? SPANS : [Infinity]) {
        for (const none of NONES) grid.push({ ...KAGE_TUNING, temperature, coverage, unknown, span, none });
      }
    }
  }
}

/** Kage before the fit (2026-10-30): plain softmax, no pull, no shape or operator damping. */
const BEFORE: KageTuning = { temperature: 2, coverage: 0, unknown: 1, span: Infinity, none: 1, shape: 0, operator: 1, labelKey: 1, scale: KAGE_TUNING.scale };

const fits: Fit[] = [];
for (const tuning of grid) fits.push(await score(tuning, "dev"));
const before = await score(BEFORE, "dev");
const committed = await score(KAGE_TUNING, "dev");
// A step, not a trade: no worse on asks, and no rule that fires where it didn't, or misses where it hit.
const allowed = fits
  .filter((f) => f.trashFp === 0 && f.rulesFp <= committed.rulesFp && f.rulesTp >= committed.rulesTp && f.intentBrier <= committed.intentBrier)
  .sort((a, b) => a.brier - b.brier);
const best = allowed[0]!;
const warmest = (pool: Fit[]) =>
  pool.filter((f) => f.brier <= best.brier + best.se).sort((a, b) => b.tuning.temperature - a.tuning.temperature || a.brier - b.brier)[0]!;
const chosen = warmest(allowed);
// The coverage pull alone failed the holdout gate at Checkpoint B, so the same rule also runs without it.
const pullOff = warmest(allowed.filter((f) => f.tuning.coverage === 0));

const name = (t: KageTuning) => `T=${t.temperature} cov=${t.coverage} unk=${t.unknown} span=${t.span} none=${t.none}`;
const row = (f: Fit) =>
  [
    name(f.tuning).padEnd(46),
    String(f.brier).padStart(7),
    `${f.intentBrier}/${f.intentEce}/${Math.round(f.intent * 100)}%`.padStart(18),
    `${f.categoryBrier}/${f.categoryEce}/${Math.round(f.category * 100)}%`.padStart(18),
    `${f.rankTop1} ${f.rankNone}`.padStart(10),
    `${f.rulesTp}/${f.rulesFp}/${f.trashFp}`.padStart(10),
  ].join("");
const header = ["settings".padEnd(46), "brier".padStart(7), "intent B/ECE/acc".padStart(18), "category B/ECE/acc".padStart(18), "rank 1|none".padStart(10), "rules tp/fp/trash".padStart(10)].join("");

console.log(`DEV — ${grid.length} settings; ${fits.length - allowed.length} thrown out (rules, or worse on asks)
`);
console.log(header);
for (const f of allowed.slice(0, 10)) console.log(row(f));
console.log(`
best ${best.brier} ± ${r3(best.se)}; warmest within one standard error:
${row(chosen)}`);
console.log(`same, with the coverage pull off:
${row(pullOff)}`);
console.log(`
before the fit
${row(before)}`);
console.log(`committed (KAGE_TUNING)
${row(committed)}`);

console.log(`
HOLDOUT (report only)
${header}`);
console.log(`${row(await score(chosen.tuning, "holdout"))}   ← chosen`);
console.log(`${row(await score(pullOff.tuning, "holdout"))}   ← chosen, pull off`);
console.log(`${row(await score(KAGE_TUNING, "holdout"))}   ← committed`);
console.log(`${row(await score(BEFORE, "holdout"))}   ← before the fit`);
