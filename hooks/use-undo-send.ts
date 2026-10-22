"use client";

import * as React from "react";
import { toast } from "sonner";
import { sendMessageAction } from "@/lib/actions/mail";
import { useInvalidateMail } from "@/hooks/use-mail";
import { getPref } from "@/lib/prefs/store";
import { draftBody } from "@/lib/mail/reply";
import { createSendQueue, pickOrphan, type SendRecord } from "@/lib/mail/pending-send";
import { useComposeStore, type ComposeAttachment, type ComposeMode } from "@/lib/store/compose";
import type { ComposeDraft } from "@/lib/mail/types";

/** Compose's own local copy; kept until the send succeeds. */
export const AUTOSAVE_KEY = "em-compose-local";
// Sends still waiting or on the wire, so a closed tab can bring them back.
const PENDING_KEY = "em-compose-pending";
const lockName = (id: string) => `em-send-${id}`;

export type OutgoingSend = {
	mode: ComposeMode;
	draft: ComposeDraft;
	draftUid?: string;
	attachments: ComposeAttachment[];
};

// Files stay out: base64 would blow the localStorage quota.
type StoredSend = SendRecord & { mode: ComposeMode; draft: ComposeDraft; draftUid?: string; files: number };

/** What the send and save actions take. */
export function toOutgoing({ draft, draftUid, attachments }: Omit<OutgoingSend, "mode">) {
	return {
		draft: {
			...draft,
			text: draftBody(draft),
			quote: undefined,
			attachments: attachments.map(({ filename, contentType, contentBase64 }) => ({ filename, contentType, contentBase64 })),
		},
		draftUid,
	};
}

export function forgetLocalCopy() {
	try {
		localStorage.removeItem(AUTOSAVE_KEY);
	} catch {
		/* ignore */
	}
}

function readRecords(): StoredSend[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
		return Array.isArray(parsed) ? (parsed as StoredSend[]) : [];
	} catch {
		return [];
	}
}

function writeRecords(records: StoredSend[]) {
	try {
		if (records.length) localStorage.setItem(PENDING_KEY, JSON.stringify(records));
		else localStorage.removeItem(PENDING_KEY);
	} catch {
		/* quota or blocked storage: the send itself still goes */
	}
}

// Each pending send holds a Web Lock until it settles. The browser drops the
// locks of a closed tab, so a free lock on page load means its sender is gone.
const releases = new Map<string, () => void>();
const settledEarly = new Set<string>();

function holdLock(id: string) {
	if (typeof navigator === "undefined" || !navigator.locks) return;
	void navigator.locks.request(lockName(id), () => {
		if (settledEarly.delete(id)) return;
		return new Promise<void>((resolve) => releases.set(id, resolve));
	});
}

function releaseLock(id: string) {
	const release = releases.get(id);
	if (release) {
		releases.delete(id);
		release();
	} else settledEarly.add(id);
}

const shared: { invalidate: ReturnType<typeof useInvalidateMail> | null; draftsFolder: string | null } = {
	invalidate: null,
	draftsFolder: null,
};

let restoring = false;

/** Back into compose with everything it had. */
function reopen(send: OutgoingSend) {
	restoring = true;
	try {
		const store = useComposeStore.getState();
		store.openCompose(send.mode, send.draft, { draftUid: send.draftUid });
		if (send.attachments.length) store.addAttachments(send.attachments);
	} finally {
		restoring = false;
	}
}

const queue = createSendQueue<OutgoingSend>({
	delayMs: () => getPref("mail.undoSend"),
	send: async (send) => {
		const res = await sendMessageAction(toOutgoing(send));
		if (!res.ok) throw new Error(res.error);
	},
	persist: {
		save: (id, send, until) => {
			const record: StoredSend = {
				id,
				until,
				mode: send.mode,
				draft: send.draft,
				draftUid: send.draftUid,
				files: send.attachments.length,
			};
			writeRecords([...readRecords().filter((r) => r.id !== id), record]);
			holdLock(id);
		},
		sending: (id) => writeRecords(readRecords().map((r) => (r.id === id ? { ...r, sending: true } : r))),
		remove: (id) => {
			writeRecords(readRecords().filter((r) => r.id !== id));
			releaseLock(id);
		},
	},
	onSending: (_send, id) => toast.loading("Sending…", { id, action: undefined }),
	onSent: (send, id) => {
		toast.success("Message sent", { id, action: undefined });
		// A new compose may be writing its own local copy by now.
		if (!useComposeStore.getState().open) forgetLocalCopy();
		if (send.draftUid) void shared.invalidate?.invalidateMessages(shared.draftsFolder ?? undefined);
		void shared.invalidate?.invalidateFolders();
	},
	onFailed: (send, err, id) => {
		const message = err instanceof Error ? err.message : "Send failed";
		if (!useComposeStore.getState().open) {
			reopen(send);
			toast.error(message, { id, description: "Your message is back in compose." });
		} else {
			toast.error(message, {
				id,
				duration: Infinity,
				description: "Your message wasn't sent.",
				action: { label: "Reopen", onClick: () => reopen(send) },
			});
		}
	},
});

function undoSend(id: string) {
	const send = queue.undo(id);
	if (!send) return;
	reopen(send);
	toast("Not sent", { id, duration: 3000, action: undefined, description: "It's back in compose." });
}

function showCountdown(id: string, until: number) {
	const render = () => {
		const left = Math.ceil((until - Date.now()) / 1000);
		if (left <= 0 || !queue.isWaiting(id)) return false;
		toast(`Sending in ${left}s`, {
			id,
			duration: Infinity,
			action: { label: "Undo", onClick: () => undoSend(id) },
		});
		return true;
	};
	if (!render()) return;
	const tick = setInterval(() => {
		if (!render()) clearInterval(tick);
	}, 1000);
}

/** A tab that closed mid-send left its message behind: bring it back, unsent. */
async function recoverOrphans() {
	const records = readRecords();
	if (records.length === 0) return;
	let held = new Set<string>();
	try {
		const snapshot = await navigator.locks?.query();
		held = new Set((snapshot?.held ?? []).map((l) => l.name ?? ""));
	} catch {
		/* no Web Locks: every record counts as left behind */
	}
	const { restore, keep } = pickOrphan(records, (id) => held.has(lockName(id)));
	if (!restore) return;
	writeRecords(keep);
	const open = useComposeStore.getState().open;
	// The files lived only in that tab. Forget the Drafts copy too, so a save
	// doesn't replace the server copy that still has them.
	const back: OutgoingSend = {
		mode: restore.mode,
		draft: restore.draft,
		draftUid: restore.files ? undefined : restore.draftUid,
		attachments: [],
	};
	const title = restore.sending ? "This message may have been sent" : "Your message wasn't sent";
	const description = restore.sending
		? "Check Sent before you send it again."
		: restore.files
			? "Add the files again before you send it."
			: "It's back in compose.";
	if (open) {
		toast(title, { description, duration: Infinity, action: { label: "Open", onClick: () => reopen(back) } });
	} else {
		reopen(back);
		toast(title, { description, duration: 10_000 });
	}
}

let listening = false;

function listenOnce() {
	if (listening || typeof window === "undefined") return;
	listening = true;
	// Leaving now would drop a send that's waiting, or cut one off mid-way.
	window.addEventListener("beforeunload", (e) => {
		if (queue.pending() === 0) return;
		e.preventDefault();
		e.returnValue = "";
	});
	// One compose at a time: opening another sends the waiting one now, so
	// Undo can never write over the new message.
	useComposeStore.subscribe((state, prev) => {
		if (state.open && !prev.open && !restoring) void queue.flush();
	});
	void recoverOrphans();
}

/**
 * Send with an undo window (Settings → Mail → Undo Send). Compose closes at
 * once; a countdown toast offers Undo, which reopens it with its files. Off
 * sends straight away through the same path.
 */
export function useUndoSend({ draftsFolder }: { draftsFolder: string | null }) {
	const invalidate = useInvalidateMail();

	React.useEffect(() => {
		shared.invalidate = invalidate;
		shared.draftsFolder = draftsFolder;
	}, [invalidate, draftsFolder]);

	React.useEffect(() => {
		listenOnce();
	}, []);

	return React.useCallback(
		(send: OutgoingSend) => {
			shared.invalidate = invalidate;
			shared.draftsFolder = draftsFolder;
			const { id, until } = queue.defer(send);
			showCountdown(id, until);
		},
		[invalidate, draftsFolder],
	);
}
