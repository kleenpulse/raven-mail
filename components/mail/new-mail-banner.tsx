"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { X } from "lucide-react";
import { SenderAvatar } from "@/components/mail/mail-row";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNewMail } from "@/hooks/use-new-mail";
import { usePref } from "@/lib/prefs/store";
import { useComposeStore } from "@/lib/store/compose";
import type { NotifyBannerPosition } from "@/lib/prefs/schema";
import type { MailSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

const DISMISS_MS = 8000;
const MAX_HELD = 50;

export type Dock = "none" | "pill" | "window";

/** Whether the new-mail banner is up; the follow-up banner waits its turn in the same corner. */
export const useNewMailShowing = create<{ showing: boolean }>(() => ({ showing: false }));

/**
 * Below md the banner spans the width above the tab bar; from md it sits in its
 * corner, clear of the nav rail. Bottom corners step around the compose dock,
 * which lives bottom-right (and its pill spans the width on phones).
 */
export function placement(position: NotifyBannerPosition, dock: Dock): string {
	const [v, h] = position.split("-") as ["top" | "bottom", "left" | "right"];
	if (v === "top") {
		return cn("top-3 md:top-6", h === "left" ? "md:right-auto md:left-[calc(84px+1.5rem)]" : "md:left-auto md:right-6");
	}
	return cn(
		dock === "pill" ? "bottom-[9.5rem]" : "bottom-[92px]",
		dock === "pill" && h === "right" ? "md:bottom-[5.25rem]" : "md:bottom-6",
		h === "left"
			? "md:right-auto md:left-[calc(84px+1.5rem)]"
			: dock === "window"
				? "md:left-auto md:right-[min(33rem,calc(100vw-23.5rem))]"
				: "md:left-auto md:right-6",
	);
}

function senderName(m: MailSummary) {
	return m.from.name || m.from.address;
}

/** Pops up when unread mail lands in the Inbox, anywhere in the app. */
export function NewMailBanner() {
	const router = useRouter();
	const position = usePref("notify.bannerPosition");
	const desktop = useMediaQuery("(min-width: 48rem)");
	const compose = useComposeStore((s) => (!s.open ? "closed" : s.minimized ? "pill" : s.maximized ? "max" : "window"));
	const [held, setHeld] = React.useState<MailSummary[]>([]);
	const [paused, setPaused] = React.useState(false);

	useNewMail((arrivals) => {
		setHeld((prev) => {
			const seen = new Set(arrivals.map((m) => m.uid));
			return [...arrivals, ...prev.filter((m) => !seen.has(m.uid))].slice(0, MAX_HELD);
		});
	});

	// A full-screen draft would be covered: hold the news until it's out of the way.
	const covered = compose === "max" || (compose === "window" && !desktop);
	const dock: Dock = compose === "pill" ? "pill" : compose === "window" ? "window" : "none";
	const latest = held[0];
	const visible = Boolean(latest) && !covered;

	React.useEffect(() => {
		useNewMailShowing.setState({ showing: visible });
		return () => useNewMailShowing.setState({ showing: false });
	}, [visible]);

	React.useEffect(() => {
		if (!visible || paused) return;
		// A fresh arrival restarts the clock: `held` changes identity.
		const timer = window.setTimeout(() => setHeld([]), DISMISS_MS);
		return () => window.clearTimeout(timer);
	}, [visible, paused, held]);

	const dismiss = () => {
		setHeld([]);
		setPaused(false);
	};

	const go = (href: string) => {
		dismiss();
		router.push(href);
	};

	const top = position.startsWith("top");
	const more = held.length - 1;

	return (
		<>
			<p role="status" className="sr-only">
				{visible && latest
					? `${held.length > 1 ? `${held.length} new messages. Latest` : "New message"} from ${senderName(latest)}: ${latest.subject}`
					: ""}
			</p>
			<AnimatePresence>
				{visible && latest && (
					<motion.section
						key="new-mail"
						aria-label="New mail"
						initial={{ opacity: 0, y: top ? -12 : 12, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: top ? -8 : 8, transition: { duration: 0.16 } }}
						transition={{ type: "spring", stiffness: 420, damping: 34 }}
						onPointerEnter={() => setPaused(true)}
						onPointerLeave={() => setPaused(false)}
						onFocus={() => setPaused(true)}
						onBlur={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Escape") dismiss();
						}}
						className={cn(
							"fixed right-3 left-3 z-50 overflow-hidden rounded-card bg-sheet text-foreground shadow-lift ring-1 ring-border md:w-[22rem] dark:glass dark:ring-0",
							placement(position, dock),
						)}
					>
						{/* Nebula: tint inside the glass so the text holds up over the white email paper. */}
						<span aria-hidden className="pointer-events-none absolute inset-0 dark:bg-background/50" />
						<button
							type="button"
							onClick={() => go(`/mail?uid=${encodeURIComponent(latest.uid)}`)}
							className="relative flex w-full items-start gap-3 p-3.5 pr-11 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]"
						>
							<SenderAvatar name={latest.from.name} address={latest.from.address} />
							<span className="min-w-0 flex-1 leading-snug">
								<span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-2 uppercase">
									<span aria-hidden className="size-1.5 rounded-full bg-signal" />
									New mail
								</span>
								<span className="mt-1 block truncate text-sm font-semibold">{senderName(latest)}</span>
								<span className="block truncate text-sm">{latest.subject || "(no subject)"}</span>
								{latest.preview && (
									<span className="mt-0.5 block truncate text-xs text-ink-2">{latest.preview}</span>
								)}
							</span>
						</button>
						<button
							type="button"
							onClick={dismiss}
							aria-label="Dismiss"
							className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
						>
							<X />
						</button>
						{more > 0 && (
							<div className="relative flex items-center justify-between border-t border-border px-3.5 py-2 text-xs text-ink-2 dark:border-glass-border">
								<span>+{more} more</span>
								<button
									type="button"
									onClick={() => go("/mail")}
									className="rounded-pill px-2 py-1 font-medium text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
								>
									View inbox
								</button>
							</div>
						)}
					</motion.section>
				)}
			</AnimatePresence>
		</>
	);
}
