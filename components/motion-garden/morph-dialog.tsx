"use client";

// Adapted from Motion Garden's morph-dialog. Raven changes: app tokens, the shared
// useMounted / useReducedMotion hooks (the latter honors Settings → Reduce Motion),
// and Escape handled on the panel itself — React events bubble through portals, so a
// parent's onKeyDown (the Orbit's "Escape steps back") would otherwise eat it first.

import * as React from "react";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMounted } from "@/hooks/use-mounted";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Shared-layout "morph" dialog: a trigger carrying a stable `layoutId` and a
 * `<MorphPanel layoutId=…>` with the SAME id. When `open` flips true the panel
 * adopts the trigger's box and morphs into the centered panel; on close it morphs back.
 *
 * - The close morph animates the surviving trigger, which lives in the page tree —
 *   wrap it in `<MotionConfig transition={morphTransition(…)}>` with the panel's values.
 * - Keep the panel mounted (drive it with `open`); `{open && <MorphPanel/>}` kills the close morph.
 * - No `layoutId` (or reduced motion) → a plain centered fade + scale.
 */

/** The morph spring. Build it once from the same values in trigger and panel. */
export function morphTransition(stiffness = 320, damping = 34): Transition {
	return { type: "spring", stiffness, damping, mass: 0.8 };
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Another open modal (a nested overlay) owns Escape. */
function otherModalOpen(self: HTMLElement | null): boolean {
	return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((node) => node !== self);
}

export interface MorphPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Shared layout id — must match the trigger element's `layoutId`. */
	layoutId?: string;
	stiffness?: number;
	damping?: number;
	/** Panel corner radius in px (inline so motion interpolates it mid-morph). */
	radius?: number;
	blurBackdrop?: boolean;
	/** Focus the first focusable element on open. */
	autoFocus?: boolean;
	backdropClassName?: string;
	style?: React.CSSProperties;
	onAnimationComplete?: () => void;
	className?: string;
	children: React.ReactNode;
	reducedMotion?: boolean;
	role?: "dialog" | "alertdialog";
	"aria-label"?: string;
	"aria-describedby"?: string;
}

export function MorphPanel({
	open,
	onOpenChange,
	layoutId,
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
}: MorphPanelProps) {
	const mounted = useMounted();
	const containerRef = React.useRef<HTMLDivElement>(null);
	const openerRef = React.useRef<HTMLElement | null>(null);

	React.useEffect(() => {
		if (open) openerRef.current = document.activeElement as HTMLElement | null;
	}, [open]);

	// Focus outside the panel (e.g. on body) — the panel's own onKeyDown covers focus inside.
	React.useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (otherModalOpen(containerRef.current)) return;
				event.preventDefault();
				onOpenChange(false);
				return;
			}
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
	}, [open, onOpenChange]);

	React.useEffect(() => {
		if (!open) return;
		document.body.classList.add("overflow-hidden");
		if (autoFocus) containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
		return () => document.body.classList.remove("overflow-hidden");
	}, [open, autoFocus]);

	React.useEffect(() => {
		if (!open) openerRef.current?.focus?.();
	}, [open]);

	const transition = React.useMemo(() => morphTransition(stiffness, damping), [stiffness, damping]);

	if (!mounted) return null;

	const morph = !reducedMotion && Boolean(layoutId);
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
							key="morph-backdrop"
							className={cn(
								"fixed inset-0 z-40 h-full w-full",
								backdropClassName ?? cn("bg-black/20 dark:bg-black/50", blurBackdrop && "backdrop-blur-xs"),
							)}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							onClick={() => onOpenChange(false)}
						/>
						<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
							<motion.div
								ref={containerRef}
								layoutId={morph ? layoutId : undefined}
								initial={morph ? false : fade.initial}
								animate={morph ? undefined : fade.animate}
								exit={morph ? undefined : fade.exit}
								style={{ borderRadius: radius, ...style }}
								onAnimationComplete={onAnimationComplete}
								onKeyDown={onPanelKeyDown}
								role={role}
								aria-modal="true"
								aria-label={ariaLabel}
								aria-describedby={ariaDescribedby}
								className={cn("pointer-events-auto overflow-hidden", className)}
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

type MorphTag = "div" | "span" | "h2" | "h3" | "p";

export type MorphSharedProps<T extends MorphTag = "div"> = {
	as?: T;
	/** Shared layout id. When omitted (or `reducedMotion`), renders a plain tag. */
	layoutId?: string;
	reducedMotion?: boolean;
} & Omit<React.ComponentProps<T>, "ref">;

/** One element that travels between trigger and panel: render it in both with the same `layoutId`. */
export function MorphShared<T extends MorphTag = "div">({ as, layoutId, reducedMotion = false, children, ...rest }: MorphSharedProps<T>) {
	const tag = (as ?? "div") as MorphTag;
	// React 19's JSX checker collapses a union-typed ElementType's props to `never`.
	if (reducedMotion || !layoutId) {
		const Plain = tag as unknown as React.ComponentType<Record<string, unknown>>;
		return <Plain {...rest}>{children}</Plain>;
	}
	const MotionTag = motion[tag] as React.ComponentType<Record<string, unknown>>;
	return (
		<MotionTag layoutId={layoutId} {...rest}>
			{children}
		</MotionTag>
	);
}

export interface MorphDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	/** Accessible name when `title` isn't plain text. */
	label?: string;
	description?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
	/** Shared layout id — must match the trigger element's `layoutId`. */
	layoutId?: string;
	stiffness?: number;
	damping?: number;
	radius?: number;
	blurBackdrop?: boolean;
	autoFocus?: boolean;
	role?: "dialog" | "alertdialog";
}

/** Dialog chrome on `MorphPanel`: title/description/close header; content crossfades in as the box settles. */
export function MorphDialog({
	open,
	onOpenChange,
	title,
	label,
	description,
	children,
	className,
	layoutId,
	stiffness = 320,
	damping = 34,
	radius = 16,
	blurBackdrop = true,
	autoFocus = true,
	role = "dialog",
}: MorphDialogProps) {
	const reduce = useReducedMotion();
	const descId = React.useId();

	return (
		<MorphPanel
			open={open}
			onOpenChange={onOpenChange}
			layoutId={layoutId}
			stiffness={stiffness}
			damping={damping}
			radius={radius}
			blurBackdrop={blurBackdrop}
			autoFocus={autoFocus}
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
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="-mt-0.5 -mr-1.5 shrink-0 rounded-md p-1.5 text-ink-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
						aria-label="Close dialog"
					>
						<X className="size-4" />
					</button>
				</div>
				{children}
			</motion.div>
		</MorphPanel>
	);
}
