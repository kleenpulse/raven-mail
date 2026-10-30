"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GrowDialog } from "@/components/motion-garden/grow-dialog";
import { useComposeStore, type PendingOpen } from "@/lib/store/compose";
import { useSaveDraft } from "@/hooks/use-save-draft";

function whatOpens({ mode, options }: PendingOpen): string {
	if (options.draftUid) return "Opening this draft";
	if (options.unsaved) return "Bringing back the other message";
	if (mode === "forward") return "Starting this forward";
	if (mode === "reply" || mode === "replyAll") return "Starting this reply";
	return "Starting a new message";
}

/**
 * Asks before compose replaces a message with unsaved changes: save it to
 * Drafts first, drop the changes, or keep writing. Mounted beside the compose
 * dock, not inside it: the dock's own keys (Ctrl+Enter sends) would see these.
 */
export function ReplaceComposeDialog() {
	const pending = useComposeStore((s) => s.pendingOpen);
	const answer = useComposeStore((s) => s.answerPending);
	const filesLoading = useComposeStore((s) => s.attachmentsLoading);
	const saveDraft = useSaveDraft();
	const [saving, setSaving] = React.useState(false);
	const saveRef = React.useRef<HTMLButtonElement>(null);

	// The panel focuses its close button first; the safe, likely choice is Save.
	React.useEffect(() => {
		if (pending) saveRef.current?.focus();
	}, [pending]);

	async function saveThenOpen() {
		setSaving(true);
		const saved = await saveDraft();
		setSaving(false);
		// Still waiting (not dismissed during the save) and saved: go ahead.
		if (saved && useComposeStore.getState().pendingOpen) answer(true);
	}

	return (
		<GrowDialog
			open={Boolean(pending)}
			onOpenChange={(open) => {
				if (!open && !saving) answer(false);
			}}
			originRect={pending?.origin}
			originMaxWidth={384}
			role="alertdialog"
			title="Save your changes first?"
			description={
				pending
					? `The message you're writing has changes that aren't saved. ${whatOpens(pending)} will replace it.`
					: undefined
			}
		>
			<div className="flex flex-col gap-3 px-5 pt-1 pb-5">
				{filesLoading && (
					<p role="status" className="text-[12px] text-ink-2">
						Its files are still loading. You can save once they&apos;re back.
					</p>
				)}
				<div className="flex flex-wrap items-center justify-end gap-2">
					<Button variant="ghost" size="pill-sm" disabled={saving} onClick={() => answer(false)}>
						Keep editing
					</Button>
					<Button variant="destructive" size="pill-sm" disabled={saving} onClick={() => answer(true)}>
						Don&apos;t save
					</Button>
					<Button ref={saveRef} size="pill-sm" disabled={saving || filesLoading} onClick={() => void saveThenOpen()}>
						{saving && <LoaderCircle className="animate-spin" />}
						Save and open
					</Button>
				</div>
			</div>
		</GrowDialog>
	);
}
