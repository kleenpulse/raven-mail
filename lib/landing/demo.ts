import "server-only";
import { computeOverview, enrichSnapshot } from "@/lib/insights/metrics";
import type { Overview } from "@/lib/insights/types";
import { finalize, knownSenders, scanDetail, understoodDetail } from "@/lib/jev/ask/answer";
import { INTENT_META } from "@/lib/jev/ask/catalog";
import { forcePlan } from "@/lib/jev/ask/heuristic-plan";
import { execute } from "@/lib/jev/ask/retrieve";
import type { AskAnswer, AskStage, Intent } from "@/lib/jev/ask/types";
import { DEV_SELF, generateSyntheticMail } from "@/lib/mail/dev-seed";
import { snapshotFromMessages } from "@/lib/mail/envelope-row";

export type DemoAsk = {
  intent: Intent;
  question: string;
  /** Offered as a suggestion chip; the rest answer the demo board's card actions. */
  chip: boolean;
  stages: { stage: AskStage; detail: string }[];
  answer: AskAnswer;
};

export type LandingDemo = { overview: Overview; asks: DemoAsk[] };

/** The headline still counts everything; the panel lists only the top few. */
const EVIDENCE_SHOWN = 4;

const DEMO_QUESTIONS: { intent: Intent; question?: string; chip?: true }[] = [
  { intent: "needs_reply", chip: true },
  { intent: "awaiting_others", chip: true },
  { intent: "top_contacts", chip: true },
  { intent: "newsletters", chip: true },
  { intent: "volume_stats", chip: true },
  // Reachable from the board's cards (Mail mix buckets, Threads radar).
  { intent: "unread_summary", question: "What did people send me?" },
  { intent: "security" },
  { intent: "receipts" },
  { intent: "help" },
];

/**
 * The landing's demo mailbox: the dev seed run through the real Overview and
 * Ask pipelines (keyword planner, no Jev spend). Rebuilt on each revalidation
 * so relative times stay current.
 */
export function landingDemo(now = Date.now()): LandingDemo {
  // The seed lays mail out in this machine's zone; read it back in the same one.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const messages = generateSyntheticMail({ now });
  const inbox = messages.filter((m) => m.folder === "INBOX");
  const snapshot = snapshotFromMessages(messages, {
    now,
    days: 30,
    account: DEV_SELF.address,
    inbox: { unseen: inbox.filter((m) => !m.flags.seen).length, total: inbox.length },
  });

  const overview = computeOverview(snapshot, { now, tz, self: [DEV_SELF.address] });
  const { rows, local, today } = enrichSnapshot(snapshot, { now, tz });
  const senders = knownSenders(rows, DEV_SELF.address);

  const asks = DEMO_QUESTIONS.map(({ intent, question = INTENT_META[intent].example, chip }): DemoAsk => {
    const plan = forcePlan(question, intent, senders);
    const execution = execute(plan, { now, today, local, rows, overview, extraRows: [], question });
    const answer = finalize(plan, question, execution.compose(execution.candidates.map((row) => ({ row }))), false);
    return {
      intent,
      question,
      chip: Boolean(chip),
      stages: [
        { stage: "understand", detail: understoodDetail(plan) },
        { stage: "search", detail: scanDetail(plan, rows.length) },
      ],
      answer: { ...answer, evidence: answer.evidence.slice(0, EVIDENCE_SHOWN) },
    };
  });

  return { overview, asks };
}
