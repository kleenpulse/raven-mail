import "server-only";
import type { MailSession } from "@/lib/session";
import { getSnapshot } from "@/lib/mail/snapshot";
import { computeOverview, enrichSnapshot, person, type EnrichedRow } from "@/lib/insights/metrics";
import type { Snapshot } from "@/lib/insights/types";
import { jevFor } from "@/lib/jev/client";
import { finalize, knownSenders, scanDetail, understoodDetail } from "@/lib/jev/ask/answer";
import { planAsk } from "@/lib/jev/ask/plan";
import { execute, type Ranked } from "@/lib/jev/ask/retrieve";
import { jevRank } from "@/lib/jev/ask/rank";
import { searchMailbox } from "@/lib/jev/ask/search";
import { narrator } from "@/lib/jev/ask/narrate";
import type { AskEvent, AskRequest } from "@/lib/jev/ask/types";

function enrichExtra(snapshot: Snapshot, rows: Snapshot["rows"], now: number, tz: string): EnrichedRow[] {
  if (rows.length === 0) return [];
  return enrichSnapshot({ ...snapshot, rows }, { now, tz }).rows;
}

/**
 * understand → search → rank → answer, streamed as events so the panel can
 * show Jev working. Counts and dates are computed here, never by Jev.
 */
export async function* runAsk(
  session: MailSession,
  request: AskRequest,
  { tz, signal }: { tz: string; signal?: AbortSignal },
): AsyncGenerator<AskEvent> {
  yield { type: "stage", stage: "understand", detail: "Reading your question" };

  const jev = jevFor(session, { interactive: true });
  const now = Date.now();
  const snapshot = await getSnapshot(session, { days: 30 });
  const { rows, local, today } = enrichSnapshot(snapshot, { now, tz });
  const overview = computeOverview(snapshot, { now, tz, self: [session.email] });

  const plan = await planAsk(request, knownSenders(rows, session.email), jev, signal);
  if (request.context?.uid && request.context.folder && !plan.sender) {
    const current = rows.find((r) => r.path === request.context!.folder && String(r.uid) === request.context!.uid);
    if (current && (plan.intent === "from_person" || plan.intent === "response_time")) {
      plan.sender = person(current.folder === "inbox" ? current.from : (current.to[0] ?? current.from));
      plan.senderConfidence = 1;
    }
  }
  // "What needs my reply today?" means "as of today", not "arrived today".
  if ((plan.intent === "needs_reply" || plan.intent === "awaiting_others") && plan.timeframe === "today") {
    plan.timeframe = "any";
  }
  yield { type: "stage", stage: "understand", detail: understoodDetail(plan) };
  if (signal?.aborted) return;

  let extra: EnrichedRow[] = [];
  const topical = (plan.intent === "find_topic" || plan.intent === "other") && plan.keywords.length > 0;
  if (topical) {
    yield { type: "stage", stage: "search", detail: `Searching your mailbox for “${plan.keywords.join(" ")}”` };
    const found = await searchMailbox(session, plan.keywords).catch(() => []);
    extra = enrichExtra(snapshot, found, now, tz);
  } else {
    yield { type: "stage", stage: "search", detail: scanDetail(plan, rows.length) };
  }

  const execution = execute(plan, { now, today, local, rows, overview, extraRows: extra, question: request.question });
  let ranked: Ranked[] = execution.candidates.map((row) => ({ row }));
  if (execution.rankable && jev) {
    const pool = Math.min(execution.candidates.length, 120);
    yield { type: "stage", stage: "rank", detail: `Ranking ${pool} ${pool === 1 ? "candidate" : "candidates"} with ${jev.source === "kage" ? "Kage" : "Jev"}` };
    const byJev = await jevRank(request.question, execution.candidates, now, jev, signal);
    if (byJev) ranked = byJev;
  }
  if (signal?.aborted) return;

  const answer = finalize(plan, request.question, execution.compose(ranked), extra.length > 0);
  if (narrator) answer.narration = await narrator(answer, signal).catch(() => null);
  yield { type: "answer", answer };
}
