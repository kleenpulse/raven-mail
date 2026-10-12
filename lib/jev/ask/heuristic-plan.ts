import { DEFAULT_TIMEFRAME } from "@/lib/jev/ask/catalog";
import { explicitTimeframe } from "@/lib/jev/ask/timeframe";
import type { PersonRef } from "@/lib/insights/types";
import type { AskPlan, Intent, Scope } from "@/lib/jev/ask/types";

/** Ordered: the first matching rule wins ("who owes me a reply" must not read as needs_reply). */
const RULES: [RegExp, Intent][] = [
  [/\b(what can you do|what do you do|help me use|how do (i|you) use)\b/i, "help"],
  [
    /\b(owes? me|waiting (on|for) (a |their |his |her )?(reply|response|answer)|no (reply|response)|haven'?t (heard|replied|responded|gotten)|ghost(ed|ing)?|follow[- ]?ups?|chase)\b/i,
    "awaiting_others",
  ],
  [
    /\b(needs? (my|a) (reply|response|answer)|waiting (on|for) me|who'?s waiting|(reply|respond) to|get back to|unanswered|owe (a )?(reply|response))\b/i,
    "needs_reply",
  ],
  [/\b(urgent|asap|important|critical|deadlines?|time[- ]sensitive|priorit(y|ies))\b/i, "urgent"],
  [/\b(receipts?|invoices?|orders?|payments?|paid|bills?|charges?|refunds?|shipping|shipped|deliver(y|ies))\b/i, "receipts"],
  [/\b(newsletters?|subscriptions?|subscribed|unsubscribe|mailing lists?|digests?|promotions?|promos?)\b/i, "newsletters"],
  [/\b(attach(ment|ments|ed)?|files?|pdfs?|documents?|photos?|images?)\b/i, "attachments"],
  [/\b(meetings?|invites?|invitations?|calendar|schedul\w*|events?|calls?)\b/i, "meetings"],
  [/\b(security|sign[- ]?ins?|log[- ]?ins?|passwords?|2fa|verification|verify|suspicious)\b/i, "security"],
  [/\b(how (fast|quick(ly)?|long)|response times?|reply times?|reply speed)\b/i, "response_time"],
  [/\b(who (emails|writes|sends|mails)|top (senders|contacts|people)|most (emails?|mail) from)\b/i, "top_contacts"],
  [/\b(how (many|much)|stats?|statistics|volume|busiest|trends?)\b/i, "volume_stats"],
  [/\b(unread|what'?s new|miss(ed)?|catch (me )?up|summar(y|i[sz]e)|overnight)\b/i, "unread_summary"],
];

const STOPWORDS = new Set(
  (
    "a an the about any anything all emails email mail mails message messages from to me my mine i is are was were be " +
    "what which who whom whose when where why how do does did have has had there this that these those week weeks today " +
    "yesterday month months show find get give tell with in on for of and or please can could would you jev related " +
    "regarding re thread threads latest recent recently some something last past any new got received sent send " +
    "email's there's it its any? let know"
  ).split(/\s+/),
);

export function extractKeywords(question: string, drop: string[] = []): string[] {
  const dropSet = new Set(drop.map((d) => d.toLowerCase()));
  const words = question
    .toLowerCase()
    .replace(/[“”"'’`]/g, " ")
    .split(/[^a-z0-9#@.+-]+/)
    .map((w) => w.replace(/^[.+-]+|[.+-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !dropSet.has(w));
  return [...new Set(words)].slice(0, 5);
}

/** Fuzzy sender match on full name, first name, mailbox, or domain word. */
export function matchSender(question: string, senders: PersonRef[]): { sender: PersonRef; confidence: number } | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9@.\s-]/g, " ")} `;
  let best: { sender: PersonRef; score: number } | null = null;
  let tie = false;
  for (const sender of senders) {
    const name = sender.name.toLowerCase();
    const [local = "", domain = ""] = sender.address.toLowerCase().split("@");
    const first = name.split(/\s+/)[0] ?? "";
    const domainWord = domain.split(".")[0] ?? "";
    let score = 0;
    if (q.includes(sender.address.toLowerCase())) score = 1;
    else if (name.length > 3 && q.includes(` ${name} `)) score = 0.95;
    else if (first.length >= 3 && q.includes(` ${first} `)) score = 0.8;
    else if (local.length >= 4 && q.includes(` ${local} `)) score = 0.75;
    else if (domainWord.length >= 4 && q.includes(` ${domainWord} `)) score = 0.6;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { sender, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  if (!best) return null;
  return { sender: best.sender, confidence: tie ? best.score * 0.6 : best.score };
}

function scopeFor(question: string, intent: Intent): Scope {
  if (intent === "awaiting_others") return "sent";
  if (/\b(i sent|sent by me|i wrote|i emailed|my sent|emails? i sent)\b/i.test(question)) return "sent";
  return "inbox";
}

/** Free fallback when Jev isn't configured (or fails): regex intent table + fuzzy sender. */
export function heuristicPlan(question: string, senders: PersonRef[]): AskPlan {
  const matched = RULES.find(([re]) => re.test(question));
  const sender = matchSender(question, senders);
  const senderDrop = sender ? sender.sender.name.split(/\s+/).concat(sender.sender.address.split(/[@.]/)) : [];
  const keywords = extractKeywords(question, senderDrop);

  let intent: Intent;
  let confidence: number;
  if (matched) {
    intent = matched[1];
    confidence = 0.75;
  } else if (sender && sender.confidence >= 0.6) {
    intent = "from_person";
    confidence = 0.7;
  } else if (keywords.length > 0) {
    intent = "find_topic";
    confidence = 0.45;
  } else {
    intent = "other";
    confidence = 0.3;
  }

  const timeframe = explicitTimeframe(question) ?? DEFAULT_TIMEFRAME[intent];
  return {
    intent,
    intentConfidence: confidence,
    alternatives: [],
    timeframe,
    scope: scopeFor(question, intent),
    sender: sender?.sender,
    senderConfidence: sender?.confidence,
    unreadOnly: /\b(unread|haven'?t (read|opened)|not (read|opened))\b/i.test(question),
    keywords,
    source: "heuristic",
  };
}

/** A suggestion chip already knows its intent; only time range, contact and keywords come from the text. */
export function forcePlan(question: string, intent: Intent, senders: PersonRef[]): AskPlan {
  const heuristic = heuristicPlan(question, senders);
  return {
    ...heuristic,
    intent,
    intentConfidence: 1,
    alternatives: [],
    timeframe: explicitTimeframe(question) ?? DEFAULT_TIMEFRAME[intent],
    scope: intent === "awaiting_others" ? "sent" : heuristic.scope,
    source: "forced",
  };
}
