import { words, type Features } from "@/lib/kage/text";

/**
 * What an email looks like, not what it says: who sent it, whether it's a
 * reply, whether it asks the reader something, whether it names a time.
 * These `#shape` features come from the state's structure only (the `from`
 * address, a `Re:` subject), so the body's words can't raise them. On the
 * label side they're reached only through `SHAPE_LINKS`, a short list of
 * criteria words, never through the lexicon: an email that says "direct" or
 * "automated" doesn't look direct or automated for saying so.
 *
 * A spammer who sends from a person-like address does look like a person.
 * That's honest evidence, and the rest of the email still has to agree.
 */

/** Address parts that machines and marketing teams send from. Singular forms; a trailing "s" is dropped. */
const BULK_PARTS = new Set([
  "noreply", "donotreply", "notification", "notify", "alert", "news", "newsletter", "digest", "marketing", "deal",
  "offer", "promo", "sale", "billing", "receipt", "order", "invoice", "statement", "tracking", "shipment", "support",
  "info", "hello", "team", "update", "mailer", "bounce", "invitation", "reward", "reservation", "store", "shop",
  "message", "calendar",
]);
/** Role addresses: written by people, but not one person's mailbox. Neither bulk nor a person. */
const ROLE_PARTS = new Set([
  "legal", "status", "privacy", "security", "admin", "account", "career", "job", "press", "contact", "office", "hr",
  "crew", "letter", "editor", "service", "system", "mail",
]);
/** Platforms whose mail is bulk whatever the address in front says. */
const BULK_DOMAINS = /(^|\.)(substack\.com|mailchimp\.com|mcsv\.net|beehiiv\.com|sendgrid\.net|mailgun\.org|convertkit\.com|ghost\.io)$/;
/** Mailboxes that belong to a person. */
const PERSONAL_DOMAINS = /^(gmail|googlemail|outlook|hotmail|live|msn|icloud|me|mac|yahoo|ymail|aol|proton|protonmail|pm|fastmail|gmx)\.[a-z.]+$/;

const WHEN = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri)\b/i,
  /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?\b/i,
  /\b\d{1,2}(st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
];

type Sender = "bulk" | "person" | "role" | null;

function address(from: string): { local: string; domain: string } | null {
  const raw = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 1 || at === raw.length - 1) return null;
  return { local: raw.slice(0, at), domain: raw.slice(at + 1) };
}

const singular = (part: string) => (part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part);

export function senderKind(from: string): Sender {
  const addr = address(from);
  if (!addr) return null;
  const parts = addr.local.split(/[^a-z0-9]+/).filter(Boolean);
  const joined = parts.join("");
  if (joined.includes("noreply") || joined.includes("donotreply") || BULK_DOMAINS.test(addr.domain)) return "bulk";
  if (parts.some((p) => BULK_PARTS.has(p) || BULK_PARTS.has(singular(p)))) return "bulk";
  if (parts.some((p) => ROLE_PARTS.has(p) || ROLE_PARTS.has(singular(p)))) return "role";
  if (PERSONAL_DOMAINS.test(addr.domain)) return "person";
  // "maya", "priya.raman", "tom_b": a name or two, no digits.
  return /^[a-z]{2,12}([._-][a-z]{1,15})?$/.test(addr.local) ? "person" : null;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Shape features of an email-like state (one with a `from` field); empty for anything else. */
export function shapeFeatures(state: Record<string, unknown>): Features {
  const out: Features = new Map();
  if (!("from" in state)) return out;
  const sender = senderKind(text(state.from));
  const subject = text(state.subject);
  const content = [subject, text(state.snippet), text(state.body)].join(" \n ");
  if (sender === "bulk") out.set("#sender_bulk", 1);
  if (sender === "person") out.set("#sender_person", 1);
  // Bulk mail fakes both: "RE: your invoice", "Quick question: are you free?".
  if (sender !== "bulk" && /^\s*(re|aw|sv|antw)\s*:/i.test(subject)) out.set("#reply_thread", 1);
  if (sender !== "bulk" && content.includes("?") && /\byou(r|rs)?\b/i.test(content)) out.set("#asks_me", 1);
  if (WHEN.some((re) => re.test(content))) out.set("#when", 1);
  return out;
}

/**
 * Criteria words that mean a shape. Words, not stems: "personal" names a
 * person, "personalized" doesn't. Kept short and plain on purpose; every
 * entry is a way for a label to claim mail by its shape.
 */
const SHAPE_LINKS: Record<string, string[]> = {
  "#sender_person": ["person to person", "direct", "personal", "real person", "real people", "human", "humans", "people i know", "friends", "colleagues", "coworkers"],
  "#sender_bulk": ["automated", "bulk", "noreply", "mass mail", "mailer"],
  "#reply_thread": ["correspondence", "conversation", "conversations", "thread", "threads", "back and forth", "ongoing"],
  "#asks_me": ["question", "questions", "ask", "asks", "asking"],
  // `#when` has no words yet: "bookings" or "calendar invites" in a rule would
  // claim every email that names a weekday. Phase 4's urgency scale reads it.
};

const LINKS = Object.entries(SHAPE_LINKS).map(([id, terms]) => ({ id, terms: terms.map((t) => ` ${t} `) }));

/** The shape features a label's criteria text claims. */
export function shapeLinks(criteria: string): Features {
  const out: Features = new Map();
  const spaced = ` ${words(criteria).join(" ")} `;
  for (const { id, terms } of LINKS) if (terms.some((t) => spaced.includes(t))) out.set(id, 1);
  return out;
}
