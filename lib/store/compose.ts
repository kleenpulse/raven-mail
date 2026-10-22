"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComposeDraft } from "@/lib/mail/types";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export type ComposeAttachment = NonNullable<ComposeDraft["attachments"]>[number] & { size: number };

type OpenOptions = {
  /** The Drafts copy this compose replaces on save and removes on send or discard. */
  draftUid?: string;
  /** Files are still being fetched (a reopened draft); saving or sending now would drop them. */
  attachmentsLoading?: boolean;
};

type ComposeState = {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  mode: ComposeMode;
  draft: ComposeDraft;
  draftUid?: string;
  attachments: ComposeAttachment[];
  attachmentsLoading: boolean;
  openCompose: (mode?: ComposeMode, draft?: Partial<ComposeDraft>, options?: OpenOptions) => void;
  closeCompose: () => void;
  minimize: () => void;
  restore: () => void;
  toggleMaximize: () => void;
  setDraft: (patch: Partial<ComposeDraft>) => void;
  setDraftUid: (uid: string | undefined) => void;
  addAttachments: (files: ComposeAttachment[]) => void;
  removeAttachment: (index: number) => void;
  setAttachmentsLoading: (loading: boolean) => void;
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
      draftUid: undefined,
      attachments: [],
      attachmentsLoading: false,
      openCompose: (mode = "new", draft, options = {}) =>
        set({
          open: true,
          minimized: false,
          mode,
          draft: { ...emptyDraft(), ...draft },
          draftUid: options.draftUid,
          attachments: [],
          attachmentsLoading: options.attachmentsLoading ?? false,
        }),
      closeCompose: () =>
        set({
          open: false,
          minimized: false,
          maximized: false,
          draft: emptyDraft(),
          draftUid: undefined,
          attachments: [],
          attachmentsLoading: false,
        }),
      minimize: () => set({ minimized: true }),
      restore: () => set({ minimized: false }),
      toggleMaximize: () => set({ maximized: !get().maximized }),
      setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
      setDraftUid: (draftUid) => set({ draftUid }),
      addAttachments: (files) => set({ attachments: [...get().attachments, ...files] }),
      removeAttachment: (index) => set({ attachments: get().attachments.filter((_, i) => i !== index) }),
      setAttachmentsLoading: (attachmentsLoading) => set({ attachmentsLoading }),
      resetDraft: () => set({ draft: emptyDraft() }),
    }),
    {
      name: "em-compose",
      // Attachments stay in memory: base64 files would blow the localStorage quota. So
      // with files attached, a reload forgets draftUid too: the next save then adds a
      // copy instead of replacing the server one, which still has the files.
      partialize: (state) => ({
        draft: state.draft,
        draftUid: state.attachments.length || state.attachmentsLoading ? undefined : state.draftUid,
        open: state.open && !state.minimized ? false : state.open,
        minimized: state.minimized,
        mode: state.mode,
        maximized: false,
      }),
    },
  ),
);
