import type { PersonRef } from "@/lib/insights/types";
import type { Intent } from "@/lib/jev/ask/types";

/*
 * Labeled Ask questions for `bun run eval:kage`. Written before Kage was tuned;
 * tune only against `dev` and report `holdout` untouched.
 */
export type AskCase = {
  q: string;
  intent: Intent;
  /** Accept either intent when the question honestly reads both ways. */
  alt?: Intent[];
  unreadOnly?: boolean;
  scope?: "sent" | "inbox";
  sender?: string;
  /** `blind` was written after tuning stopped and is run, never tuned against. */
  split: "dev" | "holdout" | "blind";
};

export const CONTACTS: PersonRef[] = [
  { name: "Maya Chen", address: "maya@acme.com" },
  { name: "Jonas Weber", address: "jonas@northwind.io" },
  { name: "Priya Raman", address: "priya.raman@gmail.com" },
  { name: "Leo Martins", address: "leo@studio-martins.com" },
  { name: "Amazon", address: "auto-confirm@amazon.com" },
  { name: "GitHub", address: "noreply@github.com" },
  { name: "Stripe", address: "receipts@stripe.com" },
  { name: "Figma", address: "no-reply@figma.com" },
  { name: "Sam Okafor", address: "sam@okafor.dev" },
  { name: "Lenny's Newsletter", address: "lenny@substack.com" },
];

export const ASK_CASES: AskCase[] = [
  { q: "Who's waiting on my reply?", intent: "needs_reply", split: "dev" },
  { q: "what do I still need to answer", intent: "needs_reply", split: "dev" },
  { q: "Which emails should I get back to today?", intent: "needs_reply", split: "holdout" },
  { q: "anything unanswered from clients", intent: "needs_reply", split: "dev" },
  { q: "who do I owe a response", intent: "needs_reply", split: "holdout" },
  { q: "emails I need to respond to", intent: "needs_reply", split: "dev" },

  { q: "Who owes me a reply?", intent: "awaiting_others", split: "dev" },
  { q: "who hasn't replied to my emails", intent: "awaiting_others", split: "holdout" },
  { q: "which of my sent emails got no response", intent: "awaiting_others", split: "dev" },
  { q: "people I need to follow up with", intent: "awaiting_others", split: "dev" },
  { q: "who ghosted me this week", intent: "awaiting_others", split: "holdout" },
  { q: "still waiting to hear back from anyone?", intent: "awaiting_others", split: "dev" },

  { q: "What's urgent today?", intent: "urgent", split: "dev" },
  { q: "anything time-sensitive I should know about", intent: "urgent", split: "holdout" },
  { q: "show me important emails", intent: "urgent", split: "dev" },
  { q: "any deadlines coming up", intent: "urgent", split: "dev" },
  { q: "what needs attention asap", intent: "urgent", split: "holdout" },

  { q: "Emails from Maya this week", intent: "from_person", sender: "maya@acme.com", split: "dev" },
  { q: "what did jonas send me", intent: "from_person", sender: "jonas@northwind.io", split: "holdout" },
  { q: "latest from Priya", intent: "from_person", sender: "priya.raman@gmail.com", split: "dev" },
  { q: "my conversation with Leo Martins", intent: "from_person", sender: "leo@studio-martins.com", split: "dev" },
  { q: "anything from sam lately", intent: "from_person", sender: "sam@okafor.dev", split: "holdout" },

  { q: "Anything about the roadmap?", intent: "find_topic", alt: ["other"], split: "dev" },
  { q: "find the email about the offsite venue", intent: "find_topic", alt: ["other"], split: "holdout" },
  { q: "where's that thread on the Q3 budget", intent: "find_topic", alt: ["other"], split: "dev" },
  { q: "emails mentioning the kubernetes migration", intent: "find_topic", alt: ["other"], split: "dev" },
  { q: "search for hiring plan", intent: "find_topic", alt: ["other"], split: "holdout" },

  { q: "What did I miss today?", intent: "unread_summary", split: "dev" },
  { q: "catch me up on my inbox", intent: "unread_summary", split: "holdout" },
  { q: "what's new since yesterday", intent: "unread_summary", split: "dev" },
  { q: "summarize my unread mail", intent: "unread_summary", unreadOnly: true, split: "dev" },
  { q: "anything new overnight?", intent: "unread_summary", split: "holdout" },

  { q: "Files I got this week", intent: "attachments", split: "dev" },
  { q: "find the pdf jonas sent", intent: "attachments", alt: ["from_person"], split: "holdout" },
  { q: "emails with attachments", intent: "attachments", split: "dev" },
  { q: "where are the photos from the trip", intent: "attachments", alt: ["find_topic"], split: "dev" },

  { q: "Receipts from this month", intent: "receipts", split: "dev" },
  { q: "how much did I spend on amazon", intent: "receipts", alt: ["volume_stats"], split: "holdout" },
  { q: "any invoices I haven't paid", intent: "receipts", split: "dev" },
  { q: "where's my package", intent: "receipts", split: "holdout" },
  { q: "stripe payment confirmations", intent: "receipts", split: "dev" },

  { q: "Newsletters I never open", intent: "newsletters", split: "dev" },
  { q: "which mailing lists should I unsubscribe from", intent: "newsletters", split: "holdout" },
  { q: "show my subscriptions", intent: "newsletters", split: "dev" },
  { q: "promo emails this week", intent: "newsletters", split: "holdout" },

  { q: "How much mail did I get this week?", intent: "volume_stats", split: "dev" },
  { q: "how many emails per day", intent: "volume_stats", split: "holdout" },
  { q: "what's my busiest day", intent: "volume_stats", split: "dev" },

  { q: "How fast do I reply?", intent: "response_time", split: "dev" },
  { q: "what's my average response time", intent: "response_time", split: "holdout" },
  { q: "how quickly does Maya get back to me", intent: "response_time", alt: ["from_person"], split: "dev" },

  { q: "Who emails me most?", intent: "top_contacts", split: "dev" },
  { q: "my top senders this month", intent: "top_contacts", split: "holdout" },
  { q: "who writes to me the most", intent: "top_contacts", split: "dev" },

  { q: "Any meeting invites this week?", intent: "meetings", split: "dev" },
  { q: "what's on my calendar tomorrow", intent: "meetings", split: "holdout" },
  { q: "did anyone schedule a call", intent: "meetings", split: "dev" },

  { q: "Any security alerts?", intent: "security", split: "dev" },
  { q: "suspicious sign-in attempts", intent: "security", split: "holdout" },
  { q: "password reset emails", intent: "security", split: "dev" },
  { q: "verification codes from today", intent: "security", split: "holdout" },

  { q: "What can you do?", intent: "help", split: "dev" },
  { q: "how do I use this", intent: "help", split: "holdout" },

  { q: "show unread emails from Maya", intent: "from_person", unreadOnly: true, sender: "maya@acme.com", split: "dev" },
  { q: "unread receipts", intent: "receipts", unreadOnly: true, split: "holdout" },
  { q: "emails I sent to Jonas", intent: "from_person", scope: "sent", sender: "jonas@northwind.io", split: "dev" },
  { q: "what’s urgent from github", intent: "urgent", alt: ["from_person", "security"], split: "holdout" },

  // Blind split (2026-10-22): written after the holdout was used for diagnosis.
  { q: "has anyone replied to my proposal yet", intent: "awaiting_others", alt: ["find_topic"], split: "blind" },
  { q: "which threads am I late on", intent: "needs_reply", alt: ["awaiting_others"], split: "blind" },
  { q: "anything critical this morning", intent: "urgent", split: "blind" },
  { q: "mails from priya about the launch", intent: "from_person", alt: ["find_topic"], sender: "priya.raman@gmail.com", split: "blind" },
  { q: "did I get the signed NDA back", intent: "find_topic", alt: ["attachments", "awaiting_others", "other"], split: "blind" },
  { q: "bills due this month", intent: "receipts", alt: ["urgent"], split: "blind" },
  { q: "which newsletters pile up the most", intent: "newsletters", alt: ["volume_stats"], split: "blind" },
  { q: "how many unread do I have", intent: "unread_summary", alt: ["volume_stats"], unreadOnly: true, split: "blind" },
  { q: "who do I talk to most", intent: "top_contacts", split: "blind" },
  { q: "zoom links for today", intent: "meetings", split: "blind" },
  { q: "any login codes", intent: "security", split: "blind" },
  { q: "send me the spreadsheet leo shared", intent: "attachments", alt: ["from_person"], split: "blind" },
  { q: "how long do people take to answer me", intent: "response_time", split: "blind" },
  { q: "anything I forgot to answer from last week", intent: "needs_reply", split: "blind" },
  { q: "refunds this month", intent: "receipts", split: "blind" },
  { q: "what can jev do for me", intent: "help", split: "blind" },
  { q: "stuff about the berlin conference", intent: "find_topic", alt: ["other"], split: "blind" },
  { q: "unread from sam", intent: "from_person", alt: ["unread_summary"], unreadOnly: true, sender: "sam@okafor.dev", split: "blind" },
  { q: "marketing emails I can delete", intent: "newsletters", split: "blind" },
  { q: "recap of yesterday", intent: "unread_summary", split: "blind" },
];
