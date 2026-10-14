"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { Bento } from "@/components/overview/bento";
import { SendBriefMenu } from "@/components/integrations/deliver-menu";
import { useDeepTriage } from "@/hooks/use-deep-triage";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { mailLink } from "@/lib/jev/ask/format";
import type { BriefItem } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "raven-brief-dismissed";
const MAX_ITEMS = 5;
const AUTOPLAY_MS = 8000;
const SWIPE_PX = 40;

function readDismissed(dateKey: string): Set<string> {
	try {
		const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}") as { date?: string; ids?: string[] };
		return new Set(raw.date === dateKey ? raw.ids : []);
	} catch {
		return new Set();
	}
}

function subscribeVisibility(onChange: () => void) {
	document.addEventListener("visibilitychange", onChange);
	return () => document.removeEventListener("visibilitychange", onChange);
}

const slide = {
	enter: (dir: number) => ({ x: dir * 28, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (dir: number) => ({ x: dir * -28, opacity: 0 }),
};

const arrowButton =
	"grid size-8 place-items-center rounded-full text-ink-2 ring-1 ring-border outline-none transition-colors hover:bg-card-nested hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:ring-glass-border";

function BriefSlide({
	item,
	jevLive,
	deep,
}: {
	item: BriefItem;
	jevLive: boolean;
	deep: ReturnType<typeof useDeepTriage>;
}) {
	return (
		<>
			<p className="text-[12px] text-ink-2">
				Daily brief · {item.from.name}
				{item.source === "jev" && item.confidence !== undefined && (
					<span className="ml-1.5 rounded-pill bg-signal-soft px-1.5 py-0.5 font-mono text-[10px] text-signal-ink dark:text-signal">
						Jev {Math.round(item.confidence * 100)}%
					</span>
				)}
			</p>
			<p className="mt-1.5 line-clamp-2 font-display text-[19px] [overflow-wrap:anywhere] leading-snug tracking-[-0.01em]">{item.subject}</p>
			{item.preview && <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-2">{item.preview}</p>}
			<ul className="mt-3 flex flex-wrap gap-1.5">
				{item.why.map((w) => (
					<li key={w} className="rounded-pill bg-card-nested px-2.5 py-1 text-[11px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
						{w}
					</li>
				))}
			</ul>
			<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
				<Link
					href={mailLink(item)}
					className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-inverse px-4 text-[13px] text-inverse-foreground transition-transform active:scale-[0.98]"
				>
					Open
					<ArrowUpRight className="size-3.5" />
				</Link>
				{jevLive && (
					<button
						type="button"
						onClick={deep.run}
						disabled={deep.pending}
						className="inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-[12px] text-signal-ink ring-1 ring-signal/30 hover:bg-signal-soft disabled:opacity-60 dark:text-signal"
					>
						{deep.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="[&>path:first-child]:fill-current size-3.5" />}
						{deep.data ? "Re-triage" : "Deep triage"}
					</button>
				)}
			</div>
		</>
	);
}

/**
 * The reference's review carousel → today's short list. Heuristic by default;
 * "Deep triage" asks Jev to re-score the last 48h (paid, on demand).
 *
 * It plays itself gently (the active dot fills, then the next item slides in),
 * pauses while hovered, focused or in a background tab, and stops for good the
 * moment you navigate — arrows, dots, ← →, or a swipe. No autoplay with reduced motion.
 */
export function DailyBrief({
	items,
	todayKey,
	jevLive,
	demo = false,
	i = 0,
}: {
	items: BriefItem[];
	todayKey: string;
	jevLive: boolean;
	/** Landing demo: nowhere to send to, and dismissals must never touch a real list. */
	demo?: boolean;
	i?: number;
}) {
	const deep = useDeepTriage();
	const reducedMotion = useReducedMotion();
	const hidden = React.useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
	const [dismissed, setDismissed] = React.useState<Set<string>>(() =>
		demo || typeof window === "undefined" ? new Set() : readDismissed(todayKey),
	);
	const [index, setIndex] = React.useState(0);
	const [dir, setDir] = React.useState(1);
	const [autoplay, setAutoplay] = React.useState(true);
	const [hovered, setHovered] = React.useState(false);
	const [focused, setFocused] = React.useState(false);
	const swipeFrom = React.useRef<number | null>(null);

	const ranked = React.useMemo(() => {
		const withJev = items.map((item) => {
			const jev = deep.byRef.get(`${item.folder}:${item.uid}`);
			if (!jev || jev.source !== "jev") return item;
			const score = 0.5 * jev.urgency + 0.35 * (jev.needsReply ? 1 : 0) + 0.15 * item.score;
			return { ...item, score, urgency: jev.urgency, needsReply: jev.needsReply, source: "jev" as const, confidence: jev.confidence };
		});
		return withJev
			.filter((item) => !dismissed.has(`${item.folder}:${item.uid}`))
			.sort((a, b) => b.score - a.score)
			.slice(0, MAX_ITEMS);
	}, [items, deep.byRef, dismissed]);

	const total = ranked.length;
	const pos = total ? Math.min(index, total - 1) : 0;
	const current = ranked[pos];
	const playing = autoplay && !reducedMotion && total > 1;
	const running = playing && !hovered && !focused && !hidden;

	/** `step` +1/-1 moves (wrapping); a manual move ends autoplay. */
	function move(step: 1 | -1, manual = true) {
		if (total < 2) return;
		setDir(step);
		setIndex((pos + step + total) % total);
		if (manual) setAutoplay(false);
	}

	function jump(target: number) {
		if (target === pos) return;
		setDir(target > pos ? 1 : -1);
		setIndex(target);
		setAutoplay(false);
	}

	function dismiss(item: BriefItem) {
		const next = new Set(dismissed).add(`${item.folder}:${item.uid}`);
		setDismissed(next);
		setDir(1);
		setAutoplay(false);
		try {
			localStorage.setItem(DISMISS_KEY, JSON.stringify({ date: todayKey, ids: [...next] }));
		} catch {
			/* storage blocked */
		}
	}

	return (
		<Bento
			i={i}
			aria-roledescription="carousel"
			aria-label="Daily brief"
			className="flex min-h-[248px] flex-col"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocusCapture={() => setFocused(true)}
			onBlurCapture={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
			}}
			onKeyDown={(e) => {
				if (e.key === "ArrowRight") move(1);
				else if (e.key === "ArrowLeft") move(-1);
			}}
			onPointerDown={(e) => {
				if (e.pointerType !== "mouse") swipeFrom.current = e.clientX;
			}}
			onPointerUp={(e) => {
				const from = swipeFrom.current;
				swipeFrom.current = null;
				if (from === null) return;
				const dx = e.clientX - from;
				if (Math.abs(dx) >= SWIPE_PX) move(dx < 0 ? 1 : -1);
			}}
		>
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex items-center" role="tablist" aria-label="Brief items">
					{ranked.map((item, idx) => {
						const active = idx === pos;
						return (
							<button
								key={`${item.folder}:${item.uid}`}
								type="button"
								role="tab"
								aria-selected={active}
								aria-label={`Item ${idx + 1} of ${total}: ${item.subject}`}
								onClick={() => jump(idx)}
								className="group/dot grid h-6 place-items-center px-[3px] outline-none"
							>
								<span
									className={cn(
										"relative block h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-ring",
										active
											? cn("w-6", playing ? "bg-foreground/20" : "bg-foreground")
											: "w-1.5 bg-foreground/25 group-hover/dot:bg-foreground/50",
									)}
								>
									{active && playing && (
										<span
											key={pos}
											aria-hidden
											className="absolute inset-0 origin-left rounded-full bg-foreground"
											style={{
												animation: `brief-progress ${AUTOPLAY_MS}ms linear forwards`,
												animationPlayState: running ? "running" : "paused",
											}}
											onAnimationEnd={() => move(1, false)}
										/>
									)}
								</span>
							</button>
						);
					})}
				</div>
				{total > 1 && (
					<span className="font-mono text-[11px] text-ink-2 tabular" aria-hidden>
						{pos + 1}/{total}
					</span>
				)}
				<div className="ml-auto flex items-center gap-1.5">
					{!demo && <SendBriefMenu items={ranked} />}
					{total > 1 && (
						<>
							<button type="button" onClick={() => move(-1)} aria-label="Previous item" className={arrowButton}>
								<ChevronLeft className="size-4" />
							</button>
							<button type="button" onClick={() => move(1)} aria-label="Next item" className={arrowButton}>
								<ChevronRight className="size-4" />
							</button>
						</>
					)}
					{current && !demo && (
						<button
							type="button"
							onClick={() => dismiss(current)}
							aria-label="Dismiss for today"
							title="Dismiss for today"
							className="grid size-8 place-items-center rounded-full bg-card-nested text-ink-2 ring-1 ring-border hover:text-foreground dark:ring-glass-border"
						>
							<X className="size-3.5" />
						</button>
					)}
				</div>
			</div>

			{/*
			  Every item is laid out invisibly in the same grid cell, so the card always
			  takes the tallest one's height — sliding never resizes the card (or its row).
			  clip-path (not overflow) trims the slide-in with room left for button rings.
			  clip-path doesn't clip layout, so the column must never outgrow the card.
			*/}
			<div className="mt-4 grid flex-1 grid-cols-[minmax(0,1fr)] [clip-path:inset(-12px)]" aria-live={playing ? "off" : "polite"}>
				{ranked.map((item) => (
					<div
						key={`size:${item.folder}:${item.uid}`}
						aria-hidden
						inert
						className="invisible col-start-1 row-start-1 flex flex-col"
					>
						<BriefSlide item={item} jevLive={jevLive} deep={deep} />
					</div>
				))}
				<AnimatePresence mode="wait" initial={false} custom={dir}>
					{current ? (
						<motion.div
							key={`${current.folder}:${current.uid}`}
							custom={dir}
							variants={slide}
							initial="enter"
							animate="center"
							exit="exit"
							transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
							className="col-start-1 row-start-1 flex flex-col"
						>
							<BriefSlide item={current} jevLive={jevLive} deep={deep} />
						</motion.div>
					) : (
						<motion.div
							key="empty"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							className="col-start-1 row-start-1 flex flex-col justify-center"
						>
							<p className="font-display text-[19px] leading-snug">Nothing pressing.</p>
							<p className="mt-1 text-[12px] text-ink-2">No flagged, urgent, or waiting mail from the last 3 days.</p>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</Bento>
	);
}
