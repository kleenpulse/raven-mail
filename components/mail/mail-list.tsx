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
import { useMailRows } from "@/hooks/use-mail-rows";
import { useWheelScrollX } from "@/hooks/use-wheel-scroll-x";
import { setFlagsAction } from "@/lib/actions/mail";
import { folderSpecialUse, resolveSpecialFolder } from "@/lib/mail/folders";
import { rowOf, type ThreadRow } from "@/lib/mail/thread";
import { TAB_FILL, TAB_LABEL, type SplitTab } from "@/lib/mail/split-inbox";
import { paneOf } from "@/lib/query-pane";
import { useOffline } from "next/offline";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { motion } from "motion/react";
import type { MailFolder } from "@/lib/mail/types";
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
	openDraftUid = null,
	visible = true,
	onSelectUid,
}: {
	folder: string;
	search: string;
	selectedUid: string | null;
	/** The draft open in compose (Drafts folder only): marked like an open message. */
	openDraftUid?: string | null;
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
			openDraftUid={openDraftUid}
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

/** A sparse tab loads more by itself up to this many Inbox messages; past it, Load more is a click. */
const AUTO_FILL_LIMIT = 350;

/** Inbox tabs as moving-pill toggles; the scroller lets the pill track its tab on phones. */
function SplitTabs({ split, onChange }: { split: NonNullable<ReturnType<typeof useMailRows>["split"]>; onChange: (tab: SplitTab) => void }) {
	const ref = React.useRef<HTMLDivElement>(null);
	useWheelScrollX(ref);
	// A tab opened from a link may start off-screen on a phone, and counts growing as pages load shift it again.
	const widths = split.tabs.map((t) => t.unread).join();
	React.useEffect(() => {
		ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [split.tab, widths]);
	return (
		<motion.div ref={ref} layoutScroll className="auto-scroll shrink-0 overflow-x-auto px-3 pb-1 @md/list:px-4">
			<ToggleGroup
				aria-label="Inbox tabs"
				value={[split.tab]}
				onValueChange={(next) => {
					const value = next[0] as SplitTab | undefined;
					if (value) onChange(value);
				}}
				variant="pill"
				size="pill"
				spacing={0}
				indicator={false}
				className="w-max rounded-pill bg-card p-1 dark:bg-background/40"
			>
				{split.tabs.map((t) => (
					<ToggleGroupItem key={t.id} value={t.id} className="gap-1.5 rounded-pill px-3 text-[13px] aria-pressed:text-signal-ink dark:aria-pressed:text-signal">
						{t.label}
						{t.unread > 0 && (
							<span className="font-mono text-[10.5px] text-signal-ink tabular dark:text-signal">
								{t.unread}
								<span className="sr-only"> unread</span>
							</span>
						)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</motion.div>
	);
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
	openDraftUid,
	visible,
	onSelectUid,
}: {
	folder: string;
	search: string;
	selectedUid: string | null;
	openDraftUid: string | null;
	visible: boolean;
	onSelectUid: (uid: string | null) => void;
}) {
	const {
		data,
		isPending,
		isError,
		isRefetchError,
		isFetchNextPageError,
		fetchStatus,
		error,
		refetch,
		isFetching,
		hasNextPage,
		isFetchingNextPage,
		fetchNextPage,
	} = useMessages(folder, search || undefined);
	const offline = useOffline();
	const { pane, refreshFailed } = paneOf({ hasData: Boolean(data), isError, isRefetchError, isFetchNextPageError, fetchStatus });
	// Idle, not just "not paused": the retry after reconnect is still "error" while it runs.
	const staleNotice = refreshFailed && fetchStatus === "idle" && !offline;
	const { data: folders } = useFolders();
	const invalidate = useInvalidateMail();
	const { defer } = useDeferredMailAction();
	const { mutate: mutateFlags } = useSetFlags();
	// Row keys (a conversation's newest uid); bulk actions expand them to every member.
	const [checked, setChecked] = React.useState<Set<string>>(new Set());
	const [busy, setBusy] = React.useState(false);
	const rowsRef = React.useRef<HTMLDivElement>(null);
	const preloadRoot = usePreloadInView(folder, data?.messages, selectedUid);
	const { rows, split, setTab } = useMailRows(data?.messages, search, { inbox: folder.toUpperCase() === "INBOX" });
	const selectedRow = rows[rowOf(rows, selectedUid)];
	// Styling only: keyboard actions stay on the reader's row, never the draft being edited.
	const openRow = selectedRow ?? rows[rowOf(rows, openDraftUid)];

	// A sparse tab pulls in a few more pages by itself, then leaves it to Load more.
	const filling =
		Boolean(split) && rows.length < TAB_FILL && hasNextPage && (data?.messages.length ?? 0) < AUTO_FILL_LIMIT;
	React.useEffect(() => {
		if (filling && !isFetchingNextPage) void fetchNextPage();
	}, [filling, isFetchingNextPage, fetchNextPage]);

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
		if (!ready || !(selectedUid || openDraftUid) || !visible) return;
		const current = rowsRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
		current?.parentElement?.scrollIntoView({ block: "nearest" });
	}, [ready, selectedUid, openDraftUid, visible]);

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
		const keys = new Set(checked.size ? checked : selectedRow ? [selectedRow.key] : []);
		const picked = rows.filter((r) => keys.has(r.key));
		const uids = picked.flatMap((r) => r.members.map((m) => m.uid));
		if (uids.length === 0) {
			toast.message("Select messages first");
			return;
		}
		// With a server thread id the commit also reaches members this list never loaded.
		const ids = [...new Set(picked.flatMap((r) => r.threadIds))];
		const threadIds = ids.length ? ids : undefined;

		if (kind !== "read" && kind !== "unread") {
			const destination = kind === "archive" ? archivePath : kind === "inbox" ? inboxPath : undefined;
			if (destination === null) {
				toast.error(kind === "archive" ? "No Archive folder" : "No Inbox folder");
				return;
			}
			const before = { checked, selectedUid };
			const id = defer(
				{ kind, folder, uids, destination, threadIds },
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
				threadIds,
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

	/** A starred conversation unstars every starred message; otherwise the newest gets the star. */
	function toggleStar(row: ThreadRow) {
		if (row.flagged) {
			const starred = row.members.filter((m) => m.flags.flagged).map((m) => m.uid);
			mutateFlags({ folder, uids: starred, flagged: false });
		} else {
			mutateFlags({ folder, uids: [row.latest.uid], flagged: true });
		}
	}

	const solo = !selectedUid;

	if (pane === "loading") {
		return (
			<ListPane solo={solo}>
				<MailListSkeleton />
			</ListPane>
		);
	}

	if (pane === "waiting") {
		return (
			<ListPane solo={solo}>
				<PaneState title="Waiting for a connection">This folder loads as soon as you&apos;re back online.</PaneState>
			</ListPane>
		);
	}

	if (pane === "failed") {
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
	const allChecked = rows.length > 0 && selectedCount === rows.length;
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
			<TooltipGroup>
				<div className="flex h-16 shrink-0 items-center justify-between gap-2 px-3 @md/list:px-4">
					<div className="flex min-w-0 items-center gap-2">
						<div className="inline-flex h-10 min-w-0 items-center gap-3 rounded-pill pr-4 pl-3 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
							<Checkbox
								checked={allChecked}
								indeterminate={selectedCount > 0 && !allChecked}
								disabled={messages.length === 0}
								onCheckedChange={(next) => setChecked(next ? new Set(rows.map((r) => r.key)) : new Set())}
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
							{busy && (
								<>
									<LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-2" />
									<span className="sr-only">Syncing</span>
								</>
							)}
						</div>
						<ToolButton
							label={isFetching ? "Syncing…" : "Refresh"}
							disabled={isFetching}
							onClick={() => {
								void invalidate.invalidateMessages(folder);
								void invalidate.invalidateFolders();
							}}
							className="size-10 shrink-0 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border"
						>
							<RotateCw className={cn(isFetching && "animate-spin")} />
						</ToolButton>
					</div>

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
				</div>
			</TooltipGroup>

			{staleNotice && (
				<div role="status" className="flex shrink-0 items-center gap-2 px-4 pb-2 text-[12px] text-ink-2 @md/list:px-5">
					<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-critical" />
					<span className="min-w-0 flex-1 truncate">Couldn&apos;t refresh. Showing what was loaded.</span>
					<button
						type="button"
						onClick={() => void refetch()}
						className="shrink-0 rounded-pill px-2 py-0.5 font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
					>
						Try again
					</button>
				</div>
			)}

			{split && messages.length > 0 && (
				<SplitTabs
					split={split}
					onChange={(next) => {
						setChecked(new Set());
						void setTab(next);
					}}
				/>
			)}

			{messages.length === 0 ? (
				<PaneState title={empty.title}>{empty.body}</PaneState>
			) : split && rows.length === 0 && filling ? (
				<MailListSkeleton />
			) : split && rows.length === 0 ? (
				<PaneState title={`Nothing in ${TAB_LABEL[split.tab]}`}>
					{split.tab === "all"
						? "Every Inbox thread shows up here, whatever tab it sits in."
						: split.tab === "important"
							? "Mail from people, and anything not sorted into another tab, shows up here."
							: `${TAB_LABEL[split.tab]} land here as they arrive. Choose your tabs in Settings → Mail.`}
					{hasNextPage && (
						<LoadMore loading={isFetchingNextPage} remaining={total - messages.length} onLoad={() => void fetchNextPage()} />
					)}
				</PaneState>
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
						{rows.map((row) => {
							const active = row === openRow;
							return (
								<MailRow
									key={row.key}
									// The newest message stands for the row, with the whole conversation's state.
									message={{
										...row.latest,
										flags: { ...row.latest.flags, seen: !row.unread, flagged: row.flagged },
										hasAttachments: row.hasAttachments,
									}}
									thread={row.members.length > 1 ? { people: row.people, count: row.members.length } : undefined}
									active={active}
									selected={checked.has(row.key)}
									// A second click closes the reader; an open draft just comes back up.
									onSelectRow={(uid) => onSelectUid(active && row === selectedRow ? null : uid)}
									onToggleSelect={toggleSelect}
									onToggleStar={() => toggleStar(row)}
								/>
							);
						})}
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
