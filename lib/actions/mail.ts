"use server";

import { z } from "zod";
import { requireSession } from "@/lib/actions/auth";
import {
  appendRaw,
  deleteMessages,
  findUidByMessageId,
  moveMessages,
  resolveSpecial,
  setFlags,
} from "@/lib/mail/imap";
import { buildRawMessage, sendRaw, serverSavesSentCopy } from "@/lib/mail/smtp";
import { invalidateSnapshot } from "@/lib/mail/snapshot";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import {
  devDeleteMessages,
  devListFolders,
  devMoveMessages,
  devSaveDraft,
  devSendMessage,
  devSetFlags,
  isDevSession,
} from "@/lib/mail/dev-store";
import type { MailSession } from "@/lib/session";
import type { ActionResult, ComposeDraft } from "@/lib/mail/types";

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

const setFlagsSchema = z.object({
  folder: folderSchema,
  uids: uidsSchema,
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
});
const moveSchema = z.object({ folder: folderSchema, uids: uidsSchema, destination: folderSchema });
const deleteSchema = z.object({ folder: folderSchema, uids: uidsSchema });

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
  const { folder, uids, seen, flagged } = parsed.data;
  try {
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
  const { folder, uids, destination } = parsed.data;
  try {
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
  const { folder, uids } = parsed.data;
  try {
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

export async function sendMessageAction(input: {
  draft: ComposeDraft;
  /** The saved draft this message came from; its server copy goes once sent. */
  draftUid?: string;
}): Promise<ActionResult<{ messageId: string }>> {
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
      if (draft.source) devSetFlags(draft.source.folder, [draft.source.uid], { answered: true });
      if (fromDraft.data) await removeDraftCopy(session, fromDraft.data);
      return { ok: true, data: { messageId } };
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
      draft.source
        ? setFlags(session, draft.source.folder, [draft.source.uid], { add: ["\\Answered"] })
        : Promise.resolve(),
      fromDraft.data ? removeDraftCopy(session, fromDraft.data) : Promise.resolve(),
    ]);
    invalidateSnapshot(session);

    return { ok: true, data: { messageId } };
  } catch (err) {
    return fail(err);
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
