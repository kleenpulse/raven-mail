import type { PersonRef, ThreadRef } from "@/lib/insights/types";

export const INTENTS = [
  "needs_reply",
  "awaiting_others",
  "urgent",
  "from_person",
  "find_topic",
  "unread_summary",
  "attachments",
  "receipts",
  "newsletters",
  "volume_stats",
  "response_time",
  "top_contacts",
  "meetings",
  "security",
  "help",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export const TIMEFRAMES = [
  "today",
  "yesterday",
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "any",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type Scope = "inbox" | "sent" | "all";

export type AskPlan = {
  intent: Intent;
  /** 0–1. Jev's `choice` confidence, or a fixed value for heuristic/forced plans. */
  intentConfidence: number;
  alternatives: { intent: Intent; p: number }[];
  timeframe: Timeframe;
  scope: Scope;
  sender?: PersonRef;
  senderConfidence?: number;
  unreadOnly: boolean;
  keywords: string[];
  /** Literal search text typed beside an intent chip; list intents narrow their results by it. */
  filter?: string;
  source: "jev" | "heuristic" | "forced";
};

export type Evidence = ThreadRef & {
  preview?: string;
  /** Jev relevance probability or heuristic score, 0–1. */
  score?: number;
  badge?: string;
  critical?: boolean;
  lowConfidence?: boolean;
};

export type AskAnswer = {
  id: string;
  question: string;
  headline: string;
  sentence: string;
  evidence: Evidence[];
  viz?: { kind: "bars"; label: string; points: { label: string; value: number }[] };
  stats?: { label: string; value: string }[];
  plan: AskPlan;
  confidence: number;
  clarify?: { question: string; options: { label: string; intent: Intent }[] };
  followUps: string[];
  /** What actually ran, e.g. "Inbox · last 7 days · from maya@…" */
  searched: string;
  empty: boolean;
  /** Deep link that reproduces the result in Mail, when one exists. */
  openInMail?: string;
  /** Narrator seam — null until an LLM narrator is configured. */
  narration: string | null;
};

export type AskStage = "understand" | "search" | "rank" | "answer";

export type AskEvent =
  | { type: "stage"; stage: AskStage; detail: string }
  | { type: "answer"; answer: AskAnswer }
  | { type: "error"; message: string };

export type AskRequest = {
  question: string;
  forcedIntent?: Intent;
  filter?: string;
  context?: { folder?: string; uid?: string };
};
