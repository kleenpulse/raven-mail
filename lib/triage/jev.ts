import "server-only";
import { choice, noul, score } from "@typesafe-ai/sdk";
import type { TriageResult } from "@/lib/mail/types";
import { heuristicTriage } from "@/lib/triage/heuristic";
import { getJevClient, jevEnabled } from "@/lib/jev/client";

export { jevEnabled };

export async function jevTriage(
  input: {
    subject: string;
    snippet?: string;
    from?: string;
    body?: string;
  },
  { signal }: { signal?: AbortSignal } = {},
): Promise<TriageResult> {
  if (!jevEnabled()) {
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
    const response = await getJevClient().systemOne(
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

    const category = response.answers.category.choice as TriageResult["category"];
    const confidence =
      response.answers.category.confidence ?? response.answers.urgency.confidence ?? 0.7;

    return {
      category,
      urgency: Math.max(0, Math.min(1, response.answers.urgency.score / 3)),
      needsReply: response.answers.needsReply.noul >= 0.6,
      confidence,
      source: "jev",
    };
  } catch {
    return heuristicTriage(input);
  }
}
