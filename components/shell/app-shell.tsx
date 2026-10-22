"use client";

import * as React from "react";
import { useQueryState } from "nuqs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Topbar } from "@/components/shell/topbar";
import { Sidebar } from "@/components/shell/sidebar";
import { MailList } from "@/components/mail/mail-list";
import { MailReader, type ReaderNav } from "@/components/mail/mail-reader";
import { ListSplitter } from "@/components/mail/list-splitter";
import { useComposeStore } from "@/lib/store/compose";
import { useFolders, useMessages, usePrefetchNeighbours } from "@/hooks/use-mail";
import { useMailRows } from "@/hooks/use-mail-rows";
import { rowOf } from "@/lib/mail/thread";
import { useResumeDraft } from "@/hooks/use-resume-draft";
import { folderSpecialUse } from "@/lib/mail/folders";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAccount } from "@/components/providers/account-provider";
import { buildReplyDraft, type ReplyMode } from "@/lib/mail/reply";
import { writeMailLayoutCookie, type MailLayout } from "@/lib/mail/reader-layout";
import type { MailMessage } from "@/lib/mail/types";
import { allowSingleKey } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { TOUR_TARGET, tourAttr } from "@/components/tour/anchors";

export function AppShell({ initialLayout }: { initialLayout: MailLayout }) {
	const account = useAccount();
	const [folder, setFolder] = useQueryState("folder", {
		defaultValue: "INBOX",
		clearOnDefault: true,
	});
	const [uid, setUid] = useQueryState("uid", {
		defaultValue: "",
		clearOnDefault: true,
	});
	const [search, setSearch] = useQueryState("q", {
		defaultValue: "",
		clearOnDefault: true,
	});
	const [sidebarOpen, setSidebarOpen] = React.useState(false);
	const [layout, setLayout] = React.useState(initialLayout);
	const openCompose = useComposeStore((s) => s.openCompose);
	const listRef = React.useRef<HTMLElement>(null);
	const listId = React.useId();
	const desktop = useMediaQuery("(min-width: 48rem)");

	const activeFolder = folder || "INBOX";
	const { data: folders } = useFolders();
	// Drafts open in compose, never the reader: however a uid got here (click, j/k, a link).
	const inDrafts = folderSpecialUse(folders, activeFolder) === "\\Drafts";
	const resumeDraft = useResumeDraft();
	React.useEffect(() => {
		if (!inDrafts || !uid) return;
		void setUid(null);
		void resumeDraft(activeFolder, uid);
	}, [inDrafts, uid, activeFolder, setUid, resumeDraft]);
	const selectedUid = (!inDrafts && uid) || null;
	// One IMAP search per pause in typing, not per keystroke.
	const querySearch = useDebouncedValue(search, 300);
	const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useMessages(activeFolder, querySearch || undefined);

	const readerVisible = Boolean(selectedUid);
	// The preference persists, but it only hides the list while something is open.
	const wide = layout.wide && readerVisible;

	React.useEffect(() => writeMailLayoutCookie(layout), [layout]);

	// j/k, prev/next and "step to a neighbour" walk the list's rows: conversations when threading is on.
	// IMAP names the Inbox INBOX in any case (RFC 3501), so this holds before folders load.
	const { rows, toRows } = useMailRows(data?.messages, querySearch, { inbox: activeFolder.toUpperCase() === "INBOX" });
	const index = rowOf(rows, selectedUid);
	// Next first: reading runs down the list.
	usePrefetchNeighbours(activeFolder, index < 0 ? [] : [rows[index + 1]?.key, rows[index - 1]?.key]);
	const selectedRef = React.useRef(selectedUid);
	React.useEffect(() => {
		selectedRef.current = selectedUid;
	}, [selectedUid]);

	const goPrev = () => {
		const prev = index > 0 ? rows[index - 1] : undefined;
		if (prev) void setUid(prev.key);
	};

	const goNext = async () => {
		if (index < 0) return;
		const from = selectedUid;
		const next = rows[index + 1];
		if (next) {
			void setUid(next.key);
			// Stepping onto the last loaded row pulls the next page in behind it.
			if (index + 2 >= rows.length && hasNextPage && !isFetchingNextPage) void fetchNextPage();
			return;
		}
		if (!hasNextPage) return;
		// At the end of what's loaded: wait for the next page, then step — unless
		// the reader moved on meanwhile.
		const res = await fetchNextPage({ cancelRefetch: false });
		const loaded = toRows(res.data?.messages ?? []);
		const after = loaded[rowOf(loaded, from) + 1];
		if (after && selectedRef.current === from) void setUid(after.key);
	};

	const toggleWide = () => setLayout((l) => ({ ...l, wide: !l.wide }));

	const onKey = React.useEffectEvent((e: KeyboardEvent) => {
		if (!allowSingleKey(e)) return;
		// Caps Lock shouldn't matter; Shift+letter belongs to the reader's keys (Shift+U, Shift+F).
		const key = e.key.length === 1 ? (e.shiftKey ? "" : e.key.toLowerCase()) : e.key;
		if (key === "Escape") {
			void setUid(null);
			return;
		}
		if (key === "u" || key === "Backspace") {
			e.preventDefault();
			void setUid(null);
			return;
		}
		if (key === "g") {
			e.preventDefault();
			void setFolder(null);
			return;
		}
		if (key === "f") {
			if (!desktop || !readerVisible) return;
			e.preventDefault();
			toggleWide();
			return;
		}
		if (!rows.length) return;
		if (key === "j" || key === "ArrowDown") {
			e.preventDefault();
			if (index < 0) void setUid(rows[0]!.key);
			else void goNext();
		} else if (key === "k" || key === "ArrowUp") {
			e.preventDefault();
			if (index < 0) void setUid(rows[0]!.key);
			else goPrev();
		}
	});

	React.useEffect(() => {
		const handler = (e: KeyboardEvent) => onKey(e);
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	const handleReply = React.useCallback(
		(mode: ReplyMode, message: MailMessage) => {
			openCompose(mode, buildReplyDraft(message, mode, account.email));
		},
		[openCompose, account.email],
	);

	// Undo fires seconds later, from a closure of the render that removed the message.
	const folderRef = React.useRef(activeFolder);
	React.useEffect(() => {
		folderRef.current = activeFolder;
	}, [activeFolder]);
	const handleRestored = React.useCallback(
		(restoredFolder: string, restoredUid: string) => {
			if (folderRef.current === restoredFolder) void setUid(restoredUid);
		},
		[setUid],
	);

	// Archive / delete / move: with the list out of view there's nothing to fall
	// back to, so step to a neighbour instead of dropping to an empty pane.
	const handleRemoved = (removedUid: string) => {
		if (selectedRef.current !== removedUid) return;
		if (!wide || !desktop) {
			void setUid(null);
			return;
		}
		const at = rowOf(rows, removedUid);
		const neighbour = at < 0 ? undefined : (rows[at + 1] ?? rows[at - 1]);
		void setUid(neighbour?.key ?? null);
	};

	const nav: ReaderNav | null =
		wide && desktop
			? {
					canPrev: index > 0,
					canNext: index >= 0 && (index + 1 < rows.length || hasNextPage),
					loadingNext: isFetchingNextPage && index + 1 >= rows.length,
					onPrev: goPrev,
					onNext: () => void goNext(),
				}
			: null;

	return (
		<div className="flex h-full min-h-0 w-full overflow-hidden">
			<div className="hidden w-60 shrink-0 lg:block">
				<Sidebar
					folder={activeFolder}
					onSelectFolder={(path) => {
						void setFolder(path === "INBOX" ? null : path);
						void setUid(null);
						setSidebarOpen(false);
					}}
				/>
			</div>

			<Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
				<SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
					<SheetTitle className="sr-only">Folders</SheetTitle>
					<Sidebar
						folder={activeFolder}
						onSelectFolder={(path) => {
							void setFolder(path === "INBOX" ? null : path);
							void setUid(null);
							setSidebarOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>

			<div className="flex min-w-0 flex-1 flex-col">
				<Topbar
					search={search}
					onSearchChange={(value) => {
						void setSearch(value || null);
						// Results land in the list — show it if the reader is covering it.
						if (selectedUid && (wide || !desktop)) void setUid(null);
					}}
					onOpenSidebar={() => setSidebarOpen(true)}
				/>

				<div className="flex min-h-0 flex-1">
					<section
						ref={listRef}
						id={listId}
						style={layout.listWidth ? ({ "--list-w": `${layout.listWidth}px` } as React.CSSProperties) : undefined}
						className={cn(
							"flex min-w-0 shrink-0 flex-col",
							!readerVisible
								? "w-full shrink"
								: wide
									? "hidden"
									: cn(
											"hidden md:flex md:border-r md:border-border dark:md:border-glass-border",
											// A saved width still yields to the reader when the window narrows.
											layout.listWidth
												? "md:w-[min(var(--list-w),max(17.5rem,100%_-_22.5rem))]"
												: "md:w-[24rem] xl:w-[26rem]",
										),
						)}
						aria-label="Message list"
						{...tourAttr(TOUR_TARGET.mailList)}
					>
						<MailList
							folder={activeFolder}
							search={querySearch}
							selectedUid={selectedUid}
							visible={!readerVisible || (!wide && desktop)}
							onSelectUid={(next) => void setUid(next ?? "")}
						/>
					</section>

					{readerVisible && (
						<ListSplitter listRef={listRef} listId={listId} layout={layout} onLayout={setLayout} />
					)}

					<section
						className={cn(
							"min-w-0 flex-1",
							readerVisible ? "flex" : "hidden md:flex",
						)}
						aria-label="Message reader"
					>
						<MailReader
							folder={activeFolder}
							uid={selectedUid}
							accountEmail={account.email}
							wide={wide}
							nav={nav}
							onToggleWide={toggleWide}
							onBack={() => void setUid(null)}
							onRemoved={handleRemoved}
							onRestored={handleRestored}
							onOpenReply={handleReply}
						/>
					</section>
				</div>
			</div>

		</div>
	);
}
