export type AttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  /** IMAP section to download. Missing when the part couldn't be located. */
  part?: string;
};

export type MailAddress = {
  name?: string;
  address: string;
};

export type MailFolder = {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: "\\Inbox" | "\\Sent" | "\\Drafts" | "\\Trash" | "\\Junk" | "\\Archive";
  unread: number;
  total: number;
  isParent?: boolean;
};

export type MailFlags = {
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
};

export type MailSummary = {
  uid: string;
  folder: string;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  preview: string;
  date: string;
  flags: MailFlags;
  hasAttachments: boolean;
  messageId?: string;
  references?: string[];
  inReplyTo?: string;
  /** The server's conversation id (Gmail X-GM-THRID, RFC 8474 THREADID), when it has one. */
  threadId?: string;
};

/** A conversation around one message, across its folder and Sent (GET /api/mail/thread). */
export type MailThread = {
  /** Oldest first. Includes the message it was asked for. */
  messages: MailSummary[];
  /** Searching the rest timed out or failed; only the one message is here. */
  partial?: boolean;
};

export type MailMessage = {
  uid: string;
  folder: string;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo?: MailAddress;
  date: string;
  flags: MailFlags;
  text: string;
  html: string;
  attachments: AttachmentMeta[];
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
  headers: Record<string, string>;
  /** True when the HTML references remote (http/https) images or CSS. */
  remoteContent?: boolean;
};

export type ComposeDraft = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  /** Message being replied to — flagged \Answered after a successful send. */
  source?: { folder: string; uid: string };
  /** The original being replied to / forwarded, kept out of `text` until send (see draftBody). */
  quote?: { kind: "reply" | "forward"; header: string; body: string };
  attachments?: {
    filename: string;
    contentType: string;
    contentBase64: string;
  }[];
};

export type TriageCategory =
  | "primary"
  | "updates"
  | "receipts"
  | "promotions"
  | "newsletters"
  | "social"
  | "other";

export type TriageResult = {
  category: TriageCategory;
  urgency: number;
  needsReply: boolean;
  confidence: number;
  source: "jev" | "heuristic";
};

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
