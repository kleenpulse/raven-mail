"use client";

import * as React from "react";
import { ChevronsUpDown, LoaderCircle, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SenderAvatar } from "@/components/mail/mail-row";
import { useAccount } from "@/components/providers/account-provider";
import { useMessage, useThread } from "@/hooks/use-mail";
import { usePref } from "@/lib/prefs/store";
import { formatListDate } from "@/lib/format";
import { htmlToText } from "@/lib/mail/mime";
import type { MailMessage, MailSummary, MailThread } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/** The open message's conversation, or nothing when threading is off (cached data included). */
export function useConversation(folder: string, uid: string): MailThread | undefined {
	const threading = usePref("mail.threading");
	const { data } = useThread(folder, uid);
	return threading ? data : undefined;
}

// Past this many earlier messages, the middle folds into one "N more" line.
const FOLD_AFTER = 4;

/**
 * The rest of the conversation around the open message: `before` sits above
 * it, `after` below. Each message is one line until clicked, then its text
 * shows inline with a Reply button. Sent copies are labelled.
 */
export function Conversation({
	thread,
	folder,
	uid,
	part,
	onOpenReply,
}: {
	thread: MailThread | undefined;
	folder: string;
	uid: string;
	part: "before" | "after";
	onOpenReply: (mode: "reply", message: MailMessage) => void;
}) {
	const [unfolded, setUnfolded] = React.useState(false);
	if (!thread) return null;
	if (thread.partial) {
		return part === "before" ? (
			<p className="mt-4 px-1 text-[12.5px] text-ink-2">Couldn&apos;t load the rest of this conversation.</p>
		) : null;
	}
	const at = thread.messages.findIndex((m) => m.folder === folder && m.uid === uid);
	if (at < 0 || thread.messages.length < 2) return null;
	const list = part === "before" ? thread.messages.slice(0, at) : thread.messages.slice(at + 1);
	if (list.length === 0) return null;

	const folded = part === "before" && !unfolded && list.length > FOLD_AFTER;
	const shown = folded ? [list[0]!, null, ...list.slice(-2)] : list;

	return (
		<ol
			aria-label={part === "before" ? "Earlier in this conversation" : "Later in this conversation"}
			className={cn("space-y-1.5", part === "before" ? "mt-5" : "mt-3")}
		>
			{shown.map((m) =>
				m ? (
					<li key={`${m.folder}:${m.uid}`}>
						<ConversationItem message={m} openFolder={folder} onOpenReply={onOpenReply} />
					</li>
				) : (
					<li key="fold">
						<button
							type="button"
							onClick={() => setUnfolded(true)}
							className="flex h-9 w-full items-center gap-2 rounded-[16px] px-4 text-[12.5px] text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<ChevronsUpDown aria-hidden className="size-3.5" />
							{list.length - 3} more messages
						</button>
					</li>
				),
			)}
		</ol>
	);
}

function ConversationItem({
	message,
	openFolder,
	onOpenReply,
}: {
	message: MailSummary;
	/** Messages from another folder (Sent, usually) are labelled with it. */
	openFolder: string;
	onOpenReply: (mode: "reply", message: MailMessage) => void;
}) {
	const { email } = useAccount();
	const [open, setOpen] = React.useState(false);
	const bodyId = React.useId();
	const mine = message.from.address.toLowerCase() === email.toLowerCase();
	const sender = mine ? "You" : message.from.name || message.from.address;

	return (
		<div className="rounded-[20px] bg-card-nested ring-1 ring-border dark:ring-glass-border">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={bodyId}
				className="flex w-full min-w-0 items-center gap-3 rounded-[20px] px-3 py-2.5 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
			>
				<SenderAvatar name={message.from.name} address={message.from.address} className="size-8 text-[10px]" />
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 items-baseline gap-2">
						<span className={cn("truncate text-[13.5px] text-foreground", !message.flags.seen && "font-semibold")}>
							{sender}
						</span>
						{message.folder !== openFolder && (
							<span className="shrink-0 font-mono text-[10px] tracking-wide text-ink-2 uppercase">{message.folder}</span>
						)}
					</span>
					{!open && <span className="block truncate text-[12.5px] text-ink-2">{message.preview || "—"}</span>}
				</span>
				<time dateTime={message.date} className="shrink-0 font-mono text-[11px] text-ink-2 tabular">
					{formatListDate(message.date)}
				</time>
			</button>
			{open && <ConversationBody id={bodyId} message={message} onOpenReply={onOpenReply} />}
		</div>
	);
}

function ConversationBody({
	id,
	message,
	onOpenReply,
}: {
	id: string;
	message: MailSummary;
	onOpenReply: (mode: "reply", message: MailMessage) => void;
}) {
	const { data, isPending, isError } = useMessage(message.folder, message.uid);
	if (isPending) {
		return (
			<p id={id} role="status" className="flex items-center gap-2 px-4 pb-3 text-[12.5px] text-ink-2">
				<LoaderCircle aria-hidden className="size-3.5 animate-spin" />
				Loading…
			</p>
		);
	}
	if (isError || !data) {
		return (
			<p id={id} className="px-4 pb-3 text-[12.5px] text-ink-2">
				Couldn&apos;t load this message.
			</p>
		);
	}
	const text = data.text.trim() ? data.text : htmlToText(data.html).trim();
	return (
		<div id={id} className="px-4 pb-3">
			<pre className="max-h-96 overflow-y-auto border-t border-border pt-3 font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-foreground auto-scroll dark:border-glass-border">
				{text}
			</pre>
			<Button variant="surface" size="pill-sm" className="mt-2" onClick={() => onOpenReply("reply", data)}>
				<Reply />
				Reply
			</Button>
		</div>
	);
}
