"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, X } from "lucide-react";
import { placement, useNewMailShowing, type Dock } from "@/components/mail/new-mail-banner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useDueFollowUps, useFollowUpActions } from "@/hooks/use-follow-ups";
import { usePref } from "@/lib/prefs/store";
import { useComposeStore } from "@/lib/store/compose";
import { followUpHref } from "@/lib/follow-ups/links";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const action =
	"rounded-pill px-2.5 py-1 font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A reminder whose time has come with no reply, in the new-mail banner's
 * corner and style. It waits while the new-mail banner is up, and stays until
 * acted on or dismissed (dismissed ones come back on the next visit).
 */
export function FollowUpBanner() {
	const position = usePref("notify.bannerPosition");
	const desktop = useMediaQuery("(min-width: 48rem)");
	const compose = useComposeStore((s) => (!s.open ? "closed" : s.minimized ? "pill" : s.maximized ? "max" : "window"));
	const newMail = useNewMailShowing((s) => s.showing);
	const { due } = useDueFollowUps();
	const { done, snooze } = useFollowUpActions();
	const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(() => new Set());

	const waiting = due.filter((f) => !dismissed.has(f.id));
	const first = waiting[0];
	const covered = compose === "max" || (compose === "window" && !desktop);
	const dock: Dock = compose === "pill" ? "pill" : compose === "window" ? "window" : "none";
	const visible = Boolean(first) && !covered && !newMail;
	const top = position.startsWith("top");
	const more = waiting.length - 1;

	return (
		<>
			<p role="status" className="sr-only">
				{visible && first ? `Follow up: no reply from ${first.to || "them"} to ${first.subject || "your message"}` : ""}
			</p>
			<AnimatePresence>
				{visible && first && (
					<motion.section
						key="follow-up"
						aria-label="Follow up"
						initial={{ opacity: 0, y: top ? -12 : 12, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: top ? -8 : 8, transition: { duration: 0.16 } }}
						transition={{ type: "spring", stiffness: 420, damping: 34 }}
						onKeyDown={(e) => {
							if (e.key === "Escape") setDismissed((prev) => new Set(prev).add(first.id));
						}}
						className={cn(
							"fixed right-3 left-3 z-50 overflow-hidden rounded-card bg-sheet text-foreground shadow-lift ring-1 ring-border md:w-[22rem] dark:glass dark:ring-0",
							placement(position, dock),
						)}
					>
						{/* Nebula: tint inside the glass so the text holds up over the white email paper. */}
						<span aria-hidden className="pointer-events-none absolute inset-0 dark:bg-background/50" />
						<div className="relative flex items-start gap-3 p-3.5 pr-11">
							<span className="grid size-9 shrink-0 place-items-center rounded-full bg-signal-soft text-signal-ink dark:text-signal">
								<BellRing className="size-4" />
							</span>
							<span className="min-w-0 flex-1 leading-snug">
								<span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-2 uppercase">
									<span aria-hidden className="size-1.5 rounded-full bg-signal" />
									Follow up
								</span>
								<span className="mt-1 block truncate text-sm font-semibold">No reply from {first.to || "them"}</span>
								<span className="block truncate text-sm">{first.subject || "(no subject)"}</span>
								<span className="mt-0.5 block truncate text-xs text-ink-2">Due {formatRelative(first.dueAt)}</span>
							</span>
						</div>
						<button
							type="button"
							onClick={() => setDismissed((prev) => new Set(prev).add(first.id))}
							aria-label="Dismiss"
							className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
						>
							<X />
						</button>
						<div className="relative flex flex-wrap items-center gap-1 border-t border-border px-2.5 py-2 text-xs dark:border-glass-border">
							<button type="button" className={action} onClick={() => void done(first)}>
								Done
							</button>
							<button type="button" className={action} onClick={() => void snooze(first)}>
								Snooze 1 day
							</button>
							<Link href={followUpHref(first)} className={action}>
								Open thread
							</Link>
							{more > 0 && (
								<Link href="/overview#follow-ups" className={cn(action, "ml-auto text-ink-2")}>
									+{more} more
								</Link>
							)}
						</div>
					</motion.section>
				)}
			</AnimatePresence>
		</>
	);
}
