import { fold } from "@/lib/search/text";
import { CONCEPTS } from "@/lib/kage/lexicon";

/**
 * Text → weighted features: word stems plus `#concept` hits from the lexicon.
 * Both sides of every match (state and criteria) go through here, so a
 * question that says "invoice" meets a label that says "receipts".
 */
export type Features = Map<string, number>;

/** No decision signal on either side. Kept short: criteria are short too. */
const STOPWORDS = new Set(
  (
    "a an the and or of to in on at for by with from as is are was were be been being am it its this that these those " +
    "there here what which who whom whose when where why how do does did done have has had having can could would " +
    "should will shall may might must i me my mine we us our you your yours he she him her his they them their " +
    "any anything all some something email emails mail mails message messages user users please just also only " +
    "very really get got give show tell let lets want wants like into than then so if not no yes ago one ones " +
    "sent send sends received receive s t d ll ve re m im ive id youre whats thats"
  ).split(/\s+/),
);

/** Jev criteria describe "the user"; questions say "me". Same person. */
function normalize(text: string): string {
  return fold(text)
    .replace(/[’‘`]/g, "'")
    .replace(/\bthe user'?s\b/g, "my")
    .replace(/\bthe user\b/g, "me")
    .replace(/'/g, "");
}

function undouble(w: string): string {
  return /([b-df-hj-kmnp-rtv-y])\1$/.test(w) ? w.slice(0, -1) : w;
}

/** Light suffix stripping: enough for "invoices"/"invoice" and "scheduled"/"schedule" to meet. */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("ied") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) w = undouble(w.slice(0, -3));
  else if (w.endsWith("ed") && w.length > 4) w = undouble(w.slice(0, -2));
  else if (w.endsWith("ly") && w.length > 5) w = w.slice(0, -2);
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

function tokens(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

type CompiledConcept = { id: string; stems: Set<string>; phrases: string[]; symbols: string[] };

const COMPILED: CompiledConcept[] = Object.entries(CONCEPTS).map(([id, terms]) => {
  const stems = new Set<string>();
  const phrases: string[] = [];
  const symbols: string[] = [];
  for (const term of terms) {
    if (!/[\p{L}\p{N}]/u.test(term)) {
      symbols.push(term);
      continue;
    }
    const words = tokens(normalize(term));
    if (words.length === 1) stems.add(stem(words[0]!));
    else phrases.push(` ${words.join(" ")} `);
  }
  return { id: `#${id}`, stems, phrases, symbols };
});

/** Repeated hits saturate: one strong cue matters, the tenth adds little. */
const MAX_CONCEPT_HITS = 3;

export function features(text: string): Features {
  const out: Features = new Map();
  if (!text) return out;
  const normalized = normalize(text);
  const words = tokens(normalized);
  const spaced = ` ${words.join(" ")} `;
  const stems = words.map(stem);
  const stemSet = new Set(stems);

  words.forEach((word, i) => {
    if (word.length < 2 || STOPWORDS.has(word)) return;
    const s = stems[i]!;
    out.set(s, (out.get(s) ?? 0) + 1);
  });

  for (const concept of COMPILED) {
    let hits = 0;
    for (const s of concept.stems) if (stemSet.has(s)) hits += 1;
    for (const p of concept.phrases) if (spaced.includes(p)) hits += 1;
    for (const sym of concept.symbols) if (text.includes(sym)) hits += 1;
    if (hits) out.set(concept.id, Math.min(MAX_CONCEPT_HITS, hits));
  }
  return out;
}

export function merge(into: Features, from: Features, factor = 1): Features {
  for (const [k, v] of from) into.set(k, (into.get(k) ?? 0) + v * factor);
  return into;
}

export const isConcept = (feature: string) => feature.startsWith("#");
