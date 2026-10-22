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
import { features, isConcept, merge, type Features } from "@/lib/kage/text";

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
/** Softmax temperature, in BM25 score units. Tuned on the dev split of the eval. */
const TEMPERATURE = 2;
/** Score a "none of these" label starts with: a weak match must beat it. */
const NULL_BASE = 1.5;
/** Where the lowest rubric level starts: most mail is "nothing to see". */
const FLOOR_BASE = 3.5;
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

function stateFeatures(state: EntryType): Features {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const out: Features = new Map();
    for (const [key, value] of Object.entries(state)) {
      merge(out, features(flatten(value as EntryType)), FIELD_WEIGHT[key] ?? 1);
    }
    return out;
  }
  return features(flatten(state));
}

/** "needs_reply" reads as "needs reply"; opaque ids like "m12" add nothing. */
function labelText(label: string): string {
  return /[a-z]{3,}/i.test(label) ? label.replace(/[_-]+/g, " ") : "";
}

function weight(feature: string, value: number): number {
  return (isConcept(feature) ? CONCEPT_WEIGHT * (CONCEPT_SCALE[feature] ?? 1) : 1) * (1 + Math.log(value));
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
function distribution(scores: number[], live: boolean[]): number[] {
  const exp = scores.map((s, i) => (live[i] ? Math.exp(s / TEMPERATURE) : 0));
  const empty = live.filter((l) => !l).length;
  const emptyMass = empty ? Math.exp(EMPTY_POOL_SCORE / TEMPERATURE) : 0;
  const total = exp.reduce((a, b) => a + b, 0) + emptyMass;
  return exp.map((e, i) => (live[i] ? e / total : emptyMass / empty / total));
}

const round = (p: number) => Math.round(p * 10_000) / 10_000;

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
  return best;
}

function decideChoice(q: ChoiceQuestion, state: Features) {
  const labels = Object.keys(q.criteria);
  const docs = labels.map((label) => features(`${labelText(label)} ${flatten(q.criteria[label])}`));
  const isNull = labels.map((label) => NULL_KEYS.has(label.toLowerCase()) || NULL_CRITERIA.test(flatten(q.criteria[label])));
  const lexical = bm25(state, docs);
  const scores = lexical.map((s, i) => (isNull[i] ? NULL_BASE + s * 0.5 : s));
  const live = scores.map((s, i) => isNull[i] || s >= EVIDENCE_FLOOR);
  const probs = distribution(scores, live);
  const top = argmax(probs);
  return {
    type: "choice" as const,
    choice: labels[top]!,
    confidence: round(probs[top]!),
    probabilities: Object.fromEntries(labels.map((label, i) => [label, round(probs[i]!)])),
  };
}

/**
 * Ordered rubric: each level is matched like a choice label. With no evidence
 * the lowest level wins — rubrics run from "nothing to see" upwards.
 */
function decideScore(q: ScoreQuestion, state: Features) {
  const levels = q.criteria.map((c) => features(flatten(c)));
  const lexical = bm25(state, levels);
  const scores = lexical.map((s, i) => (i === 0 ? FLOOR_BASE + s : s));
  const live = scores.map((s, i) => i === 0 || s >= EVIDENCE_FLOOR);
  const probs = distribution(scores, live);
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
function decideNoul(q: NoulQuestion, state: Features) {
  // Every instruction is a question; its own "?" is not evidence of a request.
  const key = features(flatten(q.instructions).replaceAll("?", " "));
  for (const f of [...key.keys()]) if (GENERIC_NOUL.has(f)) key.delete(f);
  const keyWeight = docLength(key);
  const coverage = key.size ? overlap(state, key) / keyWeight : 0;
  const yes = features(flatten(q.criteria?.true));
  const no = features(flatten(q.criteria?.false));
  const lean = overlap(state, yes) - overlap(state, no);
  const logit = -1.6 + 3.2 * Math.min(1, coverage) + 0.6 * lean;
  return { type: "noul" as const, noul: round(1 / (1 + Math.exp(-logit))) };
}

export function decide<const Q extends Questions>(request: SystemOneRequest<Q>): SystemOneResult<Q> {
  const state = stateFeatures(request.state);
  const answers: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === "choice") answers[name] = decideChoice(question, state);
    else if (question.type === "score") answers[name] = decideScore(question, state);
    else answers[name] = decideNoul(question, state);
  }
  return {
    model: KAGE_MODEL,
    answers: answers as SystemOneResult<Q>["answers"],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
