"use client";

import * as React from "react";
import { useLenis } from "lenis/react";
import { motion } from "motion/react";
import { Tip, TooltipGroup, TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

// Page order. Every id is a scroll target carrying its own scroll-margin-top.
const SECTIONS = [
	{ id: "top", label: "Top" },
	{ id: "orbit", label: "Orbit" },
	{ id: "overview", label: "Overview" },
	{ id: "ask", label: "Ask Jev" },
	{ id: "privacy", label: "Privacy" },
	{ id: "workflow", label: "Workflow" },
	{ id: "start", label: "Open the brief" },
];

const EASE = [0.22, 1, 0.36, 1] as const;
// A tick-rail has no place on touch, and below lg the gutter can't hold it.
const RAIL_MEDIA = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";
// A section is current once its top crosses this line. Deeper than the widest
// scroll-margin (orbit's 96px), so a jump never hands the tick straight back.
const ACTIVE_LINE = 120;
// Linger after scrolling stops / the pointer leaves before the ticks shrink.
const HOLD_MS = 600;
const JUMP = { duration: 1.4, easing: (t: number) => 1 - Math.pow(1 - t, 3) };
// Dot ↔ line morph: a soft ease-in-out, since a hard-start curve reads as a snap
// over ~28px. It ripples outward from the active tick.
const TICK_MS = 550;
const TICK_EASE = "cubic-bezier(0.45, 0.05, 0.2, 1)";
const TICK_STAGGER_MS = 25;

/** The last section whose top crossed the line; the final one once the page bottoms out. */
function activeAt(scroll: number, limit: number): string {
	if (scroll >= limit - 2) return SECTIONS[SECTIONS.length - 1].id;
	let current = SECTIONS[0].id;
	for (const s of SECTIONS) {
		const el = document.getElementById(s.id);
		if (el && el.getBoundingClientRect().top <= ACTIVE_LINE) current = s.id;
	}
	return current;
}

/**
 * Fixed column of ticks in the right gutter, one per section. Idle, every tick
 * is a dot; while the page scrolls or the pointer is on the rail they grow into
 * lines. Hover one for its label; click and Lenis glides there. Renders nothing on the server or first paint, so no hydration seam.
 */
export function SectionRail() {
	const isDesktop = useMediaQuery(RAIL_MEDIA);
	const [activeId, setActiveId] = React.useState(SECTIONS[0].id);
	const [expanded, setExpanded] = React.useState(false);

	// Inputs live in refs so per-frame scroll callbacks cost nothing when nothing
	// changed; `sync` folds them into the one rendered boolean.
	const hovering = React.useRef(false);
	const focusWithin = React.useRef(false);
	const scrolling = React.useRef(false);
	const hold = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastScroll = React.useRef<number | null>(null);

	const sync = () => setExpanded(hovering.current || focusWithin.current || scrolling.current);
	const clearHold = () => {
		if (hold.current) clearTimeout(hold.current);
		hold.current = null;
	};
	// One timer for both idle paths: it always ends scrolling; if the pointer is
	// still on the rail, `sync` keeps it open anyway.
	const armHold = () => {
		clearHold();
		hold.current = setTimeout(() => {
			hold.current = null;
			scrolling.current = false;
			sync();
		}, HOLD_MS);
	};
	React.useEffect(
		() => () => {
			if (hold.current) clearTimeout(hold.current);
		},
		[],
	);

	const lenis = useLenis((l) => {
		// Clamp ignores rubber-band overscroll.
		const scroll = Math.max(0, Math.min(l.scroll, l.limit));
		const prev = lastScroll.current;
		lastScroll.current = scroll;
		// useLenis also calls back on every registration (each render); that is not
		// a scroll, and a reload mid-page must not pop the rail open.
		if (prev !== null && scroll !== prev) {
			clearHold();
			if (!scrolling.current) {
				scrolling.current = true;
				sync();
			}
		}
		if (l.isScrolling === false && scrolling.current && !hold.current) armHold();
		setActiveId(activeAt(scroll, l.limit));
	});

	// Lenis doesn't emit on resize, but the line each section has to cross moves.
	React.useEffect(() => {
		if (!lenis) return;
		const onResize = () => setActiveId(activeAt(lenis.scroll, lenis.limit));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [lenis]);

	// Reduced motion: SmoothScroll renders nothing, so a rAF-throttled native
	// scroll listener drives the spy instead.
	React.useEffect(() => {
		if (lenis || !isDesktop) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const limit = document.documentElement.scrollHeight - window.innerHeight;
			setActiveId(activeAt(Math.max(0, Math.min(window.scrollY, limit)), limit));
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		schedule();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
		};
	}, [lenis, isDesktop]);

	const jumpTo = (id: string, e: React.MouseEvent<HTMLAnchorElement>) => {
		if (!lenis) return; // reduced motion → native anchor jump
		e.preventDefault();
		// Lenis's own anchor handler listens on window and ignores defaultPrevented;
		// letting the click reach it would restart the glide on its default curve.
		e.stopPropagation();
		lenis.scrollTo(id === SECTIONS[0].id ? 0 : `#${id}`, JUMP);
		history.pushState(null, "", `#${id}`);
	};

	if (!isDesktop) return null;

	const activeIndex = Math.max(
		0,
		SECTIONS.findIndex((s) => s.id === activeId),
	);

	return (
		// The wrapper never takes the pointer: at lg–xl widths the demo board runs
		// right up to the gutter, and a full-height hover strip would eat its clicks.
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.5, ease: EASE }}
			className="pointer-events-none fixed inset-y-0 right-1.5 z-40 hidden w-10 lg:flex items-center justify-end"
		>
			<TooltipProvider delay={0}>
				<nav
					aria-label="Sections"
					className="pointer-events-auto py-6 pr-0.5"
					onPointerEnter={() => {
						hovering.current = true;
						sync();
					}}
					onPointerLeave={() => {
						hovering.current = false;
						armHold();
					}}
					onFocusCapture={() => {
						focusWithin.current = true;
						sync();
					}}
					onBlurCapture={(e) => {
						if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
						focusWithin.current = false;
						armHold();
					}}
				>
					<TooltipGroup side="left" sideOffset={8}>
						<ol className="flex flex-col items-end gap-3">
							{SECTIONS.map((section, i) => (
								<li key={section.id}>
									<RailTick
										id={section.id}
										label={section.label}
										isActive={section.id === activeId}
										expanded={expanded}
										delay={Math.abs(i - activeIndex) * TICK_STAGGER_MS}
										onJump={jumpTo}
									/>
								</li>
							))}
						</ol>
					</TooltipGroup>
				</nav>
			</TooltipProvider>
		</motion.div>
	);
}

function RailTick({
	id,
	label,
	isActive,
	expanded,
	delay,
	onJump,
}: {
	id: string;
	label: string;
	isActive: boolean;
	expanded: boolean;
	delay: number;
	onJump: (id: string, e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
	return (
		<Tip
			label={label}
			side="left"
			sideOffset={8}
			className="group flex cursor-pointer items-center py-1.5 ps-6 outline-none"
			render={
				<a
					href={`#${id}`}
					aria-label={label}
					aria-current={isActive ? "true" : undefined}
					onClick={(e) => onJump(id, e)}
				/>
			}
			>
			<span
				aria-hidden
				// Only width morphs; height is fixed per state, so a dot grows sideways
				// into a line of the same weight instead of flattening on the way.
				style={{ transition: `width ${TICK_MS}ms ${TICK_EASE} ${delay}ms, background-color 300ms ease` }}
				className={cn(
					"block rounded-full",
					isActive
						? "h-1.5 bg-signal shadow-[0_0_8px_var(--signal)]"
						: "h-1 bg-ink-3 group-hover:bg-ink group-focus-visible:bg-ink",
					expanded
						? isActive
							? "w-7"
							: "w-4 group-hover:w-5 group-focus-visible:w-5"
						: isActive
							? "w-1.5"
							: "w-1",
				)}
			/>
		</Tip>
	);
}
