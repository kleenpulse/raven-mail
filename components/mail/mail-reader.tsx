"use client";

import * as React from "react";
import {
	Archive,
	ArrowLeft,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Download,
	Forward,
	ImageOff,
	Inbox,
	LoaderCircle,
	PanelLeftClose,
	PanelLeftOpen,
	Printer,
	Reply,
	ReplyAll,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tip, Tooltip, TooltipContent, TooltipGroup, TooltipTrigger } from "@/components/ui/tooltip";
import { AutoScroll } from "@/components/ui/auto-scroll";
import { PaneState, ReaderSkeleton } from "@/components/mail/skeletons";
import { SenderAvatar } from "@/components/mail/mail-row";
import { TriageBadge, useMessageTriage } from "@/components/mail/triage";
import { EmailFrame, isDesignedEmail } from "@/components/mail/email-frame";
import { promptAlwaysLoadImages, useRemoteImagesPref } from "@/components/mail/remote-images";
import { ShareMenu } from "@/components/integrations/deliver-menu";
import { replyOptions } from "@/lib/mail/reply";
import { useTheme } from "next-themes";
import { useDeferredMailAction } from "@/hooks/use-deferred-mail-action";
import { useMessage, useFolders, useSetFlags } from "@/hooks/use-mail";
import type { DeferredKind } from "@/lib/mail/deferred-actions";
import { messageKeyAction, type MessageKeyAction } from "@/lib/keyboard";
import { registerMessageCommands } from "@/components/shell/palette-store";
import { Conversation, useConversation } from "@/components/mail/conversation";
import { conversationTargets } from "@/lib/mail/thread";
import { folderSpecialUse, resolveSpecialFolder } from "@/lib/mail/folders";
import { formatBytes, formatFullDate, formatRelative } from "@/lib/format";
import type { AttachmentMeta, MailMessage } from "@/lib/mail/types";
import { attachmentHref } from "@/lib/mail/attachment";

function firstAddressLine(list: { name?: string; address: string }[]): string {
	if (list.length === 0) return "";
	const first = list[0]!;
	const label = first.name || first.address;
	return list.length > 1 ? `${label} +${list.length - 1}` : label;
}

function fileKind(file: AttachmentMeta): string {
	const ext = file.filename.includes(".") ? file.filename.split(".").pop() : "";
	const kind = ext || file.contentType.split("/").pop() || "";
	return kind.length > 0 && kind.length <= 4 ? kind : "file";
}

/** A download link when the part is known; a plain label otherwise. */
function AttachmentPill({ file, folder, uid }: { file: AttachmentMeta; folder: string; uid: string }) {
	const body = (
		<>
			<span
				aria-hidden
				className="grid h-8 min-w-8 shrink-0 place-items-center rounded-full bg-card px-1.5 font-mono text-[9.5px] font-semibold tracking-wide text-ink-2 uppercase dark:bg-accent"
			>
				{fileKind(file)}
			</span>
			<span className="min-w-0 leading-tight">
				<span className="block max-w-56 truncate text-[13px] font-medium text-foreground">{file.filename}</span>
				<span className="block font-mono text-[10.5px] text-ink-2 tabular">{formatBytes(file.size)}</span>
			</span>
		</>
	);
	const pill =
		"inline-flex h-11 max-w-full items-center gap-2.5 rounded-pill bg-card-nested pl-1.5 ring-1 ring-border dark:ring-glass-border";
	if (!file.part) {
		return (
			<span title={file.filename} className={cn(pill, "pr-4")}>
				{body}
			</span>
		);
	}
	return (
		<a
			href={attachmentHref(folder, uid, file.part)}
			download={file.filename}
			title={`Download ${file.filename}`}
			className={cn(pill, "group pr-3.5 transition-colors hover:bg-foreground/5")}
		>
			{body}
			<Download
				aria-hidden
				className="size-3.5 shrink-0 text-ink-2 transition-colors group-hover:text-foreground"
			/>
		</a>
	);
}

/** Prev/next through the list while the reader covers it. */
export type ReaderNav = {
	canPrev: boolean;
	canNext: boolean;
	/** The next message is on a page still being fetched. */
	loadingNext: boolean;
	onPrev: () => void;
	onNext: () => void;
};

/** The reader's sheet. Beside the list (md+) only its outer top corner rounds. */
function ReaderPane({ wide = false, children }: { wide?: boolean; children: React.ReactNode }) {
	return (
		<div
			className={cn(
				"@container/reader flex h-full min-h-0 w-full flex-col overflow-hidden rounded-t-frame bg-sheet dark:border-t dark:border-glass-border",
				!wide && "md:rounded-tl-none",
			)}
		>
			{children}
		</div>
	);
}

function ToolCircle({
	label,
	hint,
	className,
	children,
	...props
}: React.ComponentProps<typeof Button> & { label: string; hint?: string }) {
	return (
		<Tip
			label={
				<>
					{label}
					{hint && <Kbd>{hint}</Kbd>}
				</>
			}
			render={
				<Button
					variant="surface"
					size="circle-sm"
					aria-label={label}
					className={cn("text-ink-2 hover:text-foreground", className)}
					{...props}
				/>
			}
		>
			{children}
		</Tip>
	);
}

type ReaderProps = {
	folder: string;
	uid: string;
	accountEmail: string;
	/** The list is hidden and the reader spans the pane. */
	wide: boolean;
	nav: ReaderNav | null;
	onToggleWide: () => void;
	onBack: () => void;
	/** The open message was archived, moved or deleted. */
	onRemoved: (uid: string) => void;
	/** Undo brought it back; reopen it if its folder is still the one showing. */
	onRestored?: (folder: string, uid: string) => void;
	onOpenReply: (mode: "reply" | "replyAll" | "forward", message: MailMessage) => void;
};

export function MailReader({ uid, ...props }: Omit<ReaderProps, "uid"> & { uid: string | null }) {
	if (!uid) {
		return (
			<ReaderPane>
				<PaneState title="Nothing open">
					Pick a thread from the list, or press <Kbd>C</Kbd> to compose.
				</PaneState>
			</ReaderPane>
		);
	}

	return <MailReaderInner key={uid} uid={uid} {...props} />;
}

function MailReaderInner({
	folder,
	uid,
	accountEmail,
	wide,
	nav,
	onToggleWide,
	onBack,
	onRemoved,
	onRestored,
	onOpenReply,
}: ReaderProps) {
	const { data: message, isPending, isError, error } = useMessage(folder, uid);
	const { data: folders } = useFolders();
	const { defer } = useDeferredMailAction();
	const { mutate: mutateFlags } = useSetFlags();
	const thread = useConversation(folder, uid);
	const [showDetails, setShowDetails] = React.useState(false);
	const [loadRemote, setLoadRemote] = React.useState(false);
	const remotePref = useRemoteImagesPref();
	const showRemote = loadRemote || remotePref === "always";
	const detailsId = React.useId();
	const { resolvedTheme } = useTheme();
	const designed = message?.html ? isDesignedEmail(message.html) : false;
	// Free heuristic unless Deep triage (explicit, paid) already scored this message.
	const triage = useMessageTriage(
		{ subject: message?.subject ?? "", snippet: message?.text.slice(0, 400), from: message?.from.address },
		{ folder, uid },
	);
	const markedRef = React.useRef<string | null>(null);

	const role = folderSpecialUse(folders, folder);
	const isTrash = role === "\\Trash";
	const isArchive = role === "\\Archive";
	const archivePath = folders
		? resolveSpecialFolder(folders, "\\Archive")
		: null;
	const inboxPath = folders ? resolveSpecialFolder(folders, "\\Inbox") : null;
	const canArchive = Boolean(archivePath) && !isTrash && !isArchive;
	const canRestoreInbox = isTrash && Boolean(inboxPath) && inboxPath !== folder;

	// Reply all only when it reaches more people than Reply; it leads for group threads.
	const replyAll = message ? replyOptions(message, accountEmail) : null;
	const canReplyAll = Boolean(replyAll?.extra.length);
	const leadAll = Boolean(replyAll?.preferReplyAll);

	React.useEffect(() => {
		if (!message || message.flags.seen || markedRef.current === message.uid) return;
		markedRef.current = message.uid;
		mutateFlags({ folder, uids: [message.uid], seen: true });
	}, [message, folder, mutateFlags]);

	/** Leaves the reader now; the server call waits out the undo window. */
	function move(kind: DeferredKind, destination?: string | null) {
		if (destination === null) {
			toast.error(kind === "archive" ? "No Archive folder" : "No Inbox folder");
			return;
		}
		// The whole conversation in this folder goes, as on a list row.
		const { uids, threadIds } = conversationTargets(thread, folder, uid);
		const id = defer({ kind, folder, uids, destination, threadIds }, { onUndo: () => onRestored?.(folder, uid) });
		if (id) onRemoved(uid);
	}

	// Triage keys and the ⌘K palette act on the open message, which is also the list's selection.
	const runAction = React.useEffectEvent((action: MessageKeyAction) => {
		if (!message) return;
		switch (action) {
			case "archive":
				if (canArchive) move("archive", archivePath);
				return;
			case "trash":
				move(isTrash ? "deleteForever" : "trash");
				return;
			case "star":
				mutateFlags({ folder, uids: [message.uid], flagged: !message.flags.flagged });
				return;
			case "unread":
				mutateFlags({ folder, uids: [message.uid], seen: false });
				toast.success("Marked unread");
				return;
			default:
				onOpenReply(action, message);
		}
	});

	const onKey = React.useEffectEvent((e: KeyboardEvent) => {
		const action = messageKeyAction(e);
		if (!action || !message) return;
		e.preventDefault();
		runAction(action);
	});

	// Cleared on unmount, so the palette never offers actions for a message that's gone.
	React.useEffect(() => {
		if (!message) return;
		const { flagged } = message.flags;
		return registerMessageCommands({ canArchive, inTrash: isTrash, flagged, canReplyAll, run: (a) => runAction(a) });
	}, [message, canArchive, isTrash, canReplyAll]);

	React.useEffect(() => {
		const handler = (e: KeyboardEvent) => onKey(e);
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	if (isPending) {
		return (
			<ReaderPane wide={wide}>
				<ReaderSkeleton />
			</ReaderPane>
		);
	}

	if (isError || !message) {
		return (
			<ReaderPane wide={wide}>
				<PaneState
					tone="critical"
					title="Message unavailable"
					action={
						<Button variant="surface" size="pill-sm" onClick={onBack}>
							<ArrowLeft />
							Back to list
						</Button>
					}
				>
					{error instanceof Error ? error.message : "It may have been moved or deleted."}
				</PaneState>
			</ReaderPane>
		);
	}

	const starred = message.flags.flagged;
	const attachmentCount = message.attachments.length;

	return (
		<ReaderPane wide={wide}>
			<TooltipGroup>
				<div className="flex h-16 shrink-0 items-center gap-1.5 px-3 @md/reader:px-5">
					<ToolCircle label="Back to list" className="md:hidden" onClick={onBack}>
						<ArrowLeft />
					</ToolCircle>
					<ToolCircle
						label="Star"
						aria-pressed={starred}
						onClick={() =>
							mutateFlags({
								folder,
								uids: [message.uid],
								flagged: !starred,
							})
						}
						className={cn(starred && "text-signal hover:text-signal")}
					>
						<Star className={cn(starred && "fill-current")} />
					</ToolCircle>
					{canArchive && (
						<ToolCircle
							label="Archive"
							onClick={() => move("archive", archivePath)}
						>
							<Archive />
						</ToolCircle>
					)}
					{canRestoreInbox && (
						<ToolCircle
							label="Move to Inbox"
							onClick={() => move("inbox", inboxPath)}
						>
							<Inbox />
						</ToolCircle>
					)}
					<ToolCircle
						label={isTrash ? "Delete forever" : "Move to trash"}
						className="hover:text-destructive"
						onClick={() => move(isTrash ? "deleteForever" : "trash")}
					>
						<Trash2 />
					</ToolCircle>
					<ShareMenu folder={folder} message={message} />
					<ToolCircle label="Print" className="hidden @lg/reader:inline-flex" onClick={() => window.print()}>
						<Printer />
					</ToolCircle>

					<div className="ml-auto flex items-center gap-1.5">
						<Button
							variant={leadAll ? "surface" : "default"}
							size="pill-sm"
							aria-label="Reply"
							className={cn("h-9 w-9 px-0 @md/reader:w-auto @md/reader:px-4", leadAll && "order-2")}
							onClick={() => onOpenReply("reply", message)}
						>
							<Reply />
							<span className="hidden @md/reader:inline">Reply</span>
						</Button>
						{canReplyAll && replyAll && (
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											variant={leadAll ? "default" : "surface"}
											size="pill-sm"
											aria-label={`Reply all, ${replyAll.everyone.length} people`}
											className="h-9 w-9 px-0 @md/reader:w-auto @md/reader:px-4"
											onClick={() => onOpenReply("replyAll", message)}
										/>
									}
								>
									<ReplyAll />
									<span className="hidden @md/reader:inline">
										Reply all <span className="font-mono text-[11px] tabular opacity-70">· {replyAll.everyone.length}</span>
									</span>
								</TooltipTrigger>
								<TooltipContent side="bottom" className="max-w-72">
									Also adds {replyAll.extra.map((a) => a.name || a.address).join(", ")}
								</TooltipContent>
							</Tooltip>
						)}
						<Button
							variant="surface"
							size="pill-sm"
							aria-label="Forward"
							className="h-9 w-9 px-0 @md/reader:w-auto @md/reader:px-4"
							onClick={() => onOpenReply("forward", message)}
						>
							<Forward />
							<span className="hidden @md/reader:inline">Forward</span>
						</Button>
						<span aria-hidden className="mx-1 hidden h-5 w-px bg-border md:block dark:bg-glass-border" />
						{nav && (
							<>
								<ToolCircle label="Previous message" hint="K" disabled={!nav.canPrev} onClick={nav.onPrev}>
									<ChevronLeft />
								</ToolCircle>
								<ToolCircle
									label="Next message"
									hint="J"
									disabled={!nav.canNext || nav.loadingNext}
									aria-busy={nav.loadingNext}
									onClick={nav.onNext}
								>
									{nav.loadingNext ? <LoaderCircle className="animate-spin" /> : <ChevronRight />}
								</ToolCircle>
							</>
						)}
						<ToolCircle
							label={wide ? "Show message list" : "Hide message list"}
							hint="F"
							aria-pressed={wide}
							className="hidden md:inline-flex"
							onClick={onToggleWide}
						>
							{wide ? <PanelLeftOpen /> : <PanelLeftClose />}
						</ToolCircle>
						<ToolCircle label="Close" hint="Esc" className="hidden md:inline-flex" onClick={onBack}>
							<X />
						</ToolCircle>
					</div>
				</div>
			</TooltipGroup>

			<AutoScroll className="min-h-0 flex-1 overflow-y-auto mask-[linear-gradient(to_bottom,transparent,black_12px)]">
				<article className="mx-auto w-full max-w-6xl px-4 pt-3 pb-24 @md/reader:px-6 @2xl/reader:px-8">
					<header>
						<h1 className="font-display text-[22px] leading-[1.15] tracking-[-0.02em] text-balance text-foreground @xl/reader:text-[28px]">
							{message.subject || "(no subject)"}
						</h1>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<TriageBadge result={triage} />
						</div>
					</header>

					<Conversation thread={thread} folder={folder} uid={uid} part="before" onOpenReply={onOpenReply} />

					<section aria-label="Message" className="bento mt-5 p-2">
						<div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 pt-3 pb-3.5">
							<SenderAvatar
								name={message.from.name}
								address={message.from.address}
								className="size-10 text-[12px]"
							/>
							<div className="min-w-0 flex-1">
								<p className="flex min-w-0 flex-wrap items-baseline gap-x-2 leading-snug">
									<span className="truncate text-[15px] font-medium text-foreground">
										{message.from.name || message.from.address}
									</span>
									{message.from.name && (
										<span className="truncate text-[13px] text-ink-2">
											{message.from.address}
										</span>
									)}
								</p>
								<button
									type="button"
									aria-expanded={showDetails}
									aria-controls={detailsId}
									onClick={() => setShowDetails((v) => !v)}
									className="mt-0.5 -ml-1.5 inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[13px] text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
								>
									to {firstAddressLine(message.to) || "me"}
									{message.cc.length > 0 && `, cc ${firstAddressLine(message.cc)}`}
									<ChevronDown
										aria-hidden
										className={cn(
											"size-3.5 transition-transform duration-200",
											showDetails && "rotate-180",
										)}
									/>
								</button>
							</div>
							<p className="flex basis-full flex-wrap items-baseline gap-x-2 pl-13 leading-snug whitespace-nowrap @md/reader:block @md/reader:basis-auto @md/reader:pl-0 @md/reader:text-right">
								<span className="block text-[13px] text-foreground">
									{formatRelative(message.date)}
								</span>
								<span className="block font-mono text-[11px] text-ink-2 tabular">
									{formatFullDate(message.date)}
								</span>
							</p>
						</div>

						{showDetails && (
							<dl
								id={detailsId}
								className="mx-1 mb-2 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-[20px] bg-card-nested px-4 py-3.5 text-[12px] leading-relaxed dark:ring-1 dark:ring-glass-border"
							>
								<dt className="readout leading-relaxed">From</dt>
								<dd className="font-mono break-words text-foreground/80">{message.from.address}</dd>
								<dt className="readout leading-relaxed">To</dt>
								<dd className="font-mono break-words text-foreground/80">
									{message.to.map((t) => t.address).join(", ") || "—"}
								</dd>
								{message.cc.length > 0 && (
									<>
										<dt className="readout leading-relaxed">Cc</dt>
										<dd className="font-mono break-words text-foreground/80">
											{message.cc.map((c) => c.address).join(", ")}
										</dd>
									</>
								)}
								<dt className="readout leading-relaxed">Date</dt>
								<dd className="font-mono text-foreground/80">{message.date}</dd>
								{message.messageId && (
									<>
										<dt className="readout leading-relaxed">ID</dt>
										<dd className="truncate font-mono text-foreground/80" title={message.messageId}>
											{message.messageId}
										</dd>
									</>
								)}
							</dl>
						)}

						{attachmentCount > 0 && (
							<div className="px-3 pb-3.5">
								<p className="readout mb-2">
									{attachmentCount} attachment{attachmentCount > 1 ? "s" : ""}
								</p>
								<ul className="flex flex-wrap gap-2">
									{message.attachments.map((a, i) => (
										<li key={`${a.filename}-${i}`} className="max-w-full">
											<AttachmentPill file={a} folder={message.folder} uid={message.uid} />
										</li>
									))}
								</ul>
							</div>
						)}

						{message.html && message.remoteContent && !showRemote && (
							<div className="mx-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] bg-card-nested py-2 pr-2 pl-4 dark:ring-1 dark:ring-glass-border">
								<ImageOff aria-hidden className="size-4 shrink-0 text-ink-2" />
								<p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
									<span className="font-medium text-foreground">Remote images blocked.</span>{" "}
									Senders can&apos;t see when you open this.
								</p>
								<Button variant="surface" size="pill-sm" onClick={() => {
										setLoadRemote(true);
										if (remotePref === null) promptAlwaysLoadImages();
									}}
								>
									Load images
								</Button>
							</div>
						)}

						{/* Designed mail keeps its paper; everything else takes the skin, under a hairline. */}
						<div
							className={
								designed
									? "overflow-hidden rounded-[20px] shadow-card ring-1 ring-border dark:ring-0"
									: "mx-3 border-t border-border dark:border-glass-border"
							}
						>
							{message.html ? (
								<EmailFrame
									html={message.html}
									allowRemote={showRemote}
									look={{ designed, dark: resolvedTheme === "dark" }}
									title={message.subject}
								/>
							) : (
								<pre className="max-w-3xl py-[18px] pr-5 pb-[22px] pl-13 font-sans text-[15px] leading-relaxed whitespace-pre-wrap text-foreground @max-md/reader:px-0">
									{message.text}
								</pre>
							)}
						</div>
					</section>

					<Conversation thread={thread} folder={folder} uid={uid} part="after" onOpenReply={onOpenReply} />
				</article>
			</AutoScroll>
		</ReaderPane>
	);
}
