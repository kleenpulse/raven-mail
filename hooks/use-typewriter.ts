"use client";

import * as React from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/** Types, holds, erases, cycles. Freezes on the current phrase while `paused`. */
export function useTypewriter(
	phrases: string[],
	{ paused = false, typeMs = 42, eraseMs = 22, holdMs = 1900 }: {
		paused?: boolean;
		typeMs?: number;
		eraseMs?: number;
		holdMs?: number;
	} = {},
): string {
	const reduced = useReducedMotion();
	const [index, setIndex] = React.useState(0);
	const [length, setLength] = React.useState(0);
	const [erasing, setErasing] = React.useState(false);
	const phrase = phrases[index % Math.max(1, phrases.length)] ?? "";

	React.useEffect(() => {
		if (reduced || paused || phrases.length === 0) return;
		let delay = erasing ? eraseMs : typeMs;
		if (!erasing && length === phrase.length) delay = holdMs;
		if (erasing && length === 0) delay = 320;
		const timer = setTimeout(() => {
			if (!erasing && length < phrase.length) setLength(length + 1);
			else if (!erasing) setErasing(true);
			else if (length > 0) setLength(length - 1);
			else {
				setErasing(false);
				setIndex((i) => (i + 1) % phrases.length);
			}
		}, delay);
		return () => clearTimeout(timer);
	}, [reduced, paused, erasing, length, phrase, phrases.length, typeMs, eraseMs, holdMs]);

	if (reduced) return phrases[0] ?? "";
	return phrase.slice(0, length);
}
