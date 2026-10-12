import { cn } from "@/lib/utils";

/** The raven glyph (24-unit box); the eye is a separate dot at 15.4, 9.1. */
export const RAVEN_GLYPH = "M5.5 16.5c2.4-6.1 6.4-9.4 12.5-10-2.3 1.6-3.6 3.6-4 6.1 2.1-.9 3.9-.9 5.5-.1-3.4.6-6.2 2.2-8.3 4.8";

/**
 * Brand disc — Ember: ink disc like the reference's "№" mark; Nebula: a gold
 * ring that catches the light. The signal dot is the raven's eye.
 */
export function RavenMark({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-inverse text-inverse-foreground",
				"dark:bg-transparent dark:text-signal dark:ring-1 dark:ring-signal/60 dark:shadow-glow",
				className,
			)}
		>
			<svg viewBox="0 0 24 24" className="size-[22px]" fill="none">
				<path
					d={RAVEN_GLYPH}
					stroke="currentColor"
					strokeWidth="1.9"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<circle cx="15.4" cy="9.1" r="1.25" className="fill-signal" />
			</svg>
		</span>
	);
}
