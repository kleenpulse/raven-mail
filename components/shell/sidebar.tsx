"use client";

import * as React from "react";
import {
	Archive,
	Bookmark,
	FilePen,
	Inbox,
	Send,
	ShieldAlert,
	Star,
	Trash2,
	type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { TAB_SPRING } from "@/lib/motion";
import { useFolders } from "@/hooks/use-mail";
import { useAccount } from "@/components/providers/account-provider";
import { AutoScroll } from "@/components/ui/auto-scroll";
import { FolderSkeleton } from "@/components/mail/skeletons";
import type { MailFolder } from "@/lib/mail/types";

const QUICK_FOLDERS: {
	role: NonNullable<MailFolder["specialUse"]>;
	label: string;
	icon: LucideIcon;
}[] = [
	{ role: "\\Inbox", label: "Inbox", icon: Inbox },
	{ role: "\\Sent", label: "Sent", icon: Send },
	{ role: "\\Drafts", label: "Drafts", icon: FilePen },
	{ role: "\\Archive", label: "Archive", icon: Archive },
	{ role: "\\Junk", label: "Junk", icon: ShieldAlert },
	{ role: "\\Trash", label: "Trash", icon: Trash2 },
];

/** Provider labels with no IMAP special-use flag (Gmail's [Gmail]/Starred etc.), matched by name. */
const LABEL_ICONS: Record<string, LucideIcon> = {
	starred: Star,
	important: Bookmark,
};

function findFolder(
	folders: MailFolder[],
	role: MailFolder["specialUse"],
	path?: string,
): MailFolder | undefined {
	return path
		? (folders.find((f) => f.path === path) ??
				folders.find((f) => f.specialUse === role))
		: folders.find((f) => f.specialUse === role);
}

/** Unread wins (signal ink); otherwise the folder's total, quietly. */
function FolderCount({ folder, active }: { folder?: MailFolder; active: boolean }) {
	if (!folder) return null;
	const unread = folder.unread > 0;
	const value = unread ? folder.unread : folder.total;
	if (value <= 0) return null;
	return (
		<span
			title={unread ? `${value} unread` : `${value} messages`}
			className={cn(
				"font-mono text-[11px] tabular",
				active
					? "text-sidebar-primary-foreground/75"
					: unread
						? "font-semibold text-signal-ink"
						: "text-ink-2",
			)}
		>
			{value}
			<span className="sr-only">{unread ? " unread" : " messages"}</span>
		</span>
	);
}

const itemClass = (active: boolean) =>
	cn(
		"group relative isolate flex h-10 w-full items-center gap-3 rounded-pill pr-4 pl-3 text-[13.5px] outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring",
		active
			? "font-medium text-sidebar-primary-foreground"
			: "text-ink-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
	);

/** The active folder's pill; one per sidebar, springing between rows (Shadow Garden pill-tabs). */
function ActivePill({ layoutId }: { layoutId: string }) {
	return (
		<motion.span
			layoutId={layoutId}
			aria-hidden
			transition={TAB_SPRING}
			className="absolute inset-0 -z-10 rounded-pill bg-sidebar-primary dark:shadow-glow"
		/>
	);
}

export function Sidebar({
	folder,
	onSelectFolder,
	className,
}: {
	folder: string;
	onSelectFolder: (path: string) => void;
	className?: string;
}) {
	const { data: folders, isPending, isError, error } = useFolders();
	const account = useAccount();
	const pillId = React.useId();

	const specialPaths = React.useMemo(() => {
		const map = new Map<string, string>();
		for (const role of [
			"\\Inbox",
			"\\Sent",
			"\\Drafts",
			"\\Archive",
			"\\Junk",
			"\\Trash",
		] as const) {
			const found = folders?.find((f) => f.specialUse === role);
			if (found) map.set(role, found.path);
		}
		return map;
	}, [folders]);

	const others = React.useMemo(() => {
		if (!folders) return [];
		const special = new Set(specialPaths.values());
		return folders.filter(
			(f) => !special.has(f.path) && f.path.toUpperCase() !== "INBOX",
		);
	}, [folders, specialPaths]);

	const status = isError
		? { dot: "bg-critical", label: "Mailbox unreachable" }
		: isPending
			? { dot: "bg-ink-3", label: "Connecting to mailbox" }
			: { dot: "bg-ok", label: "Mailbox connected" };

	return (
		<aside
			className={cn(
				"flex h-full w-full flex-col bg-band text-sidebar-foreground",
				className,
			)}
		>
			{/* Brand + app nav live in the rail; this column is mail-only. */}
			<div className="flex h-16 shrink-0 items-center px-7">
				<h2 className="font-display text-[22px] leading-none tracking-[-0.01em]">Mail</h2>
			</div>

			<AutoScroll className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				<nav aria-label="Folders">
					<p className="readout px-3 pt-2 pb-2">Folders</p>

					{isPending && <FolderSkeleton />}

					{isError && (
						<p role="alert" className="px-3 py-2 text-xs leading-relaxed text-destructive">
							{error instanceof Error ? error.message : "Failed to load folders"}
						</p>
					)}

					{folders && (
						<ul className="space-y-0.5">
							{QUICK_FOLDERS.map((item) => {
								const path = specialPaths.get(item.role);
								if (!path && item.role !== "\\Inbox") return null;
								const active =
									path === folder ||
									(!path && folder === "INBOX" && item.role === "\\Inbox");
								const resolved = path ?? "INBOX";
								const Icon = item.icon;
								return (
									<li key={item.role}>
										<button
											type="button"
											onClick={() => onSelectFolder(resolved)}
											aria-current={active ? "true" : undefined}
											className={itemClass(active)}
										>
											{active && <ActivePill layoutId={pillId} />}
											<Icon aria-hidden className="size-4 shrink-0" />
											<span className="flex-1 truncate text-left">{item.label}</span>
											<FolderCount folder={findFolder(folders, item.role, path)} active={active} />
										</button>
									</li>
								);
							})}
						</ul>
					)}

					{others.length > 0 && (
						<>
							<p className="readout px-3 pt-6 pb-2">Labels</p>
							<ul className="space-y-0.5">
								{others.map((f) => {
									const active = f.path === folder;
									const LabelIcon = LABEL_ICONS[f.name.toLowerCase()];
									return (
										<li key={f.path}>
											<button
												type="button"
												onClick={() => onSelectFolder(f.path)}
												title={f.path}
												aria-current={active ? "true" : undefined}
												className={itemClass(active)}
											>
												{active && <ActivePill layoutId={pillId} />}
												{LabelIcon ? (
													<LabelIcon aria-hidden className="size-4 shrink-0" />
												) : (
													<span aria-hidden className="grid size-4 shrink-0 place-items-center">
														<span
															className={cn(
																"size-1.5 rounded-full",
																active ? "bg-sidebar-primary-foreground" : "bg-ink-3 group-hover:bg-signal",
															)}
														/>
													</span>
												)}
												<span className="flex-1 truncate text-left">{f.name}</span>
												<FolderCount folder={f} active={active} />
											</button>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</nav>
			</AutoScroll>

			<div className="mx-4 mb-4 flex items-center gap-3 border-t border-border px-3 pt-4 dark:border-glass-border">
				<span className={cn("size-2 shrink-0 rounded-full", status.dot)} title={status.label} />
				<span className="sr-only">{status.label}.</span>
				<div className="min-w-0 leading-tight">
					<p className="truncate text-[12.5px] text-foreground">{account.email}</p>
					<p className="readout mt-1 truncate">{account.provider}</p>
				</div>
			</div>
		</aside>
	);
}
