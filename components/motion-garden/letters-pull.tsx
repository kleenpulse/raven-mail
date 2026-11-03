// Adapted from Motion Garden — letters-pull. Spans (not divs) so it can live in a
// heading, letters grouped per word so lines wrap between words.
//
// A CSS animation, not motion: the letters paint with the server HTML instead of
// waiting for hydration (the hero heading is the landing's LCP element), and the
// text appears once in the DOM, so crawlers read the heading as written.
// The letters are aria-hidden so screen readers don't spell them out: give the
// parent the accessible name, e.g. `<h1 aria-label="…">`.

import type { CSSProperties } from "react";
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
	const words = text.split(" ");
	const offsets = words.map((_, w) => words.slice(0, w).reduce((n, word) => n + word.length, 0));

	return (
		<span aria-hidden className={cn("inline", className)}>
			{words.map((word, w) => (
				<span key={w}>
					<span className="inline-block whitespace-nowrap">
						{Array.from(word).map((letter, l) => (
							<span
								key={l}
								className={cn("inline-block", !reducedMotion && "letter-pull")}
								style={
									{
										"--pull-y": `${yValue}px`,
										"--pull-blur": `${blur}px`,
										animationDuration: `${duration}s`,
										animationDelay: `${startDelay + (offsets[w]! + l) * delay}s`,
									} as CSSProperties
								}
							>
								{letter}
							</span>
						))}
					</span>
					{w < words.length - 1 && " "}
				</span>
			))}
		</span>
	);
}
