export type AttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
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
  threadId?: string;
};

export type MailThread = {
  messages: MailSummary[];
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
  source?: { folder: string; uid: string };
  remind?: { days: number } | { at: string };
  quote?: { kind: "reply" | "forward"; header: string; body: string };
  attachments?: {
    filename: string;
    contentType: string;
    contentBase64: string;
    cid?: string;
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
  source: "jev" | "kage" | "heuristic";
};

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
