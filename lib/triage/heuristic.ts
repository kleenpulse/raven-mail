import type { TriageCategory, TriageResult } from "@/lib/mail/types";

const URGENCY_TERMS = [
  "asap",
  "urgent",
  "immediately",
  "deadline",
  "today",
  "tonight",
  "overdue",
  "final notice",
  "action required",
  "expires",
  "time-sensitive",
  "emergency",
  "critical",
  "blocked",
  "please reply",
  "need your",
  "waiting on you",
];

const REPLY_TERMS = [
  "?",
  "please",
  "could you",
  "can you",
  "let me know",
  "waiting",
  "awaiting",
  "reply",
  "confirm",
  "thoughts",
  "feedback",
  "approve",
  "review",
];

const CATEGORY_SIGNALS: Record<TriageCategory, RegExp[]> = {
  receipts: [
    /receipt|invoice|order confirmation|payment received|your (?:[\w-]+ )?order|purchase|has shipped|shipping confirmation|out for delivery|for delivery|tracking number|has been delivered/i,
    /@(?:[\w-]+\.)*(?:orders?|shipping|shipment)\.|^(?:orders?|shipping|shipment)@/i,
  ],
  promotions: [/\b(?:%|discount|sale|offer|deal|promo|coupon|black friday|save \$)\b/i, /unsubscribe/i],
  newsletters: [/newsletter|digest|weekly roundup|edition|briefing|top stories/i],
  // Social networks only — "notifications@" and work-tool mentions are updates, not social.
  social: [
    /friend request|new follower|followed you|connection request|wants to connect|invited you to connect|tagged you in|(?:liked|commented on|reacted to) your (?:post|photo|comment|story)/i,
    /@(?:[\w-]+\.)*(?:facebookmail|linkedin|twitter|x|instagram|tiktok|reddit|pinterest|meetup|bsky)\.(?:com|app)\b/i,
  ],
  updates: [
    /security alert|password|verify|confirmation code|2fa|login|receipt of changes|system status|maintenance/i,
    /^(?:updated )?invitation:|^(?:accepted|declined|tentative):/i,
  ],
  primary: [],
  other: [],
};

export function heuristicTriage(input: {
  subject: string;
  snippet?: string;
  from?: string;
  body?: string;
}): TriageResult {
  const text = `${input.subject}\n${input.snippet ?? ""}\n${input.body ?? ""}`.toLowerCase();
  const from = (input.from ?? "").toLowerCase();

  let category: TriageCategory = "other";
  for (const [key, patterns] of Object.entries(CATEGORY_SIGNALS) as [TriageCategory, RegExp[]][]) {
    if (patterns.some((re) => re.test(text) || re.test(from))) {
      category = key;
      break;
    }
  }
  if (category === "other") {
    if (/noreply|no-reply|do-not-reply|notifications?@|mailer@/.test(from)) {
      category = "updates";
    } else {
      category = "primary";
    }
  }

  const urgencyHits = URGENCY_TERMS.filter((t) => text.includes(t)).length;
  const urgency = Math.min(1, urgencyHits / 3);

  const replyHits = REPLY_TERMS.filter((t) => text.includes(t)).length;
  const isNoReply = /noreply|no-reply|do-not-reply/.test(from);
  // Only person-to-person mail can owe a reply; an order notice full of "please review" is still FYI.
  const needsReply =
    category === "primary" && !isNoReply && (input.subject.trim().endsWith("?") || replyHits >= 2);

  const confidence = Math.min(0.95, 0.45 + urgencyHits * 0.1 + replyHits * 0.05);

  return {
    category,
    urgency: Number(urgency.toFixed(2)),
    needsReply,
    confidence: Number(confidence.toFixed(2)),
    source: "heuristic",
  };
}
