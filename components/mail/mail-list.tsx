"use client";

import * as React from "react";
import { Archive, Inbox, LoaderCircle, Mail, MailOpen, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tip, TooltipGroup } from "@/components/ui/tooltip";
import { AutoScroll } from "@/components/ui/auto-scroll";
import { MailRow } from "@/components/mail/mail-row";
import { MailListSkeleton, PaneState } from "@/components/mail/skeletons";
import {
	useFolders,
	useMessages,
	useInvalidateMail,
	useSetFlags,
} from "@/hooks/use-mail";
import { useDeferredMailAction } from "@/hooks/use-deferred-mail-action";
import { usePreloadInView } from "@/hooks/use-preload-in-view";
import { setFlagsAction } from "@/lib/actions/mail";
import { folderSpecialUse, resolveSpecialFolder } from "@/lib/mail/folders";
import type { MailFolder, MailSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

const EMPTY_COPY: Record<NonNullable<MailFolder["specialUse"]> | "other", { title: string; body: string }> = {
	"\\Inbox": { title: "Inbox zero", body: "Nothing is waiting on you. New mail lands here." },
	"\\Sent": { title: "Nothing sent yet", body: "Messages you send will show up here." },
	"\\Drafts": { title: "No drafts", body: "Messages you save for later wait here." },
	"\\Archive": { title: "Archive is empty", body: "Archived mail stays here, out of your inbox." },
	"\\Junk": { title: "No junk", body: "Mail flagged as spam is set aside here." },
	"\\Trash": { title: "Trash is empty", body: "Deleted messages collect here." },
	other: { title: "Nothing here yet", body: "Messages filed in this folder will show up here." },
};

export function MailList({
	folder,
	search,
	selectedUid,
	visible = true,
	onSelectUid,
}: {
	folder: string;
	search: string;
	selectedUid: string | null;
	/** False while the reader covers the list; showing it again re-reveals the open row. */
	visible?: boolean;
	onSelectUid: (uid: string | null) => void;
}) {
	return (
		<MailListInner
			key={folder}
			folder={folder}
			search={search}
			selectedUid={selectedUid}
			visible={visible}
			onSelectUid={onSelectUid}
		/>
	);
}

/** The list's sheet. With no reader beside it, it rounds both top corners. */
function ListPane({ solo, children }: { solo: boolean; children: React.ReactNode }) {
	return (
		<div
			className={cn(
				"@container/list flex h-full min-h-0 flex-col overflow-hidden rounded-tl-frame bg-sheet dark:border-t dark:border-l dark:border-glass-border",
				solo && "rounded-tr-frame",
			)}
		>
			{children}
		</div>
	);
}

function ToolButton({
	label,
	className,
	children,
	...props
}: React.ComponentProps<typeof Button> & { label: string }) {
	return (
		<Tip
			label={label}
			render={
				<Button
					variant="ghost"
					size="icon"
					aria-label={label}
					className={cn("rounded-full text-ink-2 hover:text-foreground", className)}
					{...props}
				/>
			}
		>
			{children}
		</Tip>
	);
}

function folderLabel(folders: MailFolder[] | undefined, path: string): string {
	const name = folders?.find((f) => f.path === path)?.name ?? path;
	return name.toUpperCase() === "INBOX" ? "Inbox" : name;
}

/** Loads the next page when it scrolls into view; the button covers keyboard users and failed loads. */
function LoadMore({ loading, remaining, onLoad }: { loading: boolean; remaining: number; onLoad: () => void }) {
	const ref = React.useRef<HTMLButtonElement>(null);
	const load = React.useEffectEvent(() => {
		if (!loading) onLoad();
	});
	React.useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && load(), { rootMargin: "320px 0px" });
		io.observe(el);
		return () => io.disconnect();
	}, []);
	return (
		<button
			ref={ref}
			type="button"
			onClick={onLoad}
			disabled={loading}
			className="mx-auto mt-3 flex h-9 items-center gap-2 rounded-pill px-4 font-mono text-[11px] text-ink-2 ring-1 ring-border transition-colors hover:text-foreground disabled:opacity-70 dark:ring-glass-border"
		>
			{loading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
			{loading ? "Loading…" : `Load more · ${remaining.toLocaleString()} left`}
		</button>
	);
}

function MailListInner({
	folder,
	search,
	selectedUid,
	visible,
	onSelectUid,
}: {
	folder: string;
	search: string;
	selectedUid: string | null;
	visible: boolean;
	onSelectUid: (uid: string | null) => void;
}) {
	const { data, isPending, isError, error, isFetching, hasNextPage, isFetchingNextPage, fetchNextPage } =
		useMessages(folder, search || undefined);
	const { data: folders } = useFolders();
	const invalidate = useInvalidateMail();
	const { defer } = useDeferredMailAction();
	const { mutate: mutateFlags } = useSetFlags();
	const [checked, setChecked] = React.useState<Set<string>>(new Set());
	const [busy, setBusy] = React.useState(false);
	const rowsRef = React.useRef<HTMLDivElement>(null);
	const preloadRoot = usePreloadInView(folder, data?.messages, selectedUid);

	const role = folderSpecialUse(folders, folder);
	const isTrash = role === "\\Trash";
	const isArchive = role === "\\Archive";
	const inboxPath = folders ? resolveSpecialFolder(folders, "\\Inbox") : null;
	const archivePath = folders
		? resolveSpecialFolder(folders, "\\Archive")
		: null;
	const canArchive = Boolean(archivePath) && !isTrash && !isArchive;
	const canRestoreInbox = isTrash && Boolean(inboxPath) && inboxPath !== folder;

	// j/k and the wide view's prev/next move the selection from app-shell; keep
	// the open row in view, including when a hidden list comes back.
	const ready = !isPending;
	React.useEffect(() => {
		if (!ready || !selectedUid || !visible) return;
		const current = rowsRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
		current?.parentElement?.scrollIntoView({ block: "nearest" });
	}, [ready, selectedUid, visible]);

	function toggleSelect(uid: string, next: boolean) {
		setChecked((prev) => {
			const copy = new Set(prev);
			if (next) copy.add(uid);
			else copy.delete(uid);
			return copy;
		});
	}

	async function runBulk(
		kind: "archive" | "trash" | "read" | "unread" | "inbox" | "deleteForever",
	) {
		const uids = checked.size ? [...checked] : selectedUid ? [selectedUid] : [];
		if (uids.length === 0) {
			toast.message("Select messages first");
			return;
		}

		if (kind !== "read" && kind !== "unread") {
			const destination = kind === "archive" ? archivePath : kind === "inbox" ? inboxPath : undefined;
			if (destination === null) {
				toast.error(kind === "archive" ? "No Archive folder" : "No Inbox folder");
				return;
			}
			const before = { checked, selectedUid };
			const id = defer(
				{ kind, folder, uids, destination },
				{
					// Undo puts the selection back too, not just the rows.
					onUndo: () => {
						setChecked(new Set(before.checked));
						if (before.selectedUid && uids.includes(before.selectedUid)) onSelectUid(before.selectedUid);
					},
				},
			);
			if (id) {
				setChecked(new Set());
				if (selectedUid && uids.includes(selectedUid)) onSelectUid(null);
			}
			return;
		}

		setBusy(true);
		try {
			const res = await setFlagsAction({
				folder,
				uids,
				seen: kind === "read",
			});
			if (!res.ok) throw new Error(res.error);
			toast.success(kind === "read" ? "Marked read" : "Marked unread");
			setChecked(new Set());
			if (selectedUid && uids.includes(selectedUid)) onSelectUid(null);
			invalidate.invalidateMessages(folder);
			invalidate.invalidateFolders();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Action failed");
		} finally {
			setBusy(false);
		}
	}

	function toggleStar(message: MailSummary) {
		mutateFlags({ folder, uids: [message.uid], flagged: !message.flags.flagged });
	}

	const solo = !selectedUid;

	if (isPending) {
		return (
			<ListPane solo={solo}>
				<MailListSkeleton />
			</ListPane>
		);
	}

	if (isError) {
		return (
			<ListPane solo={solo}>
				<PaneState
					tone="critical"
					title="Couldn't load this folder"
					action={
						<Button
							variant="surface"
							size="pill-sm"
							onClick={() => invalidate.invalidateMessages(folder)}
						>
							<RotateCw />
							Try again
						</Button>
					}
				>
					{error instanceof Error ? error.message : "Could not load mail"}
				</PaneState>
			</ListPane>
		);
	}

	const messages = data?.messages ?? [];
	const selectedCount = checked.size;
	const allChecked = messages.length > 0 && selectedCount === messages.length;
	const total = data?.count ?? messages.length;
	const unread = search ? 0 : (folders?.find((f) => f.path === folder)?.unread ?? 0);
	const empty = search
		? {
				title: "No matches",
				body: `Nothing in this folder matches “${search}”. Try a sender, a subject, or a phrase from the message.`,
			}
		: EMPTY_COPY[role ?? "other"];

	return (
		<ListPane solo={solo}>
			<div className="flex h-16 shrink-0 items-center justify-between gap-2 px-3 @md/list:px-4">
				<div className="inline-flex h-10 min-w-0 items-center gap-3 rounded-pill pr-4 pl-3 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
					<Checkbox
						checked={allChecked}
						indeterminate={selectedCount > 0 && !allChecked}
						disabled={messages.length === 0}
						onCheckedChange={(next) =>
							setChecked(next ? new Set(messages.map((m) => m.uid)) : new Set())
						}
						aria-label="Select all"
					/>
					<p aria-live="polite" className="flex min-w-0 items-baseline gap-2 text-[13px]">
						{selectedCount > 0 ? (
							<span className="font-medium text-foreground">
								<span className="tabular">{selectedCount}</span> selected
							</span>
						) : (
							<>
								<span className="truncate font-medium text-foreground">
									{folderLabel(folders, folder)}
								</span>
								<span className="font-mono text-[11px] whitespace-nowrap text-ink-2 tabular">
									{total > messages.length ? `${messages.length} of ${total}` : messages.length}
									<span className="sr-only"> messages</span>
								</span>
								{unread > 0 && (
									<span className="hidden font-mono text-[11px] whitespace-nowrap text-signal-ink tabular @lg/list:inline dark:text-signal">
										· {unread} unread
									</span>
								)}
							</>
						)}
					</p>
					{(isFetching || busy) && (
						<>
							<LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-2" />
							<span className="sr-only">Syncing</span>
						</>
					)}
				</div>

				<TooltipGroup>
					<div
						role="group"
						aria-label="Selection actions"
						className="inline-flex h-10 shrink-0 items-center gap-0.5 rounded-pill p-1 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border"
					>
						<ToolButton label="Mark read" disabled={busy} onClick={() => runBulk("read")}>
							<MailOpen />
						</ToolButton>
						<ToolButton label="Mark unread" disabled={busy} onClick={() => runBulk("unread")}>
							<Mail />
						</ToolButton>
						{canArchive && (
							<ToolButton label="Archive" disabled={busy} onClick={() => runBulk("archive")}>
								<Archive />
							</ToolButton>
						)}
						{canRestoreInbox && (
							<ToolButton label="Move to Inbox" disabled={busy} onClick={() => runBulk("inbox")}>
								<Inbox />
							</ToolButton>
						)}
						<ToolButton
							label={isTrash ? "Delete forever" : "Move to trash"}
							disabled={busy}
							onClick={() => runBulk(isTrash ? "deleteForever" : "trash")}
							className="hover:text-destructive"
						>
							<Trash2 />
						</ToolButton>
					</div>
				</TooltipGroup>
			</div>

			{messages.length === 0 ? (
				<PaneState title={empty.title}>{empty.body}</PaneState>
			) : (
				<AutoScroll
					ref={preloadRoot}
					className="min-h-0 flex-1 overflow-y-auto mask-[linear-gradient(to_bottom,transparent,black_10px)]"
				>
					<div
						ref={rowsRef}
						data-selecting={selectedCount > 0 ? "true" : undefined}
						className="group/list space-y-(--row-gap) px-3 pt-2.5 pb-24 @md/list:px-4"
					>
						{messages.map((message) => (
							<MailRow
								key={message.uid}
								message={message}
								active={message.uid === selectedUid}
								selected={checked.has(message.uid)}
								onSelectRow={(uid) =>
									onSelectUid(uid === selectedUid ? null : uid)
								}
								onToggleSelect={toggleSelect}
								onToggleStar={toggleStar}
							/>
						))}
						{hasNextPage && (
							<LoadMore
								loading={isFetchingNextPage}
								remaining={total - messages.length}
								onLoad={() => void fetchNextPage()}
							/>
						)}
					</div>
				</AutoScroll>
			)}
		</ListPane>
	);
}
