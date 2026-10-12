"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComposeDraft } from "@/lib/mail/types";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

type ComposeState = {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  mode: ComposeMode;
  draft: ComposeDraft;
  openCompose: (mode?: ComposeMode, draft?: Partial<ComposeDraft>) => void;
  closeCompose: () => void;
  minimize: () => void;
  restore: () => void;
  toggleMaximize: () => void;
  setDraft: (patch: Partial<ComposeDraft>) => void;
  resetDraft: () => void;
};

const emptyDraft = (): ComposeDraft => ({
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  text: "",
});

export const useComposeStore = create<ComposeState>()(
  persist(
    (set, get) => ({
      open: false,
      minimized: false,
      maximized: false,
      mode: "new",
      draft: emptyDraft(),
      openCompose: (mode = "new", draft) =>
        set({
          open: true,
          minimized: false,
          mode,
          draft: { ...emptyDraft(), ...draft },
        }),
      closeCompose: () => set({ open: false, minimized: false, maximized: false, draft: emptyDraft() }),
      minimize: () => set({ minimized: true }),
      restore: () => set({ minimized: false }),
      toggleMaximize: () => set({ maximized: !get().maximized }),
      setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
      resetDraft: () => set({ draft: emptyDraft() }),
    }),
    {
      name: "em-compose",
      partialize: (state) => ({
        draft: state.draft,
        open: state.open && !state.minimized ? false : state.open,
        minimized: state.minimized,
        mode: state.mode,
        maximized: false,
      }),
    },
  ),
);
