import "server-only";
import { randomUUID } from "node:crypto";
import { openRow, sealRow } from "@/lib/db/sealed";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import type { FollowUpRow } from "@/lib/db/schema";
import type { MailSession } from "@/lib/session";
import { devFindReplies, devGetMessage, isDevSession } from "@/lib/mail/dev-store";
import { findReplies, getMessage, type ReplyAnswer } from "@/lib/mail/imap";
import { countOpenFollowUps, deleteFollowUp, insertFollowUp, listOpenFollowUps, updateFollowUp } from "./repo";
import { FOLLOW_UP_LIMIT, type FollowUpDTO, type FollowUpTarget, type FollowUpView } from "./types";
import { isDue, recipientLine, SNOOZE_MS } from "./when";

/** Past-due reminders checked for a reply per load; the rest wait for the next one. */
const REPLY_CHECKS = 50;
/** How far before the reminder was set a reply may have arrived (SEARCH SINCE). */
const REPLY_WINDOW_MS = 30 * 86_400_000;

function toDTO(row: FollowUpRow, key: string): FollowUpDTO | null {
	try {
		const target = openRow<FollowUpTarget>("follow-ups", row.sealed, key, row.id);
		return {
			...target,
			id: row.id,
			dueAt: row.dueAt.toISOString(),
			status: row.status,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	} catch {
		return null;
	}
}

export async function getOpenFollowUps(session: MailSession): Promise<FollowUpDTO[]> {
	const key = tenantKey(session);
	return (await listOpenFollowUps(key)).flatMap((row) => toDTO(row, key) ?? []);
}

export async function createFollowUp(session: MailSession, target: FollowUpTarget, dueAt: Date): Promise<FollowUpDTO> {
	const key = tenantKey(session);
	if ((await countOpenFollowUps(key)) >= FOLLOW_UP_LIMIT) {
		throw new IntegrationError("limit_reached", {
			message: `You have ${FOLLOW_UP_LIMIT} open reminders.`,
			hint: "Mark some done first.",
		});
	}
	const id = randomUUID();
	const row = await insertFollowUp({ id, accountKey: key, sealed: sealRow("follow-ups", target, key, id), dueAt });
	return toDTO(row, key)!;
}

export async function snoozeFollowUp(session: MailSession, id: string, dueAt: Date): Promise<FollowUpDTO> {
	const key = tenantKey(session);
	return toDTO(await updateFollowUp(key, id, { dueAt, status: "open" }), key)!;
}

export async function finishFollowUp(session: MailSession, id: string): Promise<void> {
	await updateFollowUp(tenantKey(session), id, { status: "done" });
}

export function removeFollowUp(session: MailSession, id: string): Promise<void> {
	return deleteFollowUp(tenantKey(session), id);
}

/**
 * Open reminders, soonest first, with `due` worked out now: the time has
 * passed and no reply has reached the Inbox. One that has a reply is closed
 * here, so it never shows. A failed check leaves them due: a reminder too
 * many beats a missed one.
 */
export async function listFollowUps(session: MailSession, now = new Date()): Promise<FollowUpView[]> {
	const open = await getOpenFollowUps(session);
	const past = open.filter((f) => isDue(f, now)).slice(0, REPLY_CHECKS);
	let answers = new Map<string, ReplyAnswer>();
	if (past.length) {
		const checks = past.map((f) => ({
			messageId: f.messageId,
			since: new Date(Date.parse(f.createdAt) - REPLY_WINDOW_MS),
			needUid: !f.uid,
		}));
		try {
			answers = isDevSession(session) ? devFindReplies(checks) : await findReplies(session, checks);
		} catch (err) {
			console.error("[follow-ups] reply check failed", err);
		}
	}
	const replied = new Set(past.filter((f) => answers.get(f.messageId)?.replied).map((f) => f.id));
	await Promise.all([...replied].map((id) => finishFollowUp(session, id).catch(() => {})));
	return open
		.filter((f) => !replied.has(f.id))
		.map((f) => ({ ...f, uid: f.uid || answers.get(f.messageId)?.sentUid || "", due: isDue(f, now) }));
}

/**
 * A reminder on a message already in the mailbox (a sent message in the
 * reader, a row of "Gone quiet"). The server reads the message itself, so the
 * client only names it. A second reminder on the same message moves the first.
 */
export async function remindAbout(
	session: MailSession,
	ref: { folder: string; uid: string },
	dueAt: Date,
): Promise<FollowUpDTO> {
	// The store first: without a database, say so before reading any mail.
	const open = await getOpenFollowUps(session);
	let message;
	try {
		message = isDevSession(session) ? devGetMessage(ref.folder, ref.uid) : await getMessage(session, ref.folder, ref.uid);
	} catch (err) {
		if (err instanceof Error && /not found/i.test(err.message)) {
			throw new IntegrationError("not_found", { message: "That message isn't there anymore.", hint: "Reload and try again." });
		}
		throw err;
	}
	if (!message.messageId) {
		throw new IntegrationError("invalid_request", {
			message: "This message has no ID, so Raven can't spot a reply.",
			hint: "Set the reminder on another message in the conversation.",
		});
	}
	const existing = open.find((f) => f.messageId === message.messageId);
	if (existing) return snoozeFollowUp(session, existing.id, dueAt);
	return createFollowUp(
		session,
		{ messageId: message.messageId, subject: message.subject, to: recipientLine(message.to), folder: ref.folder, uid: ref.uid },
		dueAt,
	);
}

export function snoozeOneDay(session: MailSession, id: string, now = new Date()): Promise<FollowUpDTO> {
	return snoozeFollowUp(session, id, new Date(now.getTime() + SNOOZE_MS));
}
