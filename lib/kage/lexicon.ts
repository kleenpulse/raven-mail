/**
 * Kage's stand-in for word embeddings: groups of words and phrases that mean
 * the same thing in mail. A hit anywhere in a text adds a `#concept` feature,
 * so "invoice" in a question meets "receipts" in a label's criteria.
 *
 * Single words are stemmed before matching; multi-word phrases match on word
 * boundaries; terms without letters ("?", "$", "%") match raw text. Questions
 * are first person; criteria say "the user", which is normalized to "me"/"my".
 */
/**
 * Concepts that show up in almost every question ("from") are weak evidence:
 * they count for less than a concept that names what the user wants.
 */
export const CONCEPT_SCALE: Record<string, number> = { "#person": 0.5, "#topic": 0.5 };

export const CONCEPTS: Record<string, string[]> = {
  /** The user owes someone an answer. */
  i_owe: [
    "waiting on me", "waiting for me", "waiting for my", "my reply", "my response", "my answer", "reply to",
    "respond to", "get back to", "unanswered", "need to answer", "still need to answer", "need to reply",
    "need to respond", "needs reply", "needs my", "owe a reply", "owe a response", "do i owe", "i owe",
    "whos waiting", "who is waiting", "answer", "respond",
  ],
  /** Someone owes the user an answer. */
  they_owe: [
    "owes me", "owe me", "no reply", "no response", "no answer", "got no", "havent replied", "hasnt replied",
    "havent heard", "hasnt heard", "not heard", "hear back", "heard back", "never replied", "never responded",
    "didnt reply", "ghosted", "ghost", "follow up", "follow ups", "followup", "followups", "chase", "nudge",
    "still waiting", "waiting to hear", "awaiting",
  ],
  urgent: [
    "urgent", "urgently", "asap", "immediately", "immediate", "emergency", "critical", "important", "deadline",
    "deadlines", "time sensitive", "time critical", "overdue", "right away", "priority", "blocked", "blocker",
    "action required", "final notice", "expires", "expiring", "tonight", "end of day", "eod", "right now", "is down",
    "are down", "went down", "goes down", "outage", "attention", "pressing",
  ],
  money: [
    "receipt", "invoice", "order", "orders", "payment", "paid", "pay", "bill", "billing", "charge", "charged",
    "refund", "purchase", "purchased", "bought", "spend", "spent", "transaction", "amount", "total due",
    "subscription charges", "$", "€", "£",
  ],
  shipping: [
    "shipping", "shipped", "shipment", "delivery", "delivered", "package", "parcel", "tracking", "track",
    "courier", "out for delivery", "arriving",
  ],
  promo: [
    "promotion", "promotions", "promo", "promos", "marketing", "discount", "sale", "offer", "deal", "deals",
    "coupon", "% off", "black friday", "limited time", "exclusive", "and save", "save up to", "save on", "save big",
    "shop", "upgrade now", "checkout",
  ],
  newsletter: [
    "newsletter", "newsletters", "digest", "roundup", "edition", "briefing", "top stories", "subscribe",
    "subscription", "subscriptions", "subscribed", "unsubscribe", "mailing list", "mailing lists", "weekly roundup", "this weeks",
    "read in app",
  ],
  files: [
    "attachment", "attachments", "attached", "attach", "file", "files", "pdf", "document", "documents", "doc",
    "photo", "photos", "image", "images", "picture", "pictures", "pics", "spreadsheet", "slides", "deck",
  ],
  meeting: [
    "meeting", "meetings", "invite", "invites", "invitation", "invited", "calendar", "schedule", "scheduled",
    "event", "events", "a call", "the call", "phone call", "video call", "quick call", "zoom", "google meet", "standup",
    "appointment", "reschedule", "rsvp",
    "agenda", "tomorrow",
  ],
  /**
   * "code" stays a single word though "discount code" isn't security: the
   * stem a sale's "discount codes" and a sign-in's "codes" share keeps rules
   * about each competing for keyword-stuffed mail (test/fixtures/rules e3).
   */
  security: [
    "security", "sign in", "sign ins", "signin", "signing in", "login", "log in", "logins", "password",
    "passwords", "2fa", "two factor", "verification", "verify", "code", "codes", "otp", "suspicious", "new device",
    "account access", "ssh key", "breach", "reset", "account",
  ],
  speed: [
    "how fast", "how quick", "how quickly", "how long", "response time", "reply time", "reply speed", "turnaround",
    "fast", "quickly", "speed", "average response",
  ],
  counting: [
    "how many", "how much mail", "how much email", "count", "counts", "stats", "statistics", "volume", "busiest",
    "trend", "trends", "per day", "number of",
  ],
  top_people: [
    "who emails", "who writes", "who sends", "who mails", "top senders", "top contacts", "top people", "most emails",
    "the most", "most often", "emails me most", "writes to me", "senders",
  ],
  newness: [
    "unread", "whats new", "new", "missed", "miss", "catch up", "catch me up", "summary", "summarize", "summarise",
    "overnight", "recap",
  ],
  unread: ["unread", "havent read", "not read", "havent opened", "unopened", "not opened"],
  help_meta: [
    "what can you do", "what do you do", "can do", "how do i use", "how to use", "use this", "help", "assistant",
    "features",
  ],
  topic: [
    "about", "regarding", "related to", "mention", "mentions", "mentioning", "anything on", "thread on", "find",
    "search", "search for", "look for", "topic", "project", "keyword", "wheres", "that thread",
  ],
  person: [
    "from", "person", "company", "contact", "someone", "conversation with", "send me", "sent me", "latest from",
    "anything from",
  ],
  social: [
    "friend request", "follower", "followers", "followed you", "connection request", "wants to connect",
    "connect with you", "connect on linkedin",
    "tagged you", "liked your", "commented on", "reacted to", "linkedin", "facebook", "facebookmail", "twitter",
    "instagram", "tiktok", "reddit", "social network", "professional network",
  ],
  system_notice: [
    "notification", "notifications", "alert", "alerts", "system status", "maintenance", "status", "terms of service",
    "privacy policy", "your account", "updating", "system update", "system",
  ],
  automated: [
    "noreply", "no reply@", "do not reply", "donotreply", "mailer", "automated", "fyi", "no action", "for reference",
    "marketing", "unsubscribe", "notification", "notifications", "notify", "receipt", "order confirmation",
    "booking confirmation", "confirmation number", "has been confirmed", "is confirmed", "has shipped",
    "contact support", "manage your", "track your", "thank you for your",
  ],
  /** Kept apart from `request`: every typed question ends in "?", so it must only meet labels that mention questions. */
  question_mark: ["?", "question", "questions"],
  request: [
    "could you", "can you", "would you", "will you", "please", "let me know", "thoughts", "feedback",
    "approve", "review", "please confirm", "can you confirm", "could you confirm", "are you", "do you",
    "what do you think", "need your", "waiting on you",
    "get back to me", "request", "sign and send", "call me",
  ],
  person_talk: [
    "hi", "hey", "hello", "thanks", "thank you", "cheers", "best regards", "kind regards", "warm regards", "lunch",
    "coffee", "direct", "person to person", "correspondence", "conversation", "sounds good", "are you free",
    "you free", "free for", "need you", "call me", "let me know", "could you",
    "can you", "what do you think", "thoughts", "i attached", "see you",
  ],
  time_today: ["today", "this morning", "tonight", "so far today", "right now"],
  time_yesterday: ["yesterday", "since yesterday", "last night"],
  time_week: ["this week", "calendar week"],
  time_recent: ["recently", "lately", "past week", "last week", "last 7 days", "past seven days", "few days"],
  time_month: ["this month", "calendar month"],
  time_last_month: ["past month", "last month", "last few weeks", "last 30 days", "past 30 days", "few weeks"],
  sent_by_me: ["i sent", "sent by me", "i wrote", "i emailed", "my sent", "me sent", "emails i sent", "sent to"],
  received: ["received", "inbox", "incoming", "sent me", "emailed me", "sent to me", "me received", "got"],
};
