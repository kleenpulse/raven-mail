"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComposeDraft } from "@/lib/mail/types";
import { onlySignature, withSignature } from "@/lib/mail/signature";
import { getPref } from "@/lib/prefs/store";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export type ComposeAttachment = NonNullable<ComposeDraft["attachments"]>[number] & { size: number };

type OpenOptions = {
  /** The Drafts copy this compose replaces on save and removes on send or discard. */
  draftUid?: string;
  /** Files are still being fetched (a reopened draft); saving or sending now would drop them. */
  attachmentsLoading?: boolean;
  /** Add the user's signature (default). False for a draft being reopened as it was. */
  signature?: boolean;
  /** Files to start with (an undone send or discard putting a message back). */
  attachments?: ComposeAttachment[];
  /** Starts out unsaved: what it holds isn't on the server (an undone send or discard). */
  unsaved?: boolean;
  /** Runs once compose holds this message: at once, or after the user agrees to replace unsaved changes. */
  onOpen?: () => void;
  /** Replace what's open even if it has unsaved changes (the user already chose to). */
  force?: boolean;
};

/** An open held back because compose has unsaved changes; the user picks what happens. */
export type PendingOpen = {
  mode: ComposeMode;
  draft?: Partial<ComposeDraft>;
  options: OpenOptions;
  /** Where the request came from (the focused control), for the dialog to grow out of. */
  origin: DOMRect | null;
};

type EditOptions = {
  /** False for writes that only load or tidy what's there, not the user's own changes. */
  edit?: boolean;
};

type ComposeState = {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  mode: ComposeMode;
  draft: ComposeDraft;
  draftUid?: string;
  /**
   * The Drafts row this compose was opened from, so the list can mark it and a
   * second click doesn't reload it. Follows a save to the new copy, but stays
   * when draftUid lets go of the server copy (files that couldn't load).
   */
  draftRow?: string;
  attachments: ComposeAttachment[];
  attachmentsLoading: boolean;
  /** Bumped by every openCompose, so the editor starts over instead of keeping the last message. */
  session: number;
  /** Counts the user's changes; `savedEdits` is the count the last save to Drafts covered. */
  edits: number;
  savedEdits: number;
  pendingOpen: PendingOpen | null;
  /** False when held back as `pendingOpen` to protect unsaved changes. */
  openCompose: (mode?: ComposeMode, draft?: Partial<ComposeDraft>, options?: OpenOptions) => boolean;
  /** The user's answer to `pendingOpen`: open it (replacing what's there) or keep what's open. */
  answerPending: (open: boolean) => void;
  closeCompose: () => void;
  minimize: () => void;
  restore: () => void;
  toggleMaximize: () => void;
  setDraft: (patch: Partial<ComposeDraft>, options?: EditOptions) => void;
  setDraftUid: (uid: string | undefined) => void;
  /** A save to Drafts covered every change up to `edits` (read before the save started). */
  markSaved: (edits: number) => void;
  addAttachments: (files: ComposeAttachment[], options?: EditOptions) => void;
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

/** Compose holds changes the user made that no save to Drafts has covered, and they aren't empty. */
export function hasUnsavedChanges(state: Pick<ComposeState, "open" | "edits" | "savedEdits" | "draft" | "attachments">): boolean {
  if (!state.open || state.edits <= state.savedEdits) return false;
  const { to, cc, bcc, subject, text } = state.draft;
  const body = text.trim() && !onlySignature(text);
  return Boolean(to.trim() || cc?.trim() || bcc?.trim() || subject.trim() || body || state.attachments.length);
}

export const useComposeStore = create<ComposeState>()(
  persist(
    (set, get) => ({
      open: false,
      minimized: false,
      maximized: false,
      mode: "new",
      draft: emptyDraft(),
      draftUid: undefined,
      draftRow: undefined,
      attachments: [],
      attachmentsLoading: false,
      session: 0,
      edits: 0,
      savedEdits: 0,
      pendingOpen: null,
      openCompose: (mode = "new", draft, options = {}) => {
        if (!options.force && hasUnsavedChanges(get())) {
          const focused = typeof document === "undefined" ? null : document.activeElement;
          const origin = focused && focused !== document.body ? focused.getBoundingClientRect() : null;
          set({ pendingOpen: { mode, draft, options, origin } });
          return false;
        }
        const next = { ...emptyDraft(), ...draft };
        // HTML only arrives with a draft being reopened, which already has its sign-off.
        if (options.signature !== false && !next.html) next.text = withSignature(next.text, getPref("mail.signature"));
        set({
          session: get().session + 1,
          open: true,
          minimized: false,
          mode,
          draft: next,
          draftUid: options.draftUid,
          draftRow: options.draftUid,
          attachments: options.attachments ?? [],
          attachmentsLoading: options.attachmentsLoading ?? false,
          edits: options.unsaved ? 1 : 0,
          savedEdits: 0,
          pendingOpen: null,
        });
        options.onOpen?.();
        return true;
      },
      answerPending: (open) => {
        const pending = get().pendingOpen;
        set({ pendingOpen: null });
        if (!pending) return;
        if (open) get().openCompose(pending.mode, pending.draft, { ...pending.options, force: true });
        // Kept: bring the message being written back into view.
        else set({ minimized: false });
      },
      closeCompose: () =>
        set({
          open: false,
          minimized: false,
          maximized: false,
          draft: emptyDraft(),
          draftUid: undefined,
          draftRow: undefined,
          attachments: [],
          attachmentsLoading: false,
          edits: 0,
          savedEdits: 0,
          pendingOpen: null,
        }),
      minimize: () => set({ minimized: true }),
      restore: () => set({ minimized: false }),
      toggleMaximize: () => set({ maximized: !get().maximized }),
      setDraft: (patch, { edit = true } = {}) =>
        set({ draft: { ...get().draft, ...patch }, edits: get().edits + (edit ? 1 : 0) }),
      setDraftUid: (draftUid) => set({ draftUid, draftRow: draftUid ?? get().draftRow }),
      markSaved: (edits) => set({ savedEdits: Math.max(get().savedEdits, edits) }),
      addAttachments: (files, { edit = true } = {}) =>
        set({ attachments: [...get().attachments, ...files], edits: get().edits + (edit ? 1 : 0) }),
      removeAttachment: (index) =>
        set({ attachments: get().attachments.filter((_, i) => i !== index), edits: get().edits + 1 }),
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
        draftRow: state.attachments.length || state.attachmentsLoading ? undefined : state.draftRow,
        open: state.open && !state.minimized ? false : state.open,
        minimized: state.minimized,
        mode: state.mode,
        maximized: false,
        // Unsaved stays unsaved across a reload; the exact count doesn't matter.
        edits: state.edits > state.savedEdits ? 1 : 0,
        savedEdits: 0,
      }),
    },
  ),
);
