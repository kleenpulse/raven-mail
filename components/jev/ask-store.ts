"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AskAnswer, AskStage, Intent } from "@/lib/jev/ask/types";

export type AskTurn = {
	id: string;
	question: string;
	forcedIntent?: Intent;
	status: "running" | "done" | "error";
	stages: { stage: AskStage; detail: string }[];
	answer?: AskAnswer;
	error?: string;
	feedback?: "up" | "down";
	at: number;
};

type AskState = {
	open: boolean;
	turns: AskTurn[];
	/** Bumped to ask the tray input to take focus (⌘K, rail button). */
	focusNonce: number;
	/** The Overview hero prompt is on screen — the collapsed tray pill hides. */
	heroVisible: boolean;
	setOpen: (open: boolean) => void;
	requestFocus: () => void;
	setHeroVisible: (visible: boolean) => void;
	start: (turn: AskTurn) => void;
	update: (id: string, patch: Partial<AskTurn>) => void;
	pushStage: (id: string, stage: AskStage, detail: string) => void;
	setFeedback: (id: string, feedback: "up" | "down") => void;
	clear: () => void;
};

const MAX_TURNS = 30;

/**
 * Tab-scoped (sessionStorage): answers quote senders and subjects, which
 * shouldn't linger on a shared machine after the tab closes.
 */
export const useAskStore = create<AskState>()(
	persist(
		(set) => ({
			open: false,
			turns: [],
			focusNonce: 0,
			heroVisible: false,
			setOpen: (open) => set({ open }),
			requestFocus: () => set((s) => ({ open: true, focusNonce: s.focusNonce + 1 })),
			setHeroVisible: (heroVisible) => set({ heroVisible }),
			start: (turn) => set((s) => ({ open: true, turns: [...s.turns, turn].slice(-MAX_TURNS) })),
			update: (id, patch) =>
				set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
			pushStage: (id, stage, detail) =>
				set((s) => ({
					turns: s.turns.map((t) => {
						if (t.id !== id) return t;
						const others = t.stages.filter((x) => x.stage !== stage);
						return { ...t, stages: [...others, { stage, detail }] };
					}),
				})),
			setFeedback: (id, feedback) =>
				set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, feedback } : t)) })),
			clear: () => set({ turns: [] }),
		}),
		{
			name: "raven-ask",
			storage: createJSONStorage(() => sessionStorage),
			partialize: (s) => ({
				// A reload mid-stream can't resume; don't restore spinners.
				turns: s.turns.map((t) =>
					t.status === "running" ? { ...t, status: "error" as const, error: "Interrupted — ask again." } : t,
				),
			}),
		},
	),
);
