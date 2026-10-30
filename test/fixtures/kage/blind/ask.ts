// Blind set. Written 2026-10-30 by an author who had not seen the engine.
// Never tune against it: read only the aggregate score, never the cases.
import type { AskCase } from "@/test/fixtures/kage/ask";

export const BLIND_ASK_CASES: AskCase[] = [
  // needs_reply
  { q: "who's waiting on me", intent: "needs_reply", split: "blind" },
  { q: "anything i still need to answr?", intent: "needs_reply", split: "blind" },
  { q: "Which emails require a response from me before Friday?", intent: "needs_reply", alt: ["urgent"], split: "blind" },
  { q: "did maya ask me something i havent gotten back to", intent: "needs_reply", alt: ["from_person"], sender: "maya@acme.com", split: "blind" },
  { q: "unanswered emails from this week", intent: "needs_reply", alt: ["awaiting_others"], split: "blind" },

  // awaiting_others
  { q: "who's ghosting me", intent: "awaiting_others", split: "blind" },
  { q: "what did i send that nobody replied to", intent: "awaiting_others", split: "blind" },
  { q: "has jonas replied to my proposal yet", intent: "awaiting_others", alt: ["from_person"], sender: "jonas@northwind.io", split: "blind" },
  { q: "follow ups i should send", intent: "awaiting_others", split: "blind" },

  // urgent
  { q: "anything urgent?", intent: "urgent", split: "blind" },
  { q: "show me the time sensitive stuff", intent: "urgent", split: "blind" },
  { q: "urgent stuff from jonas", intent: "urgent", alt: ["from_person"], sender: "jonas@northwind.io", split: "blind" },
  { q: "what deadlines are coming up next week", intent: "urgent", split: "blind" },

  // from_person
  { q: "emails from priya", intent: "from_person", sender: "priya.raman@gmail.com", split: "blind" },
  { q: "what did i send leo last month", intent: "from_person", scope: "sent", sender: "leo@studio-martins.com", split: "blind" },
  { q: "Show me my whole conversation with Sam Okafor", intent: "from_person", sender: "sam@okafor.dev", split: "blind" },
  { q: "unread from priya", intent: "from_person", alt: ["unread_summary"], unreadOnly: true, sender: "priya.raman@gmail.com", split: "blind" },

  // find_topic
  { q: "find the thread about the q3 roadmap", intent: "find_topic", split: "blind" },
  { q: "where's that email about the apartment lease", intent: "find_topic", split: "blind" },
  { q: "emails mentioning the kubernetes migration", intent: "find_topic", split: "blind" },
  { q: "the logo feedback stuff", intent: "find_topic", split: "blind" },
  { q: "what did maya say about the pricing page", intent: "find_topic", alt: ["from_person"], sender: "maya@acme.com", split: "blind" },

  // unread_summary
  { q: "what's new", intent: "unread_summary", split: "blind" },
  { q: "catch me up on what i missed while i was on vacation", intent: "unread_summary", split: "blind" },
  { q: "Could you please provide a summary of the correspondence I have not yet read?", intent: "unread_summary", unreadOnly: true, split: "blind" },

  // attachments
  { q: "find the pdf leo sent", intent: "attachments", alt: ["from_person"], sender: "leo@studio-martins.com", split: "blind" },
  { q: "attachments i sent last week", intent: "attachments", scope: "sent", split: "blind" },
  { q: "where are the photos from the wedding", intent: "attachments", alt: ["find_topic"], split: "blind" },
  { q: "docs people shared with me this month", intent: "attachments", split: "blind" },

  // receipts
  { q: "how much did i spend on amazon in september", intent: "receipts", sender: "auto-confirm@amazon.com", split: "blind" },
  { q: "unread invoices", intent: "receipts", unreadOnly: true, split: "blind" },
  { q: "where is my package", intent: "receipts", split: "blind" },
  { q: "stripe charges this month", intent: "receipts", sender: "receipts@stripe.com", split: "blind" },
  { q: "any bills due soon", intent: "receipts", alt: ["urgent"], split: "blind" },

  // newsletters
  { q: "which newsletters can i unsubscribe from", intent: "newsletters", split: "blind" },
  { q: "busiest newsletter", intent: "newsletters", alt: ["volume_stats", "top_contacts"], split: "blind" },
  { q: "latest from lenny's newsletter", intent: "newsletters", alt: ["from_person"], sender: "lenny@substack.com", split: "blind" },
  { q: "so many promo emails clogging my inbox, get rid of them", intent: "newsletters", split: "blind" },

  // volume_stats
  { q: "how many emails did i get this week", intent: "volume_stats", split: "blind" },
  { q: "whats my busiest day for emial", intent: "volume_stats", split: "blind" },
  { q: "is my inbox getting worse over the last 3 months", intent: "volume_stats", split: "blind" },

  // response_time
  { q: "how fast do i usually reply", intent: "response_time", split: "blind" },
  { q: "avg response time with maya", intent: "response_time", sender: "maya@acme.com", split: "blind" },
  { q: "who takes the longest to get back to me", intent: "response_time", split: "blind" },

  // top_contacts
  { q: "who emails me the most", intent: "top_contacts", split: "blind" },
  { q: "top 5 senders this month", intent: "top_contacts", split: "blind" },
  { q: "who do i talk to most at work", intent: "top_contacts", split: "blind" },

  // meetings
  { q: "any meetings tomorrow", intent: "meetings", split: "blind" },
  { q: "calender invites i havent accepted", intent: "meetings", alt: ["needs_reply"], split: "blind" },
  { q: "when is my call with sam", intent: "meetings", alt: ["from_person"], sender: "sam@okafor.dev", split: "blind" },
  { q: "events this weekend?", intent: "meetings", split: "blind" },

  // security
  { q: "any suspicious login attempts", intent: "security", split: "blind" },
  { q: "find my github verification code", intent: "security", sender: "noreply@github.com", split: "blind" },
  { q: "pasword reset emails", intent: "security", split: "blind" },

  // help
  { q: "what can you do", intent: "help", split: "blind" },
  { q: "how do i use jev", intent: "help", split: "blind" },
  { q: "can u help me with my mail? what kinda questions work", intent: "help", split: "blind" },

  // other
  { q: "whats the weather in berlin", intent: "other", split: "blind" },
  { q: "tell me a joke", intent: "other", split: "blind" },
  { q: "write a short poem about cats", intent: "other", split: "blind" },
];
