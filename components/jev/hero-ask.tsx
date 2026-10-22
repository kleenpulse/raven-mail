"use client";

import * as React from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useAskStore } from "@/components/jev/ask-store";
import type { DecisionEngine } from "@/lib/jev/client";
import { cn } from "@/lib/utils";
import { TOUR_TARGET, tourAttr } from "@/components/tour/anchors";

/**
 * The reference's "Hey, Need help? / Just ask me anything!" — the second line
 * is the actual prompt input; suggestions type themselves while it's idle.
 */
export function HeroAsk({
	firstName,
	suggestions,
	engine,
	onAsk,
}: {
	firstName: string;
	suggestions: string[];
	/** Which engine answers Ask; null means keyword rules only. */
	engine: DecisionEngine | null;
	onAsk: (question: string) => void;
}) {
	const inputRef = React.useRef<HTMLInputElement>(null);
	const formRef = React.useRef<HTMLFormElement>(null);
	const [value, setValue] = React.useState("");
	const [focused, setFocused] = React.useState(false);
	const name = engine === "kage" ? "Kage" : "Jev";
	const typed = useTypewriter([`Just ask ${name} anything!`, ...suggestions], { paused: focused || value.length > 0 });
	const setHeroVisible = useAskStore((s) => s.setHeroVisible);

	// While the hero prompt is on screen, the floating "Ask Jev" pill stays out of the way.
	React.useEffect(() => {
		const el = formRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(([entry]) => setHeroVisible(Boolean(entry?.isIntersecting)), {
			threshold: 0.2,
		});
		observer.observe(el);
		return () => {
			observer.disconnect();
			setHeroVisible(false);
		};
	}, [setHeroVisible]);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const question = value.trim();
		if (!question) return;
		onAsk(question);
		setValue("");
	}

	return (
		<form ref={formRef} onSubmit={submit} {...tourAttr(TOUR_TARGET.heroAsk)} className="flex min-w-0 flex-1 items-center gap-5">
			<div className="min-w-0 flex-1">
				<p className="font-display text-[clamp(1.9rem,3.2vw,2.75rem)] leading-[1.04] tracking-[-0.025em] text-foreground">
					Hey {firstName}, need help?{" "}
					<span aria-hidden className="inline-block origin-[70%_70%] animate-[wave_1.6s_ease-in-out_1_600ms]">
						👋
					</span>
				</p>
				{/* The typed placeholder is nowrap; long suggestions would widen the page. */}
				<div className="relative mt-1 overflow-hidden">
					<input
						ref={inputRef}
						id="hero-ask"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						aria-label={`Ask ${name} about your inbox`}
						autoComplete="off"
						className="peer w-full bg-transparent font-display text-[clamp(1.9rem,3.2vw,2.75rem)] leading-[1.12] tracking-[-0.025em] text-foreground caret-signal outline-none"
					/>
					{!value && (
						<span
							aria-hidden
							className="pointer-events-none absolute inset-y-0 left-0 flex items-center font-display text-[clamp(1.9rem,3.2vw,2.75rem)] leading-[1.12] tracking-[-0.025em] whitespace-nowrap text-ink-3"
						>
							{typed}
						</span>
					)}
				</div>
			</div>

			<button
				type="submit"
				aria-label={value ? `Ask ${name}` :engine === "jev" ? "Jev is live" : engine === "kage" ? "Kage is live" : "Jev runs in heuristic mode"}
				title={engine === "jev" ? "Jev · live" : engine === "kage" ? "Kage · built-in engine, no key needed" : "Jev · heuristic mode (no API key)"}
				className={cn(
					"group relative hidden size-[88px] shrink-0 place-items-center rounded-full bg-sheet ring-1 ring-border transition-[transform,box-shadow] duration-300 sm:grid",
					"hover:shadow-lift active:scale-95 dark:bg-card-nested dark:ring-glass-border dark:hover:shadow-glow",
				)}
			>
				{value ? (
					<ArrowUp className="size-6 text-signal-ink dark:text-signal" />
				) : (
					<Sparkles className="[&>path:first-child]:fill-current size-6 text-foreground transition-transform duration-500 group-hover:rotate-12" />
				)}
				<span
					className={cn(
						"absolute top-3.5 right-3.5 size-2.5 rounded-full ring-2 ring-sheet dark:ring-transparent",
						engine ? "bg-ok" : "bg-ink-3",
					)}
				/>
			</button>
		</form>
	);
}
