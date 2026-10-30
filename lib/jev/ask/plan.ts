import "server-only";
import { choice, noul, type Questions } from "@typesafe-ai/sdk";
import type { Jev } from "@/lib/jev/client";
import { answeredBy } from "@/lib/kage";
import { ARBITRATION, arbitrate, type ArbitrationThresholds } from "@/lib/kage/arbitrate";
import { INTENT_POWER, sharpen } from "@/lib/kage/calibrate";
import { DEFAULT_TIMEFRAME, INTENT_META, TIMEFRAME_META } from "@/lib/jev/ask/catalog";
import { forcePlan, heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { explicitTimeframe } from "@/lib/jev/ask/timeframe";
import { INTENTS, TIMEFRAMES, type AskPlan, type AskRequest, type Intent, type Timeframe } from "@/lib/jev/ask/types";
import type { PersonRef } from "@/lib/insights/types";

type LooseAnswer = {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
};

const SENDER_POOL = 60;
/** Intents too generic to survive a named contact when Kage answered. */
const YIELDS_TO_SENDER = new Set<Intent>(["other", "find_topic", "unread_summary"]);

/**
 * One Jev call decides intent, time range, scope, contact, and unread-only.
 * The question is the only state; contacts appear as labels Jev can pick.
 * Unambiguous app-side matches (explicit dates, exact names) still win —
 * Jev reads dates as text.
 */
export async function planAsk(
  request: AskRequest,
  senders: PersonRef[],
  jev: Jev | null,
  signal?: AbortSignal,
  { arbitration = ARBITRATION, intentPower = INTENT_POWER }: { arbitration?: ArbitrationThresholds; intentPower?: number } = {},
): Promise<AskPlan> {
  if (request.forcedIntent) {
    const plan = forcePlan(request.question, request.forcedIntent, senders);
    return request.filter ? { ...plan, filter: request.filter } : plan;
  }
  const heuristic = heuristicPlan(request.question, senders);
  if (!jev) return heuristic;

  const pool = senders.slice(0, SENDER_POOL);
  const questions: Questions = {
    intent: choice(
      "What does the user want from their mailbox?",
      Object.fromEntries(INTENTS.map((i) => [i, INTENT_META[i].criteria])),
    ),
    timeframe: choice(
      "Which time range does the question refer to?",
      Object.fromEntries(TIMEFRAMES.map((t) => [t, TIMEFRAME_META[t].criteria])),
    ),
    scope: choice("Which mail does the question refer to?", {
      inbox: "Mail the user received",
      sent: "Mail the user sent",
      all: "Both, or not specified",
    }),
    unreadOnly: noul("Does the user only want unread emails?"),
  };
  if (pool.length) {
    questions.sender = choice("Which known contact does the question mention, if any?", {
      ...Object.fromEntries(pool.map((p, i) => [`s${i}`, `${p.name} <${p.address}>`])),
      none: "No specific contact is mentioned",
    });
  }

  try {
    const res = await jev.client.systemOne({ state: { question: request.question }, questions }, { signal });
    const answers = res.answers as Record<string, LooseAnswer>;
    const source = answeredBy(res);
    let sender = heuristic.sender;
    let senderConfidence = heuristic.senderConfidence;
    const senderAnswer = answers.sender;
    // Kage matches contacts on words, so "receipts" would pick receipts@stripe.com; the name matcher is sharper.
    const trustSender = source !== "kage" && !(heuristic.senderConfidence && heuristic.senderConfidence >= 0.95);
    if (trustSender && senderAnswer?.choice && senderAnswer.choice !== "none") {
      const idx = Number(senderAnswer.choice.slice(1));
      if (pool[idx] && (senderAnswer.confidence ?? 0) >= 0.5) {
        sender = pool[idx];
        senderConfidence = senderAnswer.confidence;
      }
    }
    if (sender && (senderConfidence ?? 0) < 0.5) sender = undefined;

    const intentAnswer = answers.intent!;
    let intent = (INTENTS as readonly string[]).includes(intentAnswer.choice ?? "")
      ? (intentAnswer.choice as Intent)
      : heuristic.intent;
    // Kage's temperature is shared with rules and triage; its intent answer gets its own fit.
    const calibrated = source === "kage" && intentAnswer.probabilities ? sharpen(intentAnswer.probabilities, intentPower) : undefined;
    const intentProbabilities = calibrated ?? intentAnswer.probabilities;
    // Kage reads words, not people: a named contact outranks its generic guesses.
    let intentConfidence = (calibrated && intent === intentAnswer.choice ? calibrated[intent] : undefined) ?? intentAnswer.confidence ?? 0.5;
    if (source === "kage") {
      const second = arbitrate(
        { label: intent, confidence: intentConfidence },
        { label: heuristic.intent, confidence: heuristic.intentConfidence },
        arbitration.intent,
      );
      intent = second.label;
      intentConfidence = second.confidence;
    }
    if (source === "kage" && sender && (senderConfidence ?? 0) >= 0.8 && YIELDS_TO_SENDER.has(intent)) {
      intent = "from_person";
      intentConfidence = 0.7;
    }
    const alternatives = Object.entries(intentProbabilities ?? {})
      .filter(([k]) => k !== intent && k !== "other")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, p]) => ({ intent: k as Intent, p: Math.round(p * 100) / 100 }));

    const jevTimeframe = answers.timeframe?.choice as Timeframe | undefined;
    const timeframe =
      explicitTimeframe(request.question) ??
      (jevTimeframe && jevTimeframe !== "any" ? jevTimeframe : DEFAULT_TIMEFRAME[intent]);

    const scopeChoice = answers.scope?.choice;
    return {
      intent,
      intentConfidence: Math.round(intentConfidence * 100) / 100,
      alternatives,
      timeframe,
      scope: intent === "awaiting_others" ? "sent" : scopeChoice === "sent" ? "sent" : scopeChoice === "all" ? "all" : "inbox",
      sender,
      senderConfidence,
      unreadOnly: (answers.unreadOnly?.noul ?? 0) >= 0.6 || heuristic.unreadOnly,
      keywords: heuristic.keywords,
      source,
    };
  } catch {
    return heuristic;
  }
}
