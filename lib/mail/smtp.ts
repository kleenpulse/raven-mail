import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MailSession } from "@/lib/session";
import type { ComposeDraft } from "@/lib/mail/types";
import { isLoopbackHost } from "@/lib/auth/ip";

function createTransport(session: MailSession) {
  return nodemailer.createTransport({
    host: session.smtp.host,
    port: session.smtp.port,
    secure: session.smtp.secure,
    // 587 is STARTTLS: without requireTLS a stripped STARTTLS would send the password in clear.
    requireTLS: !session.smtp.secure && !isLoopbackHost(session.smtp.host),
    auth: {
      user: session.email,
      pass: session.password,
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
    },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
}

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** `keepBcc` is for saved drafts only: sent mail must never carry the Bcc header. */
export async function buildRawMessage(
  session: MailSession,
  draft: ComposeDraft,
  { keepBcc = false }: { keepBcc?: boolean } = {},
): Promise<{ raw: Buffer; envelope: { from: string; to: string[] }; messageId: string }> {
  const from = session.displayName
    ? { name: session.displayName, address: session.email }
    : session.email;

  const mail = new MailComposer({
    from,
    to: parseAddressList(draft.to),
    cc: draft.cc ? parseAddressList(draft.cc) : undefined,
    bcc: draft.bcc ? parseAddressList(draft.bcc) : undefined,
    subject: draft.subject || "(no subject)",
    text: draft.text,
    html: draft.html || undefined,
    inReplyTo: draft.inReplyTo,
    references: draft.references?.join(" "),
    attachments: (draft.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: Buffer.from(a.contentBase64, "base64"),
    })),
    date: new Date(),
  }).compile();
  mail.keepBcc = keepBcc;
  const messageId = mail.messageId();

  const raw = await new Promise<Buffer>((resolve, reject) => {
    mail.build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });

  const envelope = mail.getEnvelope();
  const fromAddress = typeof envelope.from === "string" && envelope.from ? envelope.from : session.email;
  return {
    raw,
    envelope: { from: fromAddress, to: envelope.to ?? [] },
    messageId,
  };
}

export async function sendRaw(
  session: MailSession,
  raw: Buffer,
  envelope: { from: string; to: string[] },
): Promise<string> {
  const transport = createTransport(session);
  const info = await transport.sendMail({
    envelope,
    raw,
  });
  return info.messageId ?? "";
}

export async function verifySmtp(session: MailSession): Promise<void> {
  const transport = createTransport(session);
  await transport.verify();
}

/** Gmail and Microsoft 365 file sent mail themselves; appending creates duplicates. */
export function serverSavesSentCopy(session: MailSession): boolean {
  if (session.provider === "gmail" || session.provider === "outlook") return true;
  return /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i.test(session.smtp.host);
}
