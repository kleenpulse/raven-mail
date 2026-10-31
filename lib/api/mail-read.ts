import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/server/guard";
import { errorCodes, netErrorCode } from "@/lib/integrations/net-errors";
import { devGetMessage } from "@/lib/mail/dev-store";
import { hasRemoteContent, sanitizeBody } from "@/lib/mail/sanitize";
import type { MailMessage } from "@/lib/mail/types";

export const folderParam = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => !/[\r\n\0]/.test(v), "Invalid folder name.");

export const uidParam = z.string().regex(/^\d{1,10}$/, "Invalid message id.");

/** Same sanitize + remote-image check as IMAP, so dev exercises the real reader path. */
export function devReaderMessage(folder: string, uid: string): MailMessage {
  const message = devGetMessage(folder, uid);
  const html = message.html ? sanitizeBody(message.html) : "";
  return { ...message, html, remoteContent: hasRemoteContent(html) };
}

/** Mail-server failures are the user's own mailbox talking — surface the message, typed as 502. */
export function mailError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  const message = err instanceof Error ? err.message : "Mail server error.";
  if (/not found/i.test(message)) throw new HttpError(404, message, "not_found");
  // "Can't get there" (offline, DNS, a dead route) is told apart so the desktop app can say it's offline.
  if (isUnreachable(err)) throw new HttpError(502, message, "mail_unreachable");
  throw new HttpError(502, message, "mail_server");
}

const UNREACHABLE = new Set(["dns_failed", "connect_refused", "timeout", "network"]);
// ImapFlow's own codes for a connect that never got an answer.
const IMAP_NO_ANSWER = new Set(["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "ETIMEOUT", "NoConnection"]);

/** The mail server couldn't be reached at all. TLS and login failures don't count: those are answers. */
export function isUnreachable(err: unknown): boolean {
  if (errorCodes(err).some((code) => IMAP_NO_ANSWER.has(code))) return true;
  const code = netErrorCode(err);
  return code !== null && UNREACHABLE.has(code);
}
