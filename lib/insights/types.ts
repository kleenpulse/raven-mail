import type { MailAddress, TriageCategory } from "@/lib/mail/types";

/* ─── Snapshot: raw rows from one IMAP pass (server-side, tz-agnostic) ─── */

export type EnvelopeRow = {
  /** `${folder}:${uid}` */
  id: string;
  folder: "inbox" | "sent";
  /** Real IMAP path, for deep links. */
  path: string;
  uid: number;
  /** Arrival (INTERNALDATE), epoch ms. */
  date: number;
  /** Date: header, epoch ms. */
  sentAt?: number;
  /** Offset of the Date: header in minutes east of UTC — the sender's clock. */
  tzOffsetMin?: number;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  threadId?: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  size: number;
  hasAttachments: boolean;
  attachmentBytes: number;
  hasCalendar: boolean;
  listId?: string;
  /** Raw List-Unsubscribe header. */
  listUnsubscribe?: string;
  /** Auto-Submitted ≠ no. */
  autoSubmitted: boolean;
  /** Precedence: bulk | list | junk. */
  bulk: boolean;
  /** Only fetched for the newest human mail (Daily Brief). */
  preview?: string;
};

export type Snapshot = {
  v: 1;
  account: string;
  fetchedAt: number;
  days: number;
  inbox: { path: string; unseen: number; total: number };
  sent: { path: string | null };
  quota?: { usedBytes: number; limitBytes: number };
  rows: EnvelopeRow[];
  truncated: boolean;
};

/* ─── Overview DTO: what /api/overview returns (tz-binned) ─── */

export type MixBucket = "people" | "notifications" | "newsletters" | "transactions";

export type PersonRef = { name: string; address: string };

export type ThreadRef = {
  folder: string;
  uid: string;
  messageId?: string;
  subject: string;
  from: PersonRef;
  /** ISO */
  date: string;
  ageHours: number;
};

/** A busy conversation: its latest message, plus how active it's been this week. */
export type HotThread = ThreadRef & {
  /** Messages in the last 7 days (both directions). */
  messages: number;
  people: string[];
};

export type WaitingRef = ThreadRef & {
  to: PersonRef;
  /** That contact's usual reply time; null when we lack history. */
  baselineHours: number | null;
};

export type SenderStat = {
  address: string;
  name: string;
  domain: string;
  category: TriageCategory;
  bucket: MixBucket;
  count: number;
  unread: number;
  sentToThem: number;
  /** ISO */
  lastAt: string;
  /** Per local day across the window, oldest → newest. */
  daily: number[];
  /** Four most recent 7-day buckets, oldest → newest (W1…W4). */
  weekly: number[];
  yourReplyMedianMin: number | null;
  theirReplyMedianMin: number | null;
  needsReply: number;
  tzOffsetMin?: number;
  recent: ThreadRef[];
};

export type NewsletterStat = {
  key: string;
  name: string;
  address: string;
  issues: number;
  issuesPerMonth: number;
  opened: number;
  /** 0–1, from \Seen (which means opened somewhere, not necessarily read). */
  openRate: number;
  lastOpenedAt?: string;
  lastIssueAt: string;
  grade: "A" | "B" | "C" | "D" | "F";
  unsubscribe?: { https?: string; mailto?: string };
};

export type BriefItem = ThreadRef & {
  score: number;
  why: string[];
  category: TriageCategory;
  urgency: number;
  needsReply: boolean;
  preview?: string;
  source: "heuristic" | "jev" | "kage";
  confidence?: number;
};

export type WeatherState = "clear" | "fair" | "cloudy" | "rain" | "storm";

export type ReplyTimeStat = { medianMin: number | null; p90Min: number | null; samples: number };

export type Overview = {
  v: 1;
  generatedAt: string;
  syncedAt: string;
  days: number;
  tz: string;
  truncated: boolean;
  kpis: {
    /** STATUS UNSEEN for the whole Inbox, not just the window. */
    unread: number;
    needsReply: number;
    waitingOn: number;
    urgentToday: number;
    receivedToday: number;
  };
  obligations: {
    /** Oldest first. */
    needsReply: ThreadRef[];
    /** Longest silence first. */
    waitingOn: WaitingRef[];
    replyDebtHours: number;
    replyDebtPrevHours: number;
    payoff: { refs: ThreadRef[]; sharePct: number };
  };
  volume: {
    days: { date: string; received: number; sent: number }[];
    receivedThisWeek: number;
    receivedLastWeek: number;
    sentThisWeek: number;
    sentLastWeek: number;
  };
  rhythm: {
    /** 7 (Mon…Sun) × 24, human arrivals only. */
    heat: number[][];
    checkTimes: number[];
    /** Share of human mail caught within 2h by `checkTimes`. */
    checkCoverage: number;
    focusWindows: { start: number; end: number }[];
    busiest: { weekday: number; hour: number } | null;
  };
  replyTimes: { yours: ReplyTimeStat; theirs: ReplyTimeStat };
  mix: { bucket: MixBucket; count: number; unread: number }[];
  hotThreads: HotThread[];
  categories: { category: TriageCategory; count: number }[];
  senders: SenderStat[];
  newsletters: NewsletterStat[];
  attachments: { count: number; bytes: number; largest: (ThreadRef & { bytes: number })[] };
  quota?: { usedBytes: number; limitBytes: number };
  weather: { score: number; state: WeatherState; label: string; forecast: string };
  brief: BriefItem[];
  invites: ThreadRef[];
  today: { needsReplyZero: boolean; unreadZero: boolean };
};
