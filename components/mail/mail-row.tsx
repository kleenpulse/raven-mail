"use client";

import { Paperclip, Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SignalBar, useMessageTriage } from "@/components/mail/triage";
import { formatListDate, initials } from "@/lib/format";
import type { MailSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

// A stable tint per sender, so a repeat sender is recognizable before the name is read.
// The signal hue (coral / gold) is left out: it's reserved for unread, active and starred.
const SENDER_TONES = [
	"bg-foreground/[0.06] dark:bg-signal-2/15 dark:text-signal-2",
	"bg-orb-4/25 dark:bg-orb-2/20 dark:text-orb-2",
	"bg-sheet ring-1 ring-border dark:bg-orb-4/15 dark:text-orb-4 dark:ring-0",
	"bg-orb-3/30 dark:bg-orb-3/15 dark:text-orb-3",
] as const;

function senderTone(key: string): string {
	let hash = 0;
	for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
	return SENDER_TONES[Math.abs(hash) % SENDER_TONES.length]!;
}

export function SenderAvatar({
	name,
	address,
	className,
}: {
	name?: string;
	address: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"grid size-9 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold tracking-wide text-foreground",
				senderTone(address.toLowerCase() || name || ""),
				className,
			)}
		>
			{initials(name, address)}
		</span>
	);
}

/**
 * A message card. The whole card opens the message through one stretched
 * button; the checkbox and star sit above it as siblings, so no control is
 * nested inside another. `@3xl/list` (a wide list pane) collapses the card
 * to a single line.
 */
export function MailRow({
	message,
	thread,
	active,
	selected,
	onSelectRow,
	onToggleSelect,
	onToggleStar,
}: {
	message: MailSummary;
	/** A conversation row: who took part (oldest first) and how many messages are loaded. */
	thread?: { people: string[]; count: number };
	active: boolean;
	selected: boolean;
	onSelectRow: (uid: string) => void;
	onToggleSelect: (uid: string, next: boolean) => void;
	onToggleStar: (message: MailSummary) => void;
}) {
	const triage = useMessageTriage(
		{ subject: message.subject, snippet: message.preview, from: message.from.address },
		{ folder: message.folder, uid: message.uid },
	);

	const unread = !message.flags.seen;
	const starred = message.flags.flagged;
	const sender = message.from.name || message.from.address || "(unknown)";
	// First names keep a three-way conversation readable in a narrow list.
	const people = thread ? thread.people.map((p) => (p.includes("@") ? p : p.split(" ")[0])).join(", ") : sender;

	return (
		<div
			data-uid={message.uid}
			className={cn(
				// Vertical rhythm follows the Mail Density setting (globals.css --row-py*).
				"group/row relative flex scroll-my-3 items-center gap-3 rounded-[20px] px-3 py-(--row-py) transition-[background-color,box-shadow] duration-200",
				"@3xl/list:gap-4 @3xl/list:py-(--row-py-wide) @3xl/list:pr-2",
				active
					? "bg-signal-soft ring-1 ring-signal/30 dark:ring-signal/45"
					: selected
						? "bg-card-nested ring-1 ring-foreground/20"
						: "bg-card hover:z-1 hover:bg-card-nested hover:shadow-lift dark:ring-1 dark:ring-glass-border",
			)}
		>
			{/* Avatar yields to the checkbox on hover, keyboard focus, or while a selection is in progress. */}
			<div className="relative grid size-9 shrink-0 place-items-center">
				<SenderAvatar
					name={message.from.name}
					address={message.from.address}
					className={cn(
						"transition-opacity duration-150 group-hover/row:opacity-0 group-has-focus-visible/row:opacity-0 group-data-[selecting=true]/list:opacity-0",
						selected && "opacity-0",
					)}
				/>
				<Checkbox
					checked={selected}
					onCheckedChange={(next) => onToggleSelect(message.uid, Boolean(next))}
					aria-label={thread ? `Select conversation with ${people}` : `Select message from ${sender}`}
					className={cn(
						"absolute inset-0 z-10 m-auto opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 group-data-[selecting=true]/list:opacity-100",
						selected && "opacity-100",
					)}
				/>
			</div>

			<button
				type="button"
				onClick={() => onSelectRow(message.uid)}
				aria-current={active ? "true" : undefined}
				className={cn(
					"grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left outline-none",
					"after:absolute after:inset-0 after:rounded-[20px] focus-visible:after:ring-2 focus-visible:after:ring-ring",
					"@3xl/list:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] @3xl/list:gap-x-5",
				)}
			>
				<span className="flex min-w-0 items-center gap-2">
					{unread && <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal" />}
					<span
						className={cn(
							"truncate text-[14px] leading-5",
							unread ? "font-semibold text-foreground" : "font-medium text-foreground/80",
						)}
					>
						{unread && <span className="sr-only">Unread: </span>}
						{people}
					</span>
					{thread && (
						<span className="shrink-0 font-mono text-[11px] text-ink-2 tabular">
							{thread.count}
							<span className="sr-only"> messages</span>
						</span>
					)}
				</span>

				<span className="flex items-center gap-2 justify-self-end @3xl/list:col-start-3 @3xl/list:row-start-1">
					{message.hasAttachments && (
						<>
							<Paperclip aria-hidden className="size-3.5 text-ink-2" />
							<span className="sr-only">Has attachment.</span>
						</>
					)}
					<SignalBar urgency={triage.urgency} active={active} />
					<time
						dateTime={message.date}
						className={cn(
							"font-mono text-[11px] tracking-wide tabular",
							unread ? "text-foreground" : "text-ink-2",
						)}
					>
						{formatListDate(message.date)}
					</time>
				</span>

				<span className="col-span-2 mt-0.5 min-w-0 @3xl/list:col-span-1 @3xl/list:col-start-2 @3xl/list:row-start-1 @3xl/list:mt-0 @3xl/list:flex @3xl/list:items-baseline @3xl/list:gap-2.5">
					<span
						className={cn(
							"block truncate text-[13.5px] leading-5 @3xl/list:max-w-[60%] @3xl/list:shrink-0 @3xl/list:text-[14px]",
							unread ? "font-medium text-foreground" : "text-foreground/80",
						)}
					>
						{message.subject || "(no subject)"}
					</span>
					<span className="block truncate pr-7 text-[12.5px] leading-[18px] text-ink-2 @3xl/list:min-w-0 @3xl/list:flex-1 @3xl/list:pr-0 @3xl/list:text-[13px]">
						{message.preview || "—"}
					</span>
				</span>
			</button>

			<button
				type="button"
				onClick={() => onToggleStar(message)}
				aria-label="Star"
				aria-pressed={starred}
				className={cn(
					"absolute right-2 bottom-1.5 z-10 grid size-7 place-items-center rounded-full outline-none transition-[opacity,color,background-color] duration-150 hover:bg-foreground/5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
					"@3xl/list:relative @3xl/list:inset-auto @3xl/list:size-8",
					starred
						? active
							? "text-signal-ink dark:text-signal"
							: "text-signal"
						: "text-ink-2 opacity-0 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 hover:text-foreground pointer-coarse:opacity-100",
				)}
			>
				<Star className={cn("size-4", starred && "fill-current")} />
			</button>
		</div>
	);
}
