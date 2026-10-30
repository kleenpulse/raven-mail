import { fold } from "@/lib/search/text";
import porter2 from "wink-porter2-stemmer";
import { CONCEPTS } from "@/lib/kage/lexicon";

/**
 * Text → weighted features: word stems plus `#concept` hits from the lexicon.
 * Both sides of every match (state and criteria) go through here, so a
 * question that says "invoice" meets a label that says "receipts".
 */
export type Features = Map<string, number>;

/** No decision signal on either side. Kept short: criteria are short too. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a an the and or of to in on at for by with from as is are was were be been being am it its this that these those " +
    "there here what which who whom whose when where why how do does did done have has had having can could would " +
    "should will shall may might must i me my mine we us our you your yours he she him her his they them their " +
    "any anything all some something email emails mail mails message messages user users please just also only " +
    "very really get got give show tell let lets want wants like into than then so if not no yes ago one ones " +
    "sent send sends received receive s t d ll ve re m im ive id youre whats thats"
  ).split(/\s+/),
);

/**
 * Jev criteria describe "the user"; questions say "me". Same person. And
 * some pairs are one word in meaning: "sign-ins", "signed in" and "log in"
 * are joined, so a signed lease doesn't look like a sign-in; "pull requests"
 * is joined, so it isn't a person's request.
 */
function normalize(text: string): string {
  return fold(text)
    .replace(/\b(sign|log)(?:ged|ed|ging|ing)?[\s-]+ins?\b/g, "$1in")
    .replace(/\b(pull|merge)[\s-]+(request)s?\b/g, "$1$2")
    .replace(/[’‘`]/g, "'")
    .replace(/\bthe user'?s\b/g, "my")
    .replace(/\bthe user\b/g, "me")
    .replace(/'/g, "");
}

/**
 * Words Porter2 would merge that mean different things in mail. "news@" is
 * not "new", "lately" is a time range where "late" is a state, and "the
 * following event" has no followers.
 */
const STEM_EXCEPTIONS: Record<string, string> = { news: "news", lately: "lately", following: "following" };

/** Porter2 is a chain of regexes; mail repeats its words. Cleared when full, so it can't grow without bound. */
const STEMS = new Map<string, string>();
const STEMS_MAX = 20_000;

/** Snowball (Porter2) English, so "invoices"/"invoice" and "scheduled"/"schedule" meet. Numbers stay as written. */
export function stem(word: string): string {
  if (/\d/.test(word)) return word;
  let out = STEMS.get(word);
  if (out === undefined) {
    out = STEM_EXCEPTIONS[word] ?? porter2(word);
    if (STEMS.size >= STEMS_MAX) STEMS.clear();
    STEMS.set(word, out);
  }
  return out;
}

function tokens(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Normalized, unstemmed words: what phrase matching sees. */
export const words = (text: string): string[] => tokens(normalize(text));

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

/** Stem → the concepts it can raise, so a concept match can be traced back to the words behind it. */
const CONCEPTS_BY_STEM = new Map<string, string[]>();
for (const concept of COMPILED) {
  const words = new Set(concept.stems);
  for (const p of concept.phrases) {
    for (const w of p.trim().split(" ")) if (w.length >= 2 && !STOPWORDS.has(w)) words.add(stem(w));
  }
  for (const s of words) CONCEPTS_BY_STEM.set(s, [...(CONCEPTS_BY_STEM.get(s) ?? []), concept.id]);
}

export const conceptsOf = (stemmed: string): readonly string[] => CONCEPTS_BY_STEM.get(stemmed) ?? [];

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
