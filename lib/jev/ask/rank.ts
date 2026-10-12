import "server-only";
import { choice } from "@typesafe-ai/sdk";
import { getJevClient, jevEnabled } from "@/lib/jev/client";
import { formatAge } from "@/lib/jev/ask/format";
import type { EnrichedRow } from "@/lib/insights/metrics";
import type { Ranked } from "@/lib/jev/ask/retrieve";

const POOL = 120;

function describe(row: EnrichedRow, now: number): string {
  const who = row.from.name || row.from.address;
  const ago = `${formatAge((now - row.date) / 3_600_000)} ago`;
  const preview = row.preview ? ` · ${row.preview.slice(0, 160)}` : "";
  return `${who} · ${row.subject} · ${ago}${preview}`.slice(0, 320);
}

/**
 * Semantic find: one `choice` over the candidates (+ "none"). The probability
 * mass per label is the relevance ranking. Email text only ever appears as a
 * label description — the worst a hostile email can do is rank itself higher.
 */
export async function jevRank(
  question: string,
  rows: EnrichedRow[],
  now: number,
  signal?: AbortSignal,
): Promise<Ranked[] | null> {
  if (!jevEnabled() || rows.length === 0) return null;
  const pool = rows.slice(0, POOL);
  const criteria: Record<string, string> = Object.fromEntries(pool.map((r, i) => [`m${i}`, describe(r, now)]));
  criteria.none = "None of these emails answer the question";

  try {
    const res = await getJevClient().systemOne(
      { state: { question }, questions: { best: choice("Which email best answers the user's question?", criteria) } },
      { signal },
    );
    const answer = res.answers.best;
    const probs = answer.probabilities as Record<string, number>;
    const scored = pool
      .map((row, i) => ({ row, score: Math.round((probs[`m${i}`] ?? 0) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);
    if (answer.choice === "none") {
      return scored.slice(0, 3).map((s) => ({ ...s, low: true }));
    }
    const top = scored[0]?.score ?? 0;
    return scored.filter((s) => s.score >= top * 0.1).slice(0, 8);
  } catch {
    return null;
  }
}
