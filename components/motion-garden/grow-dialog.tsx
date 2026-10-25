"use client";

// Adapted from Motion Garden's grow-dialog. Raven changes: app tokens, the shared
// useMounted / useReducedMotion hooks (the latter honors Settings → Reduce Motion),
// an `actions` slot in the header, and Escape handled on the panel only. The shell
// closes the open mail on a window-level Escape; the panel's React onKeyDown stops
// it first, since React's root sits below window. A document listener here would
// fire too late to stop that, so the panel takes focus (tabIndex -1) instead.
// Backdrop and panel both sit at z-50, above the z-40 compose pane.

import * as React from "react";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMounted } from "@/hooks/use-mounted";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Grow-from-trigger dialog: pass the clicked element's `getBoundingClientRect()`
 * as `originRect` and the panel scales + translates from that rect to the centered
 * dialog, and shrinks back into it on close. The trigger never animates; it is only
 * a coordinate source.
 *
 * Omit `originRect` (or reduced motion) → a plain centered fade + scale.
 * Keep the panel mounted (drive it with `open`); `{open && <GrowPanel/>}` kills the exit.
 */

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Another open modal (a nested overlay) owns Escape. */
function otherModalOpen(self: HTMLElement | null): boolean {
	return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((node) => node !== self);
}

export interface GrowPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Grow the panel from this viewport rect (a trigger's getBoundingClientRect). */
	originRect?: DOMRect | null;
	/** The panel's max rendered width in px (match the `className` max-w-*). Only sizes the collapsed scale. */
	originMaxWidth?: number;
	stiffness?: number;
	damping?: number;
	/** Panel corner radius in px. */
	radius?: number;
	blurBackdrop?: boolean;
	/** Focus the first focusable element on open. Keep it on: Escape is only caught with focus inside. */
	autoFocus?: boolean;
	backdropClassName?: string;
	style?: React.CSSProperties;
	/** Fires when the panel's enter OR exit animation completes. */
	onAnimationComplete?: () => void;
	className?: string;
	children: React.ReactNode;
	reducedMotion?: boolean;
	role?: "dialog" | "alertdialog";
	"aria-label"?: string;
	"aria-describedby"?: string;
}

export function GrowPanel({
	open,
	onOpenChange,
	originRect,
	originMaxWidth,
	stiffness = 320,
	damping = 34,
	radius = 16,
	blurBackdrop = true,
	autoFocus = true,
	backdropClassName,
	style,
	onAnimationComplete,
	className,
	children,
	reducedMotion = false,
	role = "dialog",
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedby,
}: GrowPanelProps) {
	const mounted = useMounted();
	const containerRef = React.useRef<HTMLDivElement>(null);
	const openerRef = React.useRef<HTMLElement | null>(null);

	React.useEffect(() => {
		if (open) openerRef.current = document.activeElement as HTMLElement | null;
	}, [open]);

	// Focus trap only. Escape lives on the panel's onKeyDown (see the header note).
	React.useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const focusables = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
			if (!focusables || focusables.length === 0) return;
			const first = focusables[0]!;
			const last = focusables[focusables.length - 1]!;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	React.useEffect(() => {
		if (!open) return;
		document.body.classList.add("overflow-hidden");
		if (autoFocus) {
			const panel = containerRef.current;
			(panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel)?.focus();
		}
		return () => document.body.classList.remove("overflow-hidden");
	}, [open, autoFocus]);

	React.useEffect(() => {
		if (!open) openerRef.current?.focus?.();
	}, [open]);

	const transition = React.useMemo<Transition>(() => ({ type: "spring", stiffness, damping, mass: 0.8 }), [stiffness, damping]);

	// The open panel is centered, so its center IS the viewport center: only the
	// trigger's offset from center and a width-based scale are needed. The same
	// object drives `initial` and `exit`, so grow-in and shrink-out are symmetric.
	const growFrom = React.useMemo(() => {
		if (!originRect || reducedMotion || typeof window === "undefined") return null;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const panelW = Math.min(originMaxWidth ?? 448, vw - 32); // container p-4 = 16px/side
		const x = originRect.left + originRect.width / 2 - vw / 2;
		const y = originRect.top + originRect.height / 2 - vh / 2;
		const scale = Math.min(0.9, Math.max(0.1, originRect.width / panelW));
		return { opacity: 0, x, y, scale };
	}, [originRect, reducedMotion, originMaxWidth]);

	if (!mounted) return null;

	const fade = {
		initial: { opacity: 0, scale: 0.96 },
		animate: { opacity: 1, scale: 1 },
		exit: { opacity: 0, scale: 0.96 },
	};

	const onPanelKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== "Escape" || otherModalOpen(containerRef.current)) return;
		event.preventDefault();
		event.stopPropagation();
		onOpenChange(false);
	};

	return createPortal(
		<MotionConfig transition={reducedMotion ? { duration: 0 } : transition}>
			<AnimatePresence initial={false} mode="sync">
				{open && (
					<>
						<motion.div
							key="grow-backdrop"
							className={cn(
								"fixed inset-0 z-50 h-full w-full",
								backdropClassName ?? cn("bg-black/20 dark:bg-black/50", blurBackdrop && "backdrop-blur-xs"),
							)}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							onClick={() => onOpenChange(false)}
						/>
						<div
							key="grow-panel"
							className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
						>
							<motion.div
								ref={containerRef}
								tabIndex={-1}
								initial={growFrom ?? fade.initial}
								animate={growFrom ? { opacity: 1, x: 0, y: 0, scale: 1 } : fade.animate}
								exit={growFrom ?? fade.exit}
								style={{ borderRadius: radius, ...style }}
								onAnimationComplete={onAnimationComplete}
								onKeyDown={onPanelKeyDown}
								role={role}
								aria-modal="true"
								aria-label={ariaLabel}
								aria-describedby={ariaDescribedby}
								className={cn("pointer-events-auto overflow-hidden outline-none", className)}
							>
								{children}
							</motion.div>
						</div>
					</>
				)}
			</AnimatePresence>
		</MotionConfig>,
		document.body,
	);
}

export interface GrowDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	/** Accessible name when `title` isn't plain text. */
	label?: string;
	description?: React.ReactNode;
	/** Header buttons, left of the close button. */
	actions?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
	/** The clicked trigger's getBoundingClientRect — the grow origin. */
	originRect?: DOMRect | null;
	/** Panel's max rendered width in px (match the `className` max-w-*). */
	originMaxWidth?: number;
	stiffness?: number;
	damping?: number;
	radius?: number;
	blurBackdrop?: boolean;
	autoFocus?: boolean;
	onAnimationComplete?: () => void;
	role?: "dialog" | "alertdialog";
}

/** Dialog chrome on `GrowPanel`: title/description/actions/close header; content crossfades in as the box settles. */
export function GrowDialog({
	open,
	onOpenChange,
	title,
	label,
	description,
	actions,
	children,
	className,
	originRect,
	originMaxWidth,
	stiffness = 320,
	damping = 34,
	radius = 16,
	blurBackdrop = true,
	autoFocus = true,
	onAnimationComplete,
	role = "dialog",
}: GrowDialogProps) {
	const reduce = useReducedMotion();
	const descId = React.useId();

	return (
		<GrowPanel
			open={open}
			onOpenChange={onOpenChange}
			originRect={originRect}
			originMaxWidth={originMaxWidth}
			stiffness={stiffness}
			damping={damping}
			radius={radius}
			blurBackdrop={blurBackdrop}
			autoFocus={autoFocus}
			onAnimationComplete={onAnimationComplete}
			reducedMotion={reduce}
			role={role}
			aria-label={label ?? (typeof title === "string" ? title : undefined)}
			aria-describedby={description ? descId : undefined}
			className={cn(
				"flex max-h-[85svh] w-full max-w-sm flex-col bg-popover text-popover-foreground shadow-lift ring-1 ring-border dark:ring-glass-border",
				className,
			)}
		>
			<motion.div
				className="flex min-h-0 flex-1 flex-col"
				initial={reduce ? false : { opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={reduce ? undefined : { duration: 0.18, delay: 0.12 }}
			>
				<div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h2 className="font-display text-[17px] leading-snug break-words">{title}</h2>
						{description && (
							<p id={descId} className="text-[12.5px] leading-relaxed break-words text-ink-2">
								{description}
							</p>
						)}
					</div>
					<div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center gap-1">
						{actions}
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
							aria-label="Close dialog"
						>
							<X className="size-4" />
						</button>
					</div>
				</div>
				{children}
			</motion.div>
		</GrowPanel>
	);
}
