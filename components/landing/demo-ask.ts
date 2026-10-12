"use client";

import * as React from "react";
import { useLenis } from "lenis/react";
import { create } from "zustand";
import type { AskOptions } from "@/components/jev/use-ask";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import type { Intent } from "@/lib/jev/ask/types";

/** Board cards → the Ask section: which demo answer to replay next. */
export const useDemoAsk = create<{
	request: { intent: Intent; nonce: number } | null;
	ask: (intent: Intent) => void;
}>()((set) => ({
	request: null,
	ask: (intent) => set((s) => ({ request: { intent, nonce: (s.request?.nonce ?? 0) + 1 } })),
}));

/** Chips carry their intent; typed questions go through the same free keyword planner the app uses. */
export function intentOf(question: string, options?: AskOptions): Intent {
	return options?.forcedIntent ?? heuristicPlan(question, []).intent;
}

/** Smooth-scroll to a landing section: through Lenis when it runs, natively otherwise. */
export function useScrollToSection() {
	const lenis = useLenis();
	const reduced = useReducedMotion();
	return React.useCallback(
		(id: string) => {
			const el = document.getElementById(id);
			if (!el) return;
			if (lenis) lenis.scrollTo(el, { duration: 1.2 });
			else el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
		},
		[lenis, reduced],
	);
}

/** What the demo board's cards call instead of the app's Ask tray. */
export function useAskFromBoard() {
	const scrollTo = useScrollToSection();
	return React.useCallback(
		(question: string, options?: AskOptions) => {
			useDemoAsk.getState().ask(intentOf(question, options));
			scrollTo("ask");
		},
		[scrollTo],
	);
}
