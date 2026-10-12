"use client";

// Adapted from Motion Garden — letters-pull. Spans (not divs) so it can live in a
// heading, letters grouped per word so lines wrap between words, and one
// screen-reader copy instead of a letter-by-letter read-out.

import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";

type LettersPullProps = {
	text: string;
	className?: string;
	/** Per-letter animation duration, in seconds. */
	duration?: number;
	/** Stagger between successive letters, in seconds. */
	delay?: number;
	/** Added to every letter's delay — chains a second line after the first. */
	startDelay?: number;
	/** Rise distance each letter travels, in px. */
	yValue?: number;
	/** Starting blur each letter sharpens from, in px. */
	blur?: number;
	/** Skip the entrance and render letters settled. */
	reducedMotion?: boolean;
};

export function LettersPull({
	text,
	className,
	duration = 0.5,
	delay = 0.035,
	startDelay = 0,
	yValue = 10,
	blur = 8,
	reducedMotion = false,
}: LettersPullProps) {
	const variants: Variants = {
		initial: { y: yValue, opacity: 0, filter: `blur(${blur}px)` },
		animate: (i: number) => ({
			y: 0,
			opacity: 1,
			filter: "blur(0px)",
			transition: { delay: startDelay + i * delay, duration, ease: [0.22, 0.61, 0.36, 1] as const },
		}),
	};

	const words = text.split(" ");
	const offsets = words.map((_, w) => words.slice(0, w).reduce((n, word) => n + word.length, 0));

	return (
		<span className={cn("inline", className)}>
			<span className="sr-only">{text}</span>
			<span aria-hidden>
				{words.map((word, w) => (
					<span key={w}>
						<span className="inline-block whitespace-nowrap">
							{Array.from(word).map((letter, l) => (
								<motion.span
									key={l}
									className="inline-block"
									variants={variants}
									initial={reducedMotion ? false : "initial"}
									animate="animate"
									custom={offsets[w]! + l}
								>
									{letter}
								</motion.span>
							))}
						</span>
						{w < words.length - 1 && " "}
					</span>
				))}
			</span>
		</span>
	);
}
