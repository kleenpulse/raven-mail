import type {
  ChoiceQuestion,
  EntryType,
  NoulQuestion,
  Questions,
  ScoreQuestion,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import { CONCEPT_SCALE } from "@/lib/kage/lexicon";
import { shapeFeatures, shapeLinks } from "@/lib/kage/shape";
import { conceptsOf, features, isConcept, merge, type Features } from "@/lib/kage/text";

/**
 * Kage answers Jev's `systemOne` contract — `choice`, `score`, `noul` — with
 * lexical relevance instead of a model: BM25 between the state and each
 * label's criteria, concepts from the lexicon, then a softmax for
 * probabilities. Pure and synchronous: no key, no network, no prose.
 *
 * Like Jev, state is only ever evidence. A hostile email can make itself
 * look more like a label; it cannot add labels or change the questions.
 */
export const KAGE_MODEL = "kage-1";

/** Concepts outweigh single words: "invoice" ≈ "receipt" is the whole point. */
const CONCEPT_WEIGHT = 2;
/** State fields people read first carry more weight. */
const FIELD_WEIGHT: Record<string, number> = { subject: 1.5, question: 1, title: 1.5 };
const BM25_K1 = 1.2;
const BM25_B = 0.5;

/**
 * How Kage reads an ordered rubric (a `score` question) as a cumulative logit:
 * P(level ≥ k) = σ(slope × (evidence for level k or above − floor × evidence
 * for level 0) + asks − bulk − cut_k). Rubrics run from "nothing to see"
 * upwards, so level 0's wording ("can wait") counts against every step up.
 * - `cuts`: cut_k for k = 1, 2, …; a longer rubric repeats the last gap.
 * - `slope`: what one unit of BM25 evidence moves the logit.
 * - `floor`: how much level 0's evidence holds the email down.
 * - `bulk`: what a bulk sender (`#sender_bulk`) takes off every step from level 2 up.
 * - `asks`: what a question put to the reader (`#asks_me`) adds to every step.
 */
export type ScaleTuning = { cuts: number[]; slope: number; floor: number; bulk: number; asks: number };

/**
 * How sure a `choice` answer is allowed to be.
 * - `temperature`: softmax temperature, in BM25 score units.
 * - `coverage`: how hard a partial match is pulled towards an even spread.
 *   The mass kept is coverage^this, so 0 turns the pull off.
 * - `unknown`: how much a word no option of the request claims counts
 *   against the winner (1 = as much as a word a rival label claims). Filler
 *   and topics are such words, so they are weak evidence.
 * - `span`: content weight a label has to explain for full coverage. A
 *   question is a few words; an email is many, most of them beside the point.
 * - `none`: mass a winning "none of these" keeps. It wins on a head start
 *   when nothing matched, which is no reason to be sure of it.
 * - `shape`: how much an email's shape (`lib/kage/shape.ts`) counts, as a
 *   share of one concept hit. 0 turns shape off.
 * - `operator`: what an operator ("unread", "how many", "this week") still
 *   counts in a choice where the state also names a subject one of the
 *   labels is about. 1 turns the damping off.
 * - `labelKey`: what a label's key ("updates", "find_topic") counts next to
 *   its criteria, which say what the label means. 1 counts it as criteria.
 * - `scale`: how rubric (`score`) questions are read; see `ScaleTuning`.
 */
export type KageTuning = {
  temperature: number;
  coverage: number;
  unknown: number;
  span: number;
  none: number;
  shape: number;
  operator: number;
  labelKey: number;
  scale: ScaleTuning;
};

/**
 * Fitted by `bun scripts/kage-fit.ts` on the dev split, 2026-10-30: the
 * warmest setting within one standard error of the lowest Brier, with the
 * coverage pull off. Dev Brier 0.159 → 0.142, nearly all of it from `none`.
 * With the pull on, the fit picks `{ coverage: 0.5, unknown: 0, none: 0.25 }`
 * (dev 0.138), but holdout intent ECE rose 0.071 → 0.129 and failed the
 * regression gate, so it waits for review.
 *
 * `shape: 1` (2026-10-30, Phase 3.1): the smallest weight within one standard
 * error of the best allowed dev category Brier (0.090 ± 0.028 at 2.5; above
 * 2.5 rules gain false positives). Dev category 76% → 82%, Brier 0.144 →
 * 0.117, ECE 0.166 → 0.089; the GitHub rule's misfires on people's mail 5 → 2.
 *
 * `operator: 0.5` (Phase 3.2): the mildest damping that reaches the best dev
 * intent accuracy (86% → 90%), within one standard error of the best Brier
 * (0.087 ± 0.025 at 0; 0.5 gives 0.090). 0.75 sat on the edge of that window
 * and fixed no answers.
 *
 * `labelKey: 0.25` (Phase 3.3, after the Porter2 stemmer and lexicon audit):
 * the lowest dev Brier (intent and category averaged, 0.098); 0 to 1 all sit
 * within one standard error. Only 0.1 or less stops "updated" meeting the
 * `updates` key, at a small category Brier cost.
 *
 * `scale` (Phase 4, `bun scripts/kage-fit-urgency.ts`): among settings that
 * keep Ask's "anything pressing" hits without new false alarms, the mildest
 * (lowest first cut) within one paired standard error of the best dev urgency
 * MAE. Dev MAE 0.212 → 0.133, ordering 0.49 → 0.69, false "pressing" alarms
 * 3 → 0. `bulk: 8` is a cap: bulk mail stays at level 1 or below whatever it
 * says. A `#when` term (weekday, time or date) fitted to 0 and was removed
 * at Checkpoint E. The lowest MAE alone has no interior
 * optimum: it holds everything at 0 harder and harder (dev keeps falling,
 * holdout rises), since most mail is level 0 and the rubric gives little to read.
 */
export const KAGE_TUNING: KageTuning = {
  temperature: 2,
  coverage: 0,
  unknown: 0,
  span: Infinity,
  none: 0.5,
  shape: 1,
  operator: 0.5,
  labelKey: 0.25,
  scale: { cuts: [3, 3.5, 4], slope: 0.5, floor: 6, bulk: 8, asks: 2 },
};
/** Score a "none of these" label starts with: a weak match must beat it. */
const NULL_BASE = 1.5;
/** Below this, a label counts as having no evidence at all. */
const EVIDENCE_FLOOR = 0.25;
/** Every evidence-free label together weighs as one label with score 0. */
const EMPTY_POOL_SCORE = 0;

const NULL_KEYS = new Set(["none", "other", "neither", "unknown"]);
const NULL_CRITERIA =
  /\b(none of|something else|not covered|not specified|unspecified|neither|no \w+( \w+)? (is |are )?mentioned)\b/i;

export function flatten(entry: EntryType | undefined): string {
  if (entry == null) return "";
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return entry.map((e) => flatten(e as EntryType)).join(". ");
  return Object.values(entry)
    .map((v) => flatten(v as EntryType))
    .join(". ");
}

function stateFeatures(state: EntryType, tuning: KageTuning): { features: Features; shaped: boolean } {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const out: Features = new Map();
    for (const [key, value] of Object.entries(state)) {
      merge(out, features(flatten(value as EntryType)), FIELD_WEIGHT[key] ?? 1);
    }
    const shaped = "from" in state && tuning.shape > 0;
    if (shaped) merge(out, shapeFeatures(state), tuning.shape);
    return { features: out, shaped };
  }
  return { features: features(flatten(state)), shaped: false };
}

/*
 * Criteria are fixed text that repeats: bulk triage asks the same rubric and
 * labels for every email. Their features are built once and kept by text (LRU).
 * A cached map is shared, so nothing may write to it: build into a fresh map.
 */
const COMPILED_MAX = 1024;
const compiled = new Map<string, Features>();

function cached(key: string, build: () => Features): Features {
  let hit = compiled.get(key);
  if (hit) compiled.delete(key);
  else {
    hit = build();
    if (compiled.size >= COMPILED_MAX) compiled.delete(compiled.keys().next().value!);
  }
  compiled.set(key, hit);
  return hit;
}

/** Features of fixed question text (criteria, rubric levels, instructions), cached. */
const textFeatures = (text: string) => cached(`text:${text}`, () => features(text));

/** Criteria features, plus the shapes the criteria name when the state has a shape to meet them. */
function criteriaFeatures(text: string, shaped: boolean): Features {
  if (!shaped) return textFeatures(text);
  return cached(`shaped:${text}`, () => merge(new Map(textFeatures(text)), shapeLinks(text)));
}

/** "needs_reply" reads as "needs reply"; opaque ids like "m12" add nothing. */
function labelText(label: string): string {
  return /[a-z]{3,}/i.test(label) ? label.replace(/[_-]+/g, " ") : "";
}

/** Counts saturate (1 + log); a feature scaled below one hit counts linearly, so it never turns negative. */
function weight(feature: string, value: number): number {
  return (isConcept(feature) ? CONCEPT_WEIGHT * (CONCEPT_SCALE[feature] ?? 1) : 1) * (value < 1 ? value : 1 + Math.log(value));
}

function docLength(doc: Features): number {
  let n = 0;
  for (const [f, v] of doc) n += weight(f, v);
  return n || 1;
}

/** BM25 of `query` against each doc, with idf taken across the docs themselves. */
function bm25(query: Features, docs: Features[]): number[] {
  const n = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) for (const f of doc.keys()) df.set(f, (df.get(f) ?? 0) + 1);
  const lengths = docs.map(docLength);
  const avg = lengths.reduce((a, b) => a + b, 0) / (n || 1);
  return docs.map((doc, i) => {
    let score = 0;
    for (const [f, qv] of query) {
      const dv = doc.get(f);
      if (!dv) continue;
      const d = df.get(f)!;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      const tf = weight(f, dv);
      const norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * lengths[i]!) / avg));
      score += weight(f, qv) * idf * norm;
    }
    return score;
  });
}

/**
 * Scores → probabilities. Evidence-free labels share one slot of mass instead
 * of one each, so 60 unmentioned contacts don't drown the one that was named.
 */
function distribution(scores: number[], live: boolean[], temperature: number): number[] {
  const exp = scores.map((s, i) => (live[i] ? Math.exp(s / temperature) : 0));
  const empty = live.filter((l) => !l).length;
  const emptyMass = empty ? Math.exp(EMPTY_POOL_SCORE / temperature) : 0;
  const total = exp.reduce((a, b) => a + b, 0) + emptyMass;
  return exp.map((e, i) => (live[i] ? e / total : emptyMass / empty / total));
}

const round = (p: number) => Math.round(p * 10_000) / 10_000;

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
  return best;
}

/**
 * Share of the state's content weight that the winning label accounts for.
 * A word a rival label claims always counts against it ("unread newsletters"
 * is half about newsletters). A word only another question of the request is
 * about ("this month" next to a time-range question) isn't this question's
 * to explain, so it leaves the total. A word nothing claims counts by `unknown`.
 */
function coverage(state: Features, docs: Features[], top: number, elsewhere: Features, tuning: KageTuning): number {
  const explains = (doc: Features, f: string) => doc.has(f) || conceptsOf(f).some((c) => doc.has(c) && state.has(c));
  let total = 0;
  let explained = 0;
  for (const [f, v] of state) {
    const w = weight(f, v);
    if (explains(docs[top]!, f)) {
      explained += w;
      total += w;
    } else if (docs.some((doc) => explains(doc, f))) total += w;
    else if (!elsewhere.has(f)) total += w * tuning.unknown;
  }
  return total ? Math.min(1, explained / Math.min(total, tuning.span)) : 1;
}

/**
 * Words that say how to look (what's new, how many, who most, when), not what
 * to look for. "unread receipts" is about receipts; "unread" alone is its own
 * question, and with no subject around the operators keep their full weight.
 */
const OPERATORS = new Set([
  "#newness", "#unread", "#counting", "#top_people",
  "#time_today", "#time_yesterday", "#time_week", "#time_recent", "#time_month", "#time_last_month",
]);
/** What mail is about. Only these quiet the operators. */
const SUBJECTS = ["#money", "#newsletter", "#security", "#meeting", "#files", "#social", "#promo", "#shipping"];

/** An operator concept, or a word that only raises operator concepts ("unread", "most"). */
function isOperator(feature: string): boolean {
  if (isConcept(feature)) return OPERATORS.has(feature);
  const concepts = conceptsOf(feature);
  return concepts.length > 0 && concepts.every((c) => OPERATORS.has(c));
}

/**
 * The state as this choice should read it: when it names a subject that one of
 * the labels is about, its operators count for `factor` of their weight. Per
 * choice, so a timeframe question (no subject labels) still reads "this month".
 */
function operatorsDamped(state: Features, docs: Features[], factor: number): Features {
  if (factor >= 1 || !SUBJECTS.some((s) => state.has(s) && docs.some((d) => d.has(s)))) return state;
  return new Map([...state].map(([f, v]) => [f, isOperator(f) ? v * factor : v]));
}

type Choice = { labels: string[]; docs: Features[]; isNull: boolean[]; probs: number[]; top: number };

function scoreChoice(q: ChoiceQuestion, state: Features, shaped: boolean, tuning: KageTuning): Choice {
  const labels = Object.keys(q.criteria);
  const docs = labels.map((label) => {
    const text = flatten(q.criteria[label]);
    return cached(`label:${JSON.stringify([shaped, tuning.labelKey, label, text])}`, () =>
      merge(new Map(criteriaFeatures(text, shaped)), features(labelText(label)), tuning.labelKey),
    );
  });
  const isNull = labels.map((label) => NULL_KEYS.has(label.toLowerCase()) || NULL_CRITERIA.test(flatten(q.criteria[label])));
  const lexical = bm25(operatorsDamped(state, docs, tuning.operator), docs);
  const scores = lexical.map((s, i) => (isNull[i] ? NULL_BASE + s * 0.5 : s));
  const live = scores.map((s, i) => isNull[i] || s >= EVIDENCE_FLOOR);
  const probs = distribution(scores, live, tuning.temperature);
  return { labels, docs, isNull, probs, top: argmax(probs) };
}

/** The words a choice's answer accounts for; "none of these" accounts for none. */
const answered = (c: Choice): Features => (c.isNull[c.top] ? new Map() : c.docs[c.top]!);

function decideChoice({ labels, docs, isNull, probs, top }: Choice, state: Features, elsewhere: Features, tuning: KageTuning) {
  // One matched word in a question of three is weak evidence, however well it
  // matches: keep only part of the mass and spread the rest evenly. Even, so
  // the answer stays the same and only how sure Kage is changes. (Spreading it
  // the no-evidence way hands "none" the win, and that cost a quarter of dev.)
  // "None of these" wins on its head start, not on evidence: it gets a fixed share.
  const kept = isNull[top] ? tuning.none : tuning.coverage ? coverage(state, docs, top, elsewhere, tuning) ** tuning.coverage : 1;
  if (kept < 1) probs = probs.map((p) => kept * p + (1 - kept) / labels.length);
  return {
    type: "choice" as const,
    choice: labels[top]!,
    confidence: round(probs[top]!),
    probabilities: Object.fromEntries(labels.map((label, i) => [label, round(probs[i]!)])),
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function cut(cuts: number[], k: number): number {
  if (k <= cuts.length) return cuts[k - 1]!;
  const last = cuts.at(-1) ?? 0;
  const gap = cuts.length > 1 ? last - cuts.at(-2)! : 1;
  return last + gap * (k - cuts.length);
}

/**
 * Ordered rubric, read as a scale (see `ScaleTuning`): each level's wording is
 * evidence for that level *or above*, so "time-critical" also says "this
 * week". With no evidence the cut points keep it at the bottom. The answer is
 * the expected level; P(≥ k) only falls as k rises, so the levels' shares
 * never go negative.
 */
/** What a rubric reads from the state: each level's BM25 match, and the shapes that move the scale. */
export type ScaleEvidence = { lexical: number[]; bulk: number; asks: number };

function scaleEvidence(q: ScoreQuestion, state: Features): ScaleEvidence {
  const levels = q.criteria.map((c) => textFeatures(flatten(c)));
  return {
    lexical: bm25(state, levels),
    bulk: state.get("#sender_bulk") ?? 0,
    asks: state.get("#asks_me") ?? 0,
  };
}

/** The evidence a rubric question would read from this request's state; for fitting `ScaleTuning`. */
export function rubricEvidence(request: SystemOneRequest<Questions>, name: string, tuning: KageTuning = KAGE_TUNING): ScaleEvidence {
  const q = request.questions[name];
  if (q?.type !== "score") throw new Error(`${name} is not a score question`);
  return scaleEvidence(q, stateFeatures(request.state, tuning).features);
}

/** P(level = k) for each level, from the evidence. */
export function scaleLevels(
  { lexical, bulk: bulkHit, asks: asksHit }: ScaleEvidence,
  { cuts, slope, floor, bulk, asks }: ScaleTuning,
): number[] {
  const shift = asks * asksHit;
  const held = bulk * bulkHit;
  const down = floor * (lexical[0] ?? 0);
  // atLeast[k] = P(level ≥ k); atLeast[0] = 1.
  const atLeast = [1];
  let above = lexical.reduce((a, b) => a + b, 0) - (lexical[0] ?? 0);
  for (let k = 1; k < lexical.length; k++) {
    const logit = slope * (above - down) + shift - (k >= 2 ? held : 0) - cut(cuts, k);
    atLeast.push(Math.min(atLeast[k - 1]!, sigmoid(logit)));
    above -= lexical[k]!;
  }
  return atLeast.map((p, k) => p - (atLeast[k + 1] ?? 0));
}

function decideScore(q: ScoreQuestion, state: Features, tuning: ScaleTuning) {
  const probs = scaleLevels(scaleEvidence(q, state), tuning);
  const expected = probs.reduce((sum, p, i) => sum + p * i, 0);
  return {
    type: "score" as const,
    score: round(expected),
    confidence: round(Math.max(...probs)),
    legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
    probabilities: Object.fromEntries(probs.map((p, i) => [String(i), round(p)])),
  };
}

/** Words every yes/no question uses; they say nothing about this one. */
const GENERIC_NOUL = new Set(["likely", "need", "recipient", "want", "wants", "user", "email", "question"]);

function overlap(state: Features, doc: Features): number {
  let score = 0;
  for (const [f, v] of doc) {
    const sv = state.get(f);
    if (sv) score += weight(f, Math.min(v, sv));
  }
  return score;
}

/**
 * Yes/no: how much of what the question asks about shows up in the state,
 * plus how much more the state looks like the "yes" outcome than the "no".
 */
function decideNoul(q: NoulQuestion, state: Features, shaped: boolean) {
  // Every instruction is a question; its own "?" is not evidence of a request.
  const instructions = flatten(q.instructions);
  const key = cached(`noul:${instructions}`, () => {
    const out = features(instructions.replaceAll("?", " "));
    for (const f of [...out.keys()]) if (GENERIC_NOUL.has(f)) out.delete(f);
    return out;
  });
  const keyWeight = docLength(key);
  const coverage = key.size ? overlap(state, key) / keyWeight : 0;
  const yes = criteriaFeatures(flatten(q.criteria?.true), shaped);
  const no = criteriaFeatures(flatten(q.criteria?.false), shaped);
  const lean = overlap(state, yes) - overlap(state, no);
  const logit = -1.6 + 3.2 * Math.min(1, coverage) + 0.6 * lean;
  return { type: "noul" as const, noul: round(1 / (1 + Math.exp(-logit))) };
}

/** What a rubric or a yes/no question is about: its fixed wording. */
function aboutText(q: ScoreQuestion | NoulQuestion): string {
  if (q.type === "score") return q.criteria.map((c) => flatten(c)).join(". ");
  return `${flatten(q.instructions)}. ${flatten(q.criteria?.true)}. ${flatten(q.criteria?.false)}`;
}

export function decide<const Q extends Questions>(
  request: SystemOneRequest<Q>,
  tuning: KageTuning = KAGE_TUNING,
): SystemOneResult<Q> {
  const { features: state, shaped } = stateFeatures(request.state, tuning);
  const questions = Object.entries(request.questions);
  // Choices are scored first, so each can see which words the others' answers took.
  const choices = questions.map(([, q]) => (q.type === "choice" ? scoreChoice(q, state, shaped, tuning) : null));
  const about = questions.map(([, q], i) => (q.type === "choice" ? answered(choices[i]!) : textFeatures(aboutText(q))));
  const answers: Record<string, unknown> = {};
  for (const [i, [name, question]] of questions.entries()) {
    const elsewhere: Features = new Map();
    about.forEach((f, j) => j !== i && merge(elsewhere, f));
    if (question.type === "choice") answers[name] = decideChoice(choices[i]!, state, elsewhere, tuning);
    else if (question.type === "score") answers[name] = decideScore(question, state, tuning.scale);
    else answers[name] = decideNoul(question, state, shaped);
  }
  return {
    model: KAGE_MODEL,
    answers: answers as SystemOneResult<Q>["answers"],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
