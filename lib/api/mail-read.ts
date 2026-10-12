import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/server/guard";
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
  throw new HttpError(502, message, "mail_server");
}
