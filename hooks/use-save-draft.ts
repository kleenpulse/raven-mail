"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveDraftAction } from "@/lib/actions/mail";
import { useComposeStore } from "@/lib/store/compose";
import { useFolders, useInvalidateMail } from "@/hooks/use-mail";
import { toOutgoing } from "@/hooks/use-undo-send";
import { resolveSpecialFolder } from "@/lib/mail/folders";

/** Saves what compose holds to Drafts, replacing its server copy. Resolves false if it didn't save. */
export function useSaveDraft() {
	const { data: folders } = useFolders();
	const { invalidateMessages, invalidateFolders } = useInvalidateMail();
	const draftsFolder = resolveSpecialFolder(folders ?? [], "\\Drafts");

	return React.useCallback(async (): Promise<boolean> => {
		// Read before the save starts: a change typed while it runs is still unsaved after.
		const { draft, draftUid, attachments, edits, session } = useComposeStore.getState();
		try {
			const res = await saveDraftAction(toOutgoing({ draft, draftUid, attachments }));
			if (!res.ok) throw new Error(res.error);
			const store = useComposeStore.getState();
			// Compose moved on to another message meanwhile: this save isn't its copy.
			if (store.session === session) {
				// Without a uid (no UIDPLUS, lookup missed) the next save adds a copy rather than guess.
				store.setDraftUid(res.data.uid);
				store.markSaved(edits);
			}
			void invalidateMessages(draftsFolder ?? undefined);
			void invalidateFolders();
			toast.success("Saved to Drafts");
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not save draft");
			return false;
		}
	}, [draftsFolder, invalidateMessages, invalidateFolders]);
}
