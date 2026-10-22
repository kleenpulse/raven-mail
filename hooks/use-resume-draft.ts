"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { messageQuery } from "@/hooks/use-mail";
import { useComposeStore, type ComposeAttachment } from "@/lib/store/compose";
import { attachmentHref, bytesToBase64 } from "@/lib/mail/attachment";
import { draftFromMessage } from "@/lib/mail/reply";
import type { AttachmentMeta } from "@/lib/mail/types";

async function loadFile(folder: string, uid: string, file: AttachmentMeta): Promise<ComposeAttachment> {
	if (!file.part) throw new Error("No part");
	const res = await fetch(attachmentHref(folder, uid, file.part), { cache: "no-store" });
	if (!res.ok) throw new Error(`Download failed (${res.status})`);
	const bytes = await res.arrayBuffer();
	return {
		filename: file.filename,
		contentType: file.contentType,
		contentBase64: bytesToBase64(bytes),
		size: bytes.byteLength,
	};
}

/**
 * Opens a message from the Drafts folder in compose, not the reader. Its files
 * are fetched back in, since saving replaces the server copy. Until they land,
 * save and send wait; if any can't be fetched, compose lets go of the server
 * copy (no draftUid) so a later save adds a new draft instead of losing them.
 */
export function useResumeDraft() {
	const client = useQueryClient();
	const { email } = useAccount();
	return React.useCallback(
		async (folder: string, uid: string) => {
			let message;
			try {
				message = await client.fetchQuery(messageQuery(email, folder, uid));
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Couldn't open this draft.");
				return;
			}
			const files = message.attachments;
			const store = useComposeStore.getState();
			store.openCompose(message.inReplyTo ? "reply" : "new", draftFromMessage(message), {
				draftUid: uid,
				attachmentsLoading: files.length > 0,
				signature: false,
			});
			if (files.length === 0) return;

			const results = await Promise.allSettled(files.map((f) => loadFile(folder, uid, f)));
			const current = useComposeStore.getState();
			// Closed or replaced while the files were loading.
			if (current.draftUid !== uid || !current.attachmentsLoading) return;
			current.addAttachments(results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
			if (results.some((r) => r.status === "rejected")) {
				current.setDraftUid(undefined);
				toast.error("Some files in this draft couldn't be loaded. The saved draft keeps them.");
			}
			current.setAttachmentsLoading(false);
		},
		[client, email],
	);
}
