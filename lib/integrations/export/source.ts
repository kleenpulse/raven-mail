import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import { devAllMessages, devListFolders, isDevSession } from "@/lib/mail/dev-store";
import { withMailbox } from "@/lib/mail/imap";
import type { MailMessage } from "@/lib/mail/types";
import type { MailSession } from "@/lib/session";
import { sleep } from "../deliver";
import { classifyImapError } from "../diagnostics/classify";
import { IntegrationError } from "../errors";
import type { ExportChunkInput, ExportPlan, ExportRange } from "../types";
import { encodeMessage } from "./mbox";
import { CHUNK_MAX_COUNT, planChunks } from "./plan";
import { compressUids, parseUidSet } from "./uid-set";

const MAX_EXPORT_MESSAGES = 200_000;
const DAY = 86_400_000;
const DEV_UID_VALIDITY = "1";
/** The dev mailbox answers instantly; a short pause lets the progress UI be seen. */
const DEV_CHUNK_DELAY_MS = 350;

function sinceFor(range: ExportRange, now = Date.now()): Date | undefined {
	if (range === "30d") return new Date(now - 30 * DAY);
	if (range === "365d") return new Date(now - 365 * DAY);
	return undefined;
}

function mailboxError(err: unknown, provider: string): never {
	if (err instanceof IntegrationError) throw err;
	const e = err as { mailboxMissing?: boolean; serverResponseCode?: string };
	if (e?.mailboxMissing || e?.serverResponseCode === "NONEXISTENT") throw new IntegrationError("folder_missing", { cause: err });
	throw classifyImapError(err, provider);
}

/* ── Dev mailbox ─────────────────────────────────────────────────────────── */

function devFolderMessages(folder: string, since?: Date): MailMessage[] {
	if (!devListFolders().some((f) => f.path === folder)) throw new IntegrationError("folder_missing");
	return devAllMessages().filter((m) => m.folder === folder && (!since || Date.parse(m.date) >= since.getTime()));
}

function devRfc822(m: MailMessage): Promise<Buffer> {
	const mail = new MailComposer({
		from: m.from,
		to: m.to,
		cc: m.cc.length ? m.cc : undefined,
		subject: m.subject,
		text: m.text,
		html: m.html || undefined,
		date: new Date(m.date),
		messageId: m.messageId,
		inReplyTo: m.inReplyTo,
		references: m.references?.join(" "),
		disableFileAccess: true,
		disableUrlAccess: true,
	}).compile();
	return new Promise((resolve, reject) => mail.build((err, message) => (err ? reject(err) : resolve(message))));
}

/* ── Plan ────────────────────────────────────────────────────────────────── */

/** UID SEARCH + sizes → chunks. No message bodies are read here. */
export async function planExport(session: MailSession, folder: string, range: ExportRange): Promise<ExportPlan> {
	const since = sinceFor(range);

	if (isDevSession(session)) {
		const messages = devFolderMessages(folder, since).map((m) => ({
			uid: Number(m.uid),
			size: 700 + m.text.length + m.html.length,
		}));
		const chunks = planChunks(messages);
		return {
			folder,
			range,
			uidValidity: DEV_UID_VALIDITY,
			total: messages.length,
			bytes: messages.reduce((n, m) => n + m.size, 0),
			chunks,
		};
	}

	return withMailbox(
		session,
		folder,
		async (client) => {
			const box = client.mailbox;
			const found = await client.search(since ? { since } : { all: true }, { uid: true });
			const uids = Array.isArray(found) ? found : [];
			if (uids.length > MAX_EXPORT_MESSAGES) throw new IntegrationError("export_too_large");
			const messages: { uid: number; size: number }[] = [];
			if (uids.length) {
				for await (const msg of client.fetch(compressUids(uids), { uid: true, size: true }, { uid: true })) {
					messages.push({ uid: msg.uid, size: msg.size ?? 0 });
				}
			}
			return {
				folder,
				range,
				uidValidity: String(box ? box.uidValidity : 0),
				total: messages.length,
				bytes: messages.reduce((n, m) => n + m.size, 0),
				chunks: planChunks(messages),
			};
		},
		{ readOnly: true },
	).catch((err) => mailboxError(err, session.provider));
}

/* ── Chunk ───────────────────────────────────────────────────────────────── */

export type ChunkResult = { body: Buffer; count: number; missing: number };

/**
 * One chunk, read whole before replying: no IMAP command stays open while the
 * browser downloads, so a slow client can't trip imapflow's idle timeout.
 */
export async function readChunk(session: MailSession, input: ExportChunkInput, signal?: AbortSignal): Promise<ChunkResult> {
	let uids: number[];
	try {
		uids = parseUidSet(input.uids, { max: CHUNK_MAX_COUNT });
	} catch {
		throw new IntegrationError("invalid_request", { message: "That export chunk isn't valid.", hint: "Start the export again." });
	}

	if (isDevSession(session)) {
		if (input.uidValidity !== DEV_UID_VALIDITY) throw new IntegrationError("export_changed");
		const byUid = new Map(devFolderMessages(input.folder).map((m) => [Number(m.uid), m]));
		const parts: Buffer[] = [];
		for (const uid of uids) {
			const m = byUid.get(uid);
			if (m) parts.push(encodeMessage(await devRfc822(m), { sender: m.from.address, date: new Date(m.date) }));
		}
		await sleep(DEV_CHUNK_DELAY_MS, signal);
		return { body: Buffer.concat(parts), count: parts.length, missing: uids.length - parts.length };
	}

	return withMailbox(
		session,
		input.folder,
		async (client) => {
			if (String(client.mailbox ? client.mailbox.uidValidity : 0) !== input.uidValidity) {
				throw new IntegrationError("export_changed");
			}
			const parts: Buffer[] = [];
			for await (const msg of client.fetch(compressUids(uids), { uid: true, source: true, envelope: true, internalDate: true }, { uid: true })) {
				if (signal?.aborted) break;
				if (!msg.source) continue;
				const date =
					msg.internalDate instanceof Date ? msg.internalDate : msg.envelope?.date ? new Date(msg.envelope.date) : undefined;
				parts.push(encodeMessage(msg.source, { sender: msg.envelope?.from?.[0]?.address, date }));
			}
			if (signal?.aborted) throw signal.reason ?? new Error("aborted");
			return { body: Buffer.concat(parts), count: parts.length, missing: uids.length - parts.length };
		},
		{ readOnly: true },
	).catch((err) => {
		if (signal?.aborted) throw err;
		return mailboxError(err, session.provider);
	});
}
