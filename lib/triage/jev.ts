import "server-only";
import { choice, noul, score } from "@typesafe-ai/sdk";
import type { TriageResult } from "@/lib/mail/types";
import { heuristicTriage } from "@/lib/triage/heuristic";
import type { Jev } from "@/lib/jev/client";
import { answeredBy } from "@/lib/kage";
import { ARBITRATION, arbitrate, noulConfidence, type ArbitrationThresholds } from "@/lib/kage/arbitrate";

/** needsReply's yes/no cut on the `noul` answer. */
const REPLY_CUT = 0.6;

export async function jevTriage(
  input: {
    subject: string;
    snippet?: string;
    from?: string;
    body?: string;
  },
  {
    jev,
    signal,
    arbitration = ARBITRATION,
  }: { jev: Jev | null; signal?: AbortSignal; arbitration?: ArbitrationThresholds },
): Promise<TriageResult> {
  if (!jev) {
    return heuristicTriage(input);
  }

  // Email text goes in `state` only — never into the question instructions.
  const state = {
    subject: input.subject,
    from: input.from ?? "",
    snippet: (input.snippet ?? "").slice(0, 1200),
    body: (input.body ?? "").slice(0, 2000),
  };

  try {
    const response = await jev.client.systemOne(
      {
        state,
        questions: {
          category: choice("Which inbox category does this email belong to?", {
            primary: "Direct person-to-person correspondence",
            updates: "Account, security, or system notifications",
            receipts: "Purchase receipts, invoices, shipping",
            promotions: "Marketing, discounts, offers",
            newsletters: "Newsletters and digests",
            social: "Social network notifications",
            other: "None of the above",
          }),
          urgency: score("How urgent is this email?", [
            "Can wait a week",
            "Should handle this week",
            "Needs attention today",
            "Immediate — blocked or time-critical",
          ]),
          needsReply: noul("Does this email likely need a reply from the recipient?", {
            true: "A question, request, or direct conversation is waiting",
            false: "FYI, marketing, or automated mail",
          }),
        },
      },
      { signal },
    );

    let category = response.answers.category.choice as TriageResult["category"];
    let confidence =
      response.answers.category.confidence ?? response.answers.urgency.confidence ?? 0.7;
    const noulAnswer = response.answers.needsReply.noul;
    let needsReply = noulAnswer >= REPLY_CUT;
    const source = answeredBy(response);
    if (source === "kage") {
      const keywords = heuristicTriage(input);
      ({ label: category, confidence } = arbitrate(
        { label: category, confidence },
        { label: keywords.category, confidence: keywords.confidence },
        arbitration.category,
      ));
      // The heuristic's yes/no has no confidence of its own; only Kage's decides.
      needsReply = arbitrate(
        { label: needsReply, confidence: noulConfidence(noulAnswer, REPLY_CUT) },
        { label: keywords.needsReply, confidence: 0 },
        arbitration.needsReply,
      ).label;
    }

    return {
      category,
      urgency: Math.max(0, Math.min(1, response.answers.urgency.score / 3)),
      needsReply,
      confidence,
      source,
    };
  } catch {
    return heuristicTriage(input);
  }
}
