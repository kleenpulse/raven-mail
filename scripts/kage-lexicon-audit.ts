/**
 * Audits Kage's lexicon (lib/kage/lexicon.ts) for words that mean two things.
 * `bun scripts/kage-lexicon-audit.ts`
 *
 * - Shared stems: a one-word term whose stem raises more than one concept.
 *   Any text with that word raises all of them ("account" is security and a
 *   system notice). Stems shared only through a phrase's words are listed
 *   apart: they don't raise a concept alone, but coverage traces words back
 *   to concepts through them.
 * - Stopword terms: a one-word term that is also a stopword. The word itself
 *   is dropped as a feature, yet it still raises its concept, so the
 *   commonest words in English can carry a concept ("got" → received).
 *
 * Exits 1 if it finds a shared one-word stem or stopword term that isn't on
 * the reviewed list below, so a lexicon edit can't bring one back unseen.
 */

import { CONCEPTS } from "@/lib/kage/lexicon";
import { STOPWORDS, stem, words } from "@/lib/kage/text";

/** Reviewed and kept on purpose, with why. */
const REVIEWED: Record<string, string> = {
  // Shared stems: the same meaning, wanted in both concepts.
  "stem:unread": "#newness and #unread: 'unread' is both what's new and the unread filter.",
  "stem:notif": "#system_notice and #automated: notifications are both.",
  "stem:market": "#promo and #automated: marketing mail is both.",
  "stem:unsubscrib": "#newsletter and #automated: a list footer is both.",
  "stem:receipt": "#money and #automated: a receipt is both.",
  "stem:thought": "#request and #person_talk: 'thoughts?' is a person asking.",
  "stem:tonight": "#urgent and #time_today: both meant.",
  // Stopword terms: the word is no feature, the concept still is.
  "stop:from": "#person, scaled down by CONCEPT_SCALE.",
  "stop:please": "#request: in an email, 'please' is a request.",
  "stop:got": "#received: 'what I got today' is about received mail.",
  "stop:received": "#received: the concept is the point; the word alone says nothing.",
};

type Use = { concept: string; term: string };

const single = new Map<string, Use[]>();
const phrase = new Map<string, Use[]>();
const stopTerms: Use[] = [];

for (const [concept, terms] of Object.entries(CONCEPTS)) {
  for (const term of terms) {
    const ws = words(term);
    if (!ws.length) continue;
    if (ws.length === 1) {
      const s = stem(ws[0]!);
      single.set(s, [...(single.get(s) ?? []), { concept, term }]);
      if (STOPWORDS.has(ws[0]!)) stopTerms.push({ concept, term });
    } else {
      for (const w of ws) {
        if (w.length < 2 || STOPWORDS.has(w)) continue;
        const s = stem(w);
        phrase.set(s, [...(phrase.get(s) ?? []), { concept, term }]);
      }
    }
  }
}

const concepts = (uses: Use[]) => [...new Set(uses.map((u) => u.concept))];
const show = (uses: Use[]) => uses.map((u) => `#${u.concept} "${u.term}"`).join(", ");

const unreviewed: string[] = [];
const seen = new Set<string>();
const flag = (key: string, line: string) => {
  seen.add(key);
  const note = REVIEWED[key];
  console.log(`${note ? "  ok  " : "  NEW "}${line}${note ? `\n        ${note}` : ""}`);
  if (!note) unreviewed.push(key);
};

console.log("Shared one-word stems (each raises every concept listed):");
for (const [s, uses] of [...single].sort()) {
  if (concepts(uses).length > 1) flag(`stem:${s}`, `${s.padEnd(12)} ${show(uses)}`);
}

console.log("\nStems a one-word term shares with another concept's phrase (coverage only):");
for (const [s, uses] of [...single].sort()) {
  const others = (phrase.get(s) ?? []).filter((p) => !concepts(uses).includes(p.concept));
  if (others.length) console.log(`        ${s.padEnd(12)} ${show(uses)}  ↔  ${show(others)}`);
}

console.log("\nOne-word terms that are stopwords:");
for (const u of stopTerms) flag(`stop:${u.term}`, `${u.term.padEnd(12)} #${u.concept}`);

const stale = Object.keys(REVIEWED).filter((key) => !seen.has(key));
if (stale.length) console.log(`
Reviewed but no longer flagged (remove from REVIEWED): ${stale.join(", ")}`);

if (unreviewed.length) {
  console.log(`\n${unreviewed.length} not reviewed: ${unreviewed.join(", ")}`);
  process.exit(1);
}
console.log("\nAll flagged entries are reviewed.");
