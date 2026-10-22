"use client";

import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteMessagesAction, moveMessagesAction } from "@/lib/actions/mail";
import { useInvalidateMail } from "@/hooks/use-mail";
import { useAccount } from "@/components/providers/account-provider";
import { getPref } from "@/lib/prefs/store";
import { qk } from "@/lib/query-keys";
import { isTyping } from "@/lib/keyboard";
import { createDeferredQueue, type DeferredKind, type DeferredMove } from "@/lib/mail/deferred-actions";

// Module-level so a batch outlives the component that started it: the reader
// remounts per message (key={uid}) and the list per folder, and neither may
// cut the undo window short.
const shared: {
	qc: QueryClient | null;
	email: string;
	invalidate: ReturnType<typeof useInvalidateMail> | null;
} = { qc: null, email: "", invalidate: null };

async function commitMove(move: DeferredMove, { keepalive }: { keepalive: boolean }) {
	if (keepalive) {
		// The page is going away; only a keepalive request is sure to reach the server.
		await fetch("/api/mail/actions", {
			method: "POST",
			keepalive: true,
			headers: { "content-type": "application/json" },
			body: JSON.stringify(move),
		});
		return;
	}
	const { folder, uids, threadIds } = move;
	const res =
		move.kind === "archive" || move.kind === "inbox"
			? await moveMessagesAction({ folder, uids, destination: move.destination ?? "", threadIds })
			: await deleteMessagesAction({ folder, uids, threadIds });
	if (!res.ok) throw new Error(res.error);
}

const queue = createDeferredQueue({
	client: () => shared.qc,
	listRoot: (folder) => [...qk.messagesRoot(shared.email), folder],
	commit: commitMove,
	delayMs: () => getPref("mail.undoMs"),
	onCommitted: (move) => {
		void shared.invalidate?.invalidateMessages(move.folder);
		if (move.destination) void shared.invalidate?.invalidateMessages(move.destination);
		void shared.invalidate?.invalidateFolders();
	},
	onFailed: (_move, err) => {
		toast.error(err instanceof Error ? err.message : "That didn't go through. The messages are back.");
	},
});

const DONE: Record<DeferredKind, [one: string, many: (n: number) => string]> = {
	archive: ["Archived", (n) => `${n} messages archived`],
	trash: ["Moved to Trash", (n) => `${n} messages moved to Trash`],
	inbox: ["Moved to Inbox", (n) => `${n} messages moved to Inbox`],
	deleteForever: ["Message deleted", (n) => `${n} messages deleted`],
};

let listening = false;
let toasts = 0;

function listenOnce() {
	if (listening || typeof window === "undefined") return;
	listening = true;
	// Closing the tab or navigating away commits now instead of losing the action.
	window.addEventListener("pagehide", () => queue.flush());
	window.addEventListener("keydown", (e) => {
		if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
		// Text fields keep their own undo.
		if (isTyping(e.target)) return;
		if (queue.undoLatest()) e.preventDefault();
	});
}

/**
 * Archive, trash, move to Inbox and delete forever with an undo window
 * (Settings → Mail). Rows leave at once; the server call waits for the window,
 * Undo or Ctrl/⌘+Z puts the rows back, and closing the page commits early.
 */
export function useDeferredMailAction() {
	const qc = useQueryClient();
	const invalidate = useInvalidateMail();
	const { email } = useAccount();

	React.useEffect(() => {
		shared.qc = qc;
		shared.email = email;
		shared.invalidate = invalidate;
		listenOnce();
	}, [qc, email, invalidate]);

	const defer = React.useCallback(
		(move: DeferredMove, { onUndo }: { onUndo?: () => void } = {}): string | null => {
			// The effect above may not have run yet on a first-render click.
			shared.qc = qc;
			shared.email = email;
			const toastId = `undo-${++toasts}`;
			const id = queue.defer(move, {
				onSettled: () => toast.dismiss(toastId),
				onUndo: () => {
					onUndo?.();
					toast.success(move.uids.length > 1 ? "Restored" : "Message restored");
				},
			});
			if (!id) return null;
			const [one, many] = DONE[move.kind];
			toast(move.uids.length > 1 ? many(move.uids.length) : one, {
				id: toastId,
				duration: getPref("mail.undoMs"),
				description: move.kind === "deleteForever" ? "Deleting permanently…" : undefined,
				action: { label: "Undo", onClick: () => queue.undo(id) },
			});
			return id;
		},
		[qc, email],
	);

	return { defer };
}
