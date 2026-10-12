import type { Intent, Timeframe } from "@/lib/jev/ask/types";

/**
 * `criteria` strings are the labels Jev chooses between — write them as
 * outcomes, not instructions. `example` doubles as a suggestion chip.
 */
export const INTENT_META: Record<Intent, { label: string; criteria: string; example: string; related: Intent[] }> = {
  needs_reply: {
    label: "Needs my reply",
    criteria: "Emails waiting for the user's reply or action — who is waiting on the user",
    example: "Who’s waiting on my reply?",
    related: ["awaiting_others", "urgent"],
  },
  awaiting_others: {
    label: "Who owes me",
    criteria: "Emails the user sent that got no reply yet — who the user is waiting on, follow-ups",
    example: "Who owes me a reply?",
    related: ["needs_reply", "response_time"],
  },
  urgent: {
    label: "Urgent",
    criteria: "Urgent, time-critical, deadline, or important emails",
    example: "What’s urgent today?",
    related: ["needs_reply", "meetings"],
  },
  from_person: {
    label: "From someone",
    criteria: "Emails from, to, or with a specific person or company",
    example: "Emails from Maya this week",
    related: ["response_time", "find_topic"],
  },
  find_topic: {
    label: "Find a topic",
    criteria: "Find emails about a topic, project, keyword, product, or thing",
    example: "Anything about the roadmap?",
    related: ["from_person", "attachments"],
  },
  unread_summary: {
    label: "What’s new",
    criteria: "What's new, unread, missed, or a catch-up summary of recent mail",
    example: "What did I miss today?",
    related: ["needs_reply", "urgent"],
  },
  attachments: {
    label: "Attachments",
    criteria: "Emails with attachments, files, documents, PDFs, or photos",
    example: "Files I got this week",
    related: ["receipts", "find_topic"],
  },
  receipts: {
    label: "Receipts",
    criteria: "Receipts, invoices, orders, payments, bills, shipping, or subscription charges",
    example: "Receipts from this month",
    related: ["attachments", "newsletters"],
  },
  newsletters: {
    label: "Newsletters",
    criteria: "Newsletters, subscriptions, mailing lists, promotions, or unsubscribing",
    example: "Newsletters I never open",
    related: ["volume_stats", "top_contacts"],
  },
  volume_stats: {
    label: "Volume",
    criteria: "How much email, counts, statistics, trends, busiest days or times",
    example: "How much mail did I get this week?",
    related: ["top_contacts", "response_time"],
  },
  response_time: {
    label: "Reply speed",
    criteria: "How fast the user replies, or how fast other people reply to the user",
    example: "How fast do I reply?",
    related: ["awaiting_others", "needs_reply"],
  },
  top_contacts: {
    label: "Top contacts",
    criteria: "Who emails the user the most — top senders or contacts",
    example: "Who emails me most?",
    related: ["volume_stats", "from_person"],
  },
  meetings: {
    label: "Meetings",
    criteria: "Meetings, calendar invites, scheduling, events, or calls",
    example: "Any meeting invites this week?",
    related: ["urgent", "needs_reply"],
  },
  security: {
    label: "Security",
    criteria: "Security alerts, sign-ins, passwords, verification codes, or account access",
    example: "Any security alerts?",
    related: ["urgent"],
  },
  help: {
    label: "Help",
    criteria: "What Jev can do, or how to use this assistant",
    example: "What can you do?",
    related: [],
  },
  other: {
    label: "Something else",
    criteria: "Something else not covered by the other options",
    example: "",
    related: [],
  },
};

export const TIMEFRAME_META: Record<Timeframe, { label: string; criteria: string }> = {
  today: { label: "today", criteria: "Today only" },
  yesterday: { label: "yesterday", criteria: "Yesterday" },
  this_week: { label: "this week", criteria: "This calendar week" },
  last_7_days: { label: "last 7 days", criteria: "The past seven days, recently, or lately" },
  this_month: { label: "this month", criteria: "This calendar month" },
  last_30_days: { label: "last 30 days", criteria: "The past month or the last few weeks" },
  any: { label: "any time", criteria: "No time range is mentioned" },
};

/** When the question names no range, each intent has a sensible default. */
export const DEFAULT_TIMEFRAME: Record<Intent, Timeframe> = {
  needs_reply: "any",
  awaiting_others: "any",
  urgent: "last_7_days",
  from_person: "last_30_days",
  find_topic: "any",
  unread_summary: "today",
  attachments: "last_30_days",
  receipts: "last_30_days",
  newsletters: "last_30_days",
  volume_stats: "last_7_days",
  response_time: "last_30_days",
  top_contacts: "last_30_days",
  meetings: "last_30_days",
  security: "last_7_days",
  help: "any",
  other: "any",
};

export const SUGGESTED_INTENTS: Intent[] = [
  "needs_reply",
  "awaiting_others",
  "urgent",
  "unread_summary",
  "receipts",
  "newsletters",
  "response_time",
  "top_contacts",
];
