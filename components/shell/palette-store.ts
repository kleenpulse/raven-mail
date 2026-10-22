"use client";

import { create } from "zustand";
import type { MessageKeyAction } from "@/lib/keyboard";
import type { PaletteMessage } from "@/lib/palette/commands";

export type MessageCommands = PaletteMessage & { run: (action: MessageKeyAction) => void };

type PaletteState = {
	open: boolean;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	/** The open reader's actions; gone the moment it unmounts. */
	message: MessageCommands | null;
};

export const usePaletteStore = create<PaletteState>()((set) => ({
	open: false,
	setOpen: (open) => set({ open }),
	toggle: () => set((s) => ({ open: !s.open })),
	message: null,
}));

/** Returns the cleanup, which only clears if nothing newer registered since. */
export function registerMessageCommands(commands: MessageCommands): () => void {
	usePaletteStore.setState({ message: commands });
	return () => {
		if (usePaletteStore.getState().message === commands) usePaletteStore.setState({ message: null });
	};
}
