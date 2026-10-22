"use server";

import { z } from "zod";
import { requireSession } from "@/lib/actions/auth";
import {
  appendRaw,
  deleteMessages,
  expandThreadUids,
  findUidByMessageId,
  moveMessages,
  resolveSpecial,
  setFlags,
} from "@/lib/mail/imap";
import { buildRawMessage, sendRaw, serverSavesSentCopy } from "@/lib/mail/smtp";
import { invalidateSnapshot } from "@/lib/mail/snapshot";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import {
  devAllMessages,
  devDeleteMessages,
  devExpandThread,
  devListFolders,
  devMoveMessages,
  devSaveDraft,
  devSendMessage,
  devSetFlags,
  isDevSession,
} from "@/lib/mail/dev-store";
import type { MailSession } from "@/lib/session";
import type { ActionResult, ComposeDraft } from "@/lib/mail/types";
import { createFollowUp } from "@/lib/follow-ups/service";
import { remindSchema } from "@/lib/follow-ups/schema";
import { dueAtFor, recipientLine } from "@/lib/follow-ups/when";
import type { SendReminder } from "@/lib/follow-ups/types";
import { IntegrationError } from "@/lib/integrations/errors";

// Reads live in app/api/mail/* (GET route handlers); these are mutations only.

const folderSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => !/[\r\n\0]/.test(v), "Invalid folder name.");
const uidSchema = z.string().regex(/^\d{1,10}$/, "Invalid message id.");
// Unvalidated uids were joined straight into an IMAP sequence set — "1:*" hit a whole folder.
const uidsSchema = z.array(uidSchema).min(1).max(500);
const draftUidSchema = uidSchema.optional();
// Server thread ids (Gmail X-GM-THRID digits, RFC 8474 THREADID tokens): act on the whole thread.
const threadIdsSchema = z
  .array(z.string().regex(/^[\w.:-]{1,64}$/, "Invalid thread id."))
  .max(50)
  .optional();

const setFlagsSchema = z.object({
  folder: folderSchema,
  uids: uidsSchema,
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
  threadIds: threadIdsSchema,
});
const moveSchema = z.object({
  folder: folderSchema,
  uids: uidsSchema,
  destination: folderSchema,
  threadIds: threadIdsSchema,
});
const deleteSchema = z.object({ folder: folderSchema, uids: uidsSchema, threadIds: threadIdsSchema });

/** The uids plus every other message of those server threads in the folder, loaded or not. */
async function wholeThreads(
  session: MailSession,
  folder: string,
  uids: string[],
  threadIds: string[] = [],
): Promise<string[]> {
  if (threadIds.length === 0) return uids;
  return isDevSession(session)
    ? devExpandThread(folder, uids, threadIds)
    : expandThreadUids(session, folder, uids, threadIds);
}

const addressField = z.string().max(4000);
const draftSchema = z.object({
  to: addressField,
  cc: addressField.optional(),
  bcc: addressField.optional(),
  subject: z.string().max(998),
  text: z.string().max(2_000_000),
  html: z.string().max(4_000_000).optional(),
  inReplyTo: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(200).optional(),
  source: z.object({ folder: folderSchema, uid: uidSchema }).optional(),
  remind: remindSchema.optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().max(255),
        contentBase64: z.string(),
      }),
    )
    .max(20)
    .optional(),
});

function fail(err: unknown): ActionResult<never> {
  const message = err instanceof Error ? err.message : "Request failed.";
  return { ok: false, error: message };
}

function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: error.issues[0]?.message ?? "Invalid request." };
}

const devFrom = (session: MailSession) => ({
  address: session.email,
  name: session.displayName || undefined,
});

// requireSession() stays outside try: redirect() works by throwing and must not be swallowed.

export async function setFlagsAction(input: z.input<typeof setFlagsSchema>): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = setFlagsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { folder, seen, flagged, threadIds } = parsed.data;
  try {
    const uids = await wholeThreads(session, folder, parsed.data.uids, threadIds);
    if (isDevSession(session)) {
      devSetFlags(folder, uids, { seen, flagged });
      return { ok: true, data: null };
    }
    const add: string[] = [];
    const remove: string[] = [];
    if (seen === true) add.push("\\Seen");
    if (seen === false) remove.push("\\Seen");
    if (flagged === true) add.push("\\Flagged");
    if (flagged === false) remove.push("\\Flagged");
    await setFlags(session, folder, uids, { add, remove });
    invalidateSnapshot(session);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

export async function moveMessagesAction(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { folder, destination, threadIds } = parsed.data;
  try {
    const uids = await wholeThreads(session, folder, parsed.data.uids, threadIds);
    if (isDevSession(session)) {
      devMoveMessages(folder, uids, destination);
      return { ok: true, data: null };
    }
    await moveMessages(session, folder, uids, destination);
    invalidateSnapshot(session);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteMessagesAction(input: z.input<typeof deleteSchema>): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { folder, threadIds } = parsed.data;
  try {
    const uids = await wholeThreads(session, folder, parsed.data.uids, threadIds);
    if (isDevSession(session)) {
      devDeleteMessages(folder, uids, resolveSpecialFolder(devListFolders(), "\\Trash"));
      return { ok: true, data: null };
    }
    await deleteMessages(session, folder, uids, await resolveSpecial(session, "\\Trash"));
    invalidateSnapshot(session);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

/** The Message-ID a reply answers, when it looks like one. */
function answersTo(draft: ComposeDraft): string | undefined {
  return draft.inReplyTo && /^<[^<>\s]+>$/.test(draft.inReplyTo) ? draft.inReplyTo : undefined;
}

/**
 * \Answered on the original. A reply reopened from Drafts has no `source`, so
 * it's found by In-Reply-To in the Inbox.
 */
async function markAnswered(session: MailSession, draft: ComposeDraft): Promise<void> {
  if (draft.source) {
    await setFlags(session, draft.source.folder, [draft.source.uid], { add: ["\\Answered"] });
    return;
  }
  const messageId = answersTo(draft);
  if (!messageId) return;
  const uid = await findUidByMessageId(session, "INBOX", messageId);
  if (uid) await setFlags(session, "INBOX", [uid], { add: ["\\Answered"] });
}

export async function sendMessageAction(input: {
  draft: ComposeDraft;
  /** The saved draft this message came from; its server copy goes once sent. */
  draftUid?: string;
}): Promise<ActionResult<{ messageId: string; reminder?: SendReminder }>> {
  const session = await requireSession();
  const parsed = draftSchema.safeParse(input.draft);
  if (!parsed.success) return invalid(parsed.error);
  const fromDraft = draftUidSchema.safeParse(input.draftUid);
  if (!fromDraft.success) return invalid(fromDraft.error);
  const draft = parsed.data;
  if (!draft.to.trim()) {
    return { ok: false, error: "Add at least one recipient." };
  }

  try {
    if (isDevSession(session)) {
      const { messageId } = devSendMessage(draft, devFrom(session));
      const answers = answersTo(draft);
      const original =
        draft.source ?? (answers && devAllMessages().find((m) => m.folder === "INBOX" && m.messageId === answers));
      if (original) devSetFlags(original.folder, [original.uid], { answered: true });
      if (fromDraft.data) await removeDraftCopy(session, fromDraft.data);
      return { ok: true, data: { messageId, reminder: await remindAfterSend(session, draft, messageId) } };
    }

    const { raw, envelope } = await buildRawMessage(session, draft);
    const messageId = await sendRaw(session, raw, envelope);

    // Everything below is best-effort — the message already left the building.
    await Promise.allSettled([
      (async () => {
        if (serverSavesSentCopy(session)) return;
        const sent = await resolveSpecial(session, "\\Sent");
        if (sent) await appendRaw(session, sent, raw, ["\\Seen"]);
      })(),
      markAnswered(session, draft),
      fromDraft.data ? removeDraftCopy(session, fromDraft.data) : Promise.resolve(),
    ]);
    invalidateSnapshot(session);

    return { ok: true, data: { messageId, reminder: await remindAfterSend(session, draft, messageId) } };
  } catch (err) {
    return fail(err);
  }
}

/**
 * "Remind me if no reply" from compose. The message has already gone, so a
 * reminder that can't be saved is reported, never a failed send.
 */
async function remindAfterSend(
  session: MailSession,
  draft: z.infer<typeof draftSchema>,
  messageId: string,
): Promise<SendReminder | undefined> {
  if (!draft.remind || !messageId) return undefined;
  const dueAt = dueAtFor(draft.remind);
  if (!dueAt) return { ok: false, error: "The reminder time had passed, so no reminder was set." };
  try {
    const sent = isDevSession(session) ? "Sent" : ((await resolveSpecial(session, "\\Sent")) ?? "Sent");
    const target = { messageId, subject: draft.subject, to: recipientLine(draft.to), folder: sent, uid: "" };
    return { ok: true, dueAt: (await createFollowUp(session, target, dueAt)).dueAt };
  } catch (err) {
    if (err instanceof IntegrationError) return { ok: false, error: err.message, hint: err.hint };
    return { ok: false, error: "Sent, but the reminder couldn't be saved." };
  }
}

/**
 * Saves a new server copy, then deletes the one it replaces (`draftUid`). In
 * that order, a failure part way leaves an extra copy, never no copy.
 */
export async function saveDraftAction(input: {
  draft: ComposeDraft;
  draftUid?: string;
}): Promise<ActionResult<{ uid?: string }>> {
  const session = await requireSession();
  const parsed = draftSchema.safeParse(input.draft);
  if (!parsed.success) return invalid(parsed.error);
  const previous = draftUidSchema.safeParse(input.draftUid);
  if (!previous.success) return invalid(previous.error);
  const draft = { ...parsed.data, subject: parsed.data.subject || "(no subject)" };
  const replaces = previous.data;

  try {
    if (isDevSession(session)) {
      const { uid } = devSaveDraft(draft, devFrom(session), replaces);
      return { ok: true, data: { uid } };
    }

    const draftsFolder = await resolveSpecial(session, "\\Drafts");
    if (!draftsFolder) {
      return { ok: false, error: "No Drafts folder found on this account." };
    }

    const { raw, messageId } = await buildRawMessage(session, draft, { keepBcc: true });
    const appended = await appendRaw(session, draftsFolder, raw, ["\\Draft", "\\Seen"]);
    const uid =
      appended.uid ?? (await findUidByMessageId(session, draftsFolder, messageId).catch(() => null)) ?? undefined;
    if (replaces && replaces !== uid) {
      // The new copy is safe on the server; a stale one left behind is only clutter.
      await deleteMessages(session, draftsFolder, [replaces], null).catch(() => {});
    }
    return { ok: true, data: { uid } };
  } catch (err) {
    return fail(err);
  }
}

/** Deletes a draft's server copy for good (discard, or after it was sent). */
async function removeDraftCopy(session: MailSession, draftUid: string): Promise<void> {
  if (isDevSession(session)) {
    const drafts = resolveSpecialFolder(devListFolders(), "\\Drafts");
    if (drafts) devDeleteMessages(drafts, [draftUid], null);
    return;
  }
  const drafts = await resolveSpecial(session, "\\Drafts");
  if (drafts) await deleteMessages(session, drafts, [draftUid], null);
}

export async function discardDraftAction(input: { draftUid: string }): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = uidSchema.safeParse(input.draftUid);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await removeDraftCopy(session, parsed.data);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
