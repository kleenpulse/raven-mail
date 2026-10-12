// Non-AI text relevance, adopted from ellum-web's help-center search
// (`lib/help.ts` → `searchHelp`): tiered per-(term, word) matches over
// weighted fields. Pure: no React, no IO.
//
// - Prefix tier makes typing-in-progress work ("sched" → "schedule").
// - Fuzzy tier lands one-edit typos ("pasword" → "password").
// - Folding is Unicode-aware (NFD + \p{M}), so "CAFÉ" ⇄ "cafe".
//
// Mail-specific on top of the help search: queries are parsed into terms
// (filler words dropped, `from:`/`to:`/`subject:` operators, natural
// "from maya"), and the relaxed pass keeps the best-covered results instead
// of anything matching any word — "any word" let a filler like "from" match
// nearly every message.

export type FieldKey = "from" | "to" | "subject";
/** `key` lets a fielded term ("from:maya") score only against that field. */
export type TextField = { text: string; weight: number; key?: FieldKey };
/** `soft` = inferred from natural language ("from maya"), relaxed before giving up. */
export type Term = { token: string; field?: FieldKey; soft?: boolean };
export type TextHit<T> = { item: T; score: number };

/** Match tiers, best per (term, word) wins. */
const TIER_EXACT = 1.0;
const TIER_PREFIX = 0.75;
const TIER_SUBSTRING = 0.5; // token ≥ 2 chars — 1-char substrings are noise
const TIER_FUZZY = 0.3; // token ≥ 4 chars, Damerau-Levenshtein ≤ 1

/** Coverage-pass terms shorter than this are dropped ("a", "i"). */
const MIN_LOOSE_TOKEN = 2;

/** Words people type around the real query. Dropped only when something else remains. */
const FILLER = new Set(
  (
    "a an the about any anything all email emails mail mails message messages thread threads from to me my i is are " +
    "was were be what which who when where why how do does did have has had this that these those with in on for of " +
    "and or please can could would you re regarding related some something show find get"
  ).split(" "),
);

const OPERATOR = /^(from|to|subject):(.*)$/;

export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
}

/** Letter/number runs. Keeps "10mb" whole; splits "maya@acme.com" into maya, acme, com. */
export function words(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Query → unique folded tokens, no parsing. */
export function tokenize(query: string | string[]): string[] {
  return [...new Set(words(Array.isArray(query) ? query.join(" ") : query))];
}

export const termKey = (t: Term) => `${t.field ?? ""}:${t.token}`;
const plain = (t: Term): Term => ({ token: t.token });

/**
 * Query → terms. `from:maya` / `to:` / `subject:` are hard field filters;
 * "from maya" is a soft sender filter; filler words are dropped unless
 * nothing else is left ("about" alone still searches for "about").
 */
export function parseQuery(query: string | string[]): Term[] {
  const chunks = (Array.isArray(query) ? query.join(" ") : query).split(/\s+/).filter(Boolean);
  const terms: Term[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = fold(chunks[i]!);
    const op = OPERATOR.exec(chunk);
    if (op) {
      // "from: maya" — value may sit in the next chunk.
      const value = op[2] || chunks[++i] || "";
      for (const token of words(value)) terms.push({ token, field: op[1] as FieldKey });
      continue;
    }
    const next = chunk === "from" ? words(chunks[i + 1] ?? "") : [];
    if (next.length && next.every((w) => !FILLER.has(w))) {
      for (const token of next) terms.push({ token, field: "from", soft: true });
      i++;
      continue;
    }
    for (const token of words(chunk)) terms.push({ token });
  }
  const meaningful = terms.filter((t) => t.field || !FILLER.has(t.token));
  const seen = new Set<string>();
  return (meaningful.length ? meaningful : terms).filter((t) => {
    const key = termKey(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every term whose match set `acceptTerms` may ask for. */
export function neededTerms(terms: Term[]): Term[] {
  const out = new Map<string, Term>();
  for (const t of terms) {
    out.set(termKey(t), t);
    if (t.soft) out.set(termKey(plain(t)), plain(t));
  }
  return [...out.values()];
}

/**
 * Acceptance policy, shared by in-memory and IMAP search:
 * 1. every term, fields honored;
 * 2. every term, soft fields relaxed ("from march" → just "march");
 * 3. best coverage — hard operators still filter, and of the remaining terms
 *    (≥ 2 chars) keep keys matching the most of them.
 * Returns the accepted keys and the terms that accepted them (for scoring).
 */
export function acceptTerms<K>(terms: Term[], setOf: (t: Term) => Set<K>): { keys: K[]; terms: Term[] } {
  const every = (ts: Term[]): K[] => {
    const [first, ...rest] = ts.map(setOf);
    return first ? [...first].filter((k) => rest.every((s) => s.has(k))) : [];
  };
  if (terms.length === 0) return { keys: [], terms };

  const strict = every(terms);
  if (strict.length) return { keys: strict, terms };

  const relaxed = terms.map((t) => (t.soft ? plain(t) : t));
  if (terms.some((t) => t.soft)) {
    const keys = every(relaxed);
    if (keys.length) return { keys, terms: relaxed };
  }

  const hard = relaxed.filter((t) => t.field);
  const loose = relaxed.filter((t) => !t.field && t.token.length >= MIN_LOOSE_TOKEN);
  if (loose.length === 0) return { keys: [], terms };
  const allowed = hard.length ? new Set(every(hard)) : null;
  const counts = new Map<K, number>();
  for (const t of loose) {
    for (const k of setOf(t)) if (!allowed || allowed.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0;
  for (const n of counts.values()) if (n > best) best = n;
  const keys = [...counts].filter(([, n]) => n === best).map(([k]) => k);
  return { keys, terms: [...hard, ...loose] };
}

/** True when a ≡ b within one edit: substitution, insertion, deletion, or
 * adjacent transposition. Linear walk, no DP matrix — distance is capped at 1
 * by design (distance 2's false-positive surface is huge, and long typos
 * still land via the prefix/substring tiers). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la && i === lb) return true;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = la > lb ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

type IndexedField = { ws: string[]; weight: number; key?: FieldKey };

function index(fields: TextField[]): IndexedField[] {
  // Heaviest first so the "field can't beat current best" skip fires early.
  return fields.map((f) => ({ ws: words(f.text), weight: f.weight, key: f.key })).sort((a, b) => b.weight - a.weight);
}

/** Best tier × weight for one term across the fields it may match. */
function termScore({ token, field }: Term, doc: IndexedField[]): number {
  let best = 0;
  const fuzzyOk = token.length >= 4;
  const subOk = token.length >= 2;
  for (const { ws, weight, key } of doc) {
    if (field && key !== field) continue;
    if (weight * TIER_EXACT <= best) continue;
    for (const w of ws) {
      let tier = 0;
      if (w === token) tier = TIER_EXACT;
      else if (w.startsWith(token)) tier = TIER_PREFIX;
      else if (subOk && w.includes(token)) tier = TIER_SUBSTRING;
      else if (fuzzyOk && withinOneEdit(token, w)) tier = TIER_FUZZY;
      if (tier * weight > best) best = tier * weight;
      if (tier === TIER_EXACT) break;
    }
  }
  return best;
}

function scoreIndexed(terms: Term[], doc: IndexedField[]): number {
  if (terms.length === 0 || doc.length === 0) return 0;
  let sum = 0;
  for (const t of terms) sum += termScore(t, doc);
  return sum / (doc[0]!.weight * terms.length);
}

/** Score ∈ [0, 1]; every term exact in the heaviest field is exactly 1. */
export function scoreTerms(terms: Term[], fields: TextField[]): number {
  return scoreIndexed(terms, index(fields));
}

/** Items accepted by `acceptTerms`, scored by the terms that accepted them. Unsorted — callers pick order. */
export function searchText<T>(
  items: readonly T[],
  query: string | string[],
  fieldsOf: (item: T) => TextField[],
): TextHit<T>[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];
  const docs = items.map((item) => index(fieldsOf(item)));
  const sets = new Map<string, Set<number>>();
  const setOf = (t: Term) => {
    const key = termKey(t);
    let set = sets.get(key);
    if (!set) {
      set = new Set();
      docs.forEach((doc, i) => termScore(t, doc) > 0 && set!.add(i));
      sets.set(key, set);
    }
    return set;
  };
  const accepted = acceptTerms(terms, setOf);
  return accepted.keys.map((i) => ({ item: items[i]!, score: scoreIndexed(accepted.terms, docs[i]!) }));
}
