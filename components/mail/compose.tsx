"use client";

import * as React from "react";
import {
  ChevronUp,
  FilePen,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { Tip, TooltipGroup } from "@/components/ui/tooltip";
import { discardDraftAction, saveDraftAction, sendMessageAction } from "@/lib/actions/mail";
import { useComposeStore, type ComposeAttachment } from "@/lib/store/compose";
import { useMounted } from "@/hooks/use-mounted";
import { useFolders, useInvalidateMail } from "@/hooks/use-mail";
import { formatBytes } from "@/lib/format";
import { modKeyLabel } from "@/lib/utils";
import { draftBody } from "@/lib/mail/reply";
import { bytesToBase64 } from "@/lib/mail/attachment";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import type { ComposeDraft } from "@/lib/mail/types";

const AUTOSAVE_KEY = "em-compose-local";

const toPayload = ({ filename, contentType, contentBase64 }: ComposeAttachment) => ({
  filename,
  contentType,
  contentBase64,
});

/**
 * The message being answered, kept under the text box instead of in it:
 * replies start trimmed ("•••", as Gmail does), forwards start open since the
 * content is the point. It's re-attached as a "> " quote when sent.
 */
function QuotedOriginal({
  quote,
  onRemove,
}: {
  quote: NonNullable<ComposeDraft["quote"]>;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(quote.kind === "forward");
  const bodyId = React.useId();
  const label = quote.kind === "forward" ? "Forwarded message" : "Quoted message";
  return (
    <div className="shrink-0 border-t border-border px-4 py-2.5 dark:border-glass-border">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="inline-flex h-6 shrink-0 items-center rounded-pill bg-card-nested px-2.5 font-mono text-[12px] leading-none tracking-[0.2em] text-ink-2 ring-1 ring-border outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border"
        >
          •••
        </button>
        <p className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
          {quote.kind === "forward" ? label : quote.header}
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          title={`Don't include the ${label.toLowerCase()}`}
          className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {open && (
        <div
          id={bodyId}
          className="auto-scroll mt-2 max-h-48 overflow-y-auto border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2 dark:border-glass-border"
        >
          {quote.kind === "forward" && <p className="mb-2 font-mono text-[11px]">{quote.header}</p>}
          {quote.body}
        </div>
      )}
    </div>
  );
}

const fieldInput =
  "h-11 flex-1 rounded-none border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent";

function IconCircle({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tip
      label={label}
      render={
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("rounded-full text-ink-2 hover:text-foreground", className)}
          {...props}
        />
      }
    >
      {children}
    </Tip>
  );
}

/** One hairline-separated header row; the label tints while its field has focus. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group/field flex items-center gap-3 border-b border-border px-5 transition-colors last:border-b-0 focus-within:bg-card dark:border-glass-border dark:focus-within:bg-accent">
      <label
        htmlFor={htmlFor}
        className="readout w-14 shrink-0 transition-colors group-focus-within/field:text-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function ComposeDock() {
  const {
    open,
    minimized,
    maximized,
    mode,
    draft,
    closeCompose,
    minimize,
    restore,
    toggleMaximize,
    setDraft,
    draftUid,
    setDraftUid,
    attachments,
    attachmentsLoading,
    addAttachments,
    removeAttachment,
  } = useComposeStore();

  // The store rehydrates from localStorage on the client; rendering before
  // hydration finishes would disagree with the server's markup.
  const mounted = useMounted();
  const fieldId = React.useId();
  const [showCc, setShowCc] = React.useState(false);
  const [busy, setBusy] = React.useState<"send" | "draft" | null>(null);
  const { data: folders } = useFolders();
  const { invalidateMessages, invalidateFolders } = useInvalidateMail();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const savedRef = React.useRef<string>("");

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { draft?: typeof draft };
        if (parsed.draft && !draft.to && !draft.subject && !draft.text && !draft.quote) {
          setDraft(parsed.draft);
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const payload = JSON.stringify({ draft });
    if (payload === savedRef.current) return;
    const timer = setTimeout(() => {
      savedRef.current = payload;
      try {
        localStorage.setItem(AUTOSAVE_KEY, payload);
      } catch {
        /* quota */
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, open]);

  if (!open || !mounted) return null;

  const draftsFolder = resolveSpecialFolder(folders ?? [], "\\Drafts");
  const refreshDrafts = () => {
    void invalidateMessages(draftsFolder ?? undefined);
    void invalidateFolders();
  };
  // Every file a reopened draft had must be back before its server copy is replaced.
  const blocked = busy !== null || attachmentsLoading;
  const outgoing = () => ({
    draft: { ...draft, text: draftBody(draft), quote: undefined, attachments: attachments.map(toPayload) },
    draftUid,
  });

  function forgetLocalCopy() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function handleSend() {
    if (!draft.to.trim()) {
      toast.error("Add at least one recipient.");
      return;
    }
    setBusy("send");
    try {
      const res = await sendMessageAction(outgoing());
      if (!res.ok) throw new Error(res.error);
      toast.success("Message sent");
      forgetLocalCopy();
      if (draftUid) refreshDrafts();
      closeCompose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDraft() {
    setBusy("draft");
    try {
      const res = await saveDraftAction(outgoing());
      if (!res.ok) throw new Error(res.error);
      // Without a uid (no UIDPLUS, lookup missed) the next save adds a copy rather than guess.
      setDraftUid(res.data.uid);
      refreshDrafts();
      toast.success("Saved to Drafts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy(null);
    }
  }

  function handleDiscard() {
    const snapshot = { mode, draft, attachments };
    const saved = draftUid;
    closeCompose();
    forgetLocalCopy();
    const hasContent = Boolean(draft.to.trim() || draft.subject.trim() || draft.text.trim() || attachments.length);
    if (saved) {
      void discardDraftAction({ draftUid: saved }).then((res) => {
        if (!res.ok) toast.error(res.error);
        refreshDrafts();
      });
    }
    if (!hasContent && !saved) return;
    // The server copy is gone, but this tab still holds everything: Undo reopens it unsaved.
    toast("Draft discarded", {
      action: {
        label: "Undo",
        onClick: () => {
          const store = useComposeStore.getState();
          store.openCompose(snapshot.mode, snapshot.draft);
          store.addAttachments(snapshot.attachments);
        },
      },
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = await Promise.all(
      Array.from(files).map(async (file) => ({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: bytesToBase64(await file.arrayBuffer()),
        size: file.size,
      })),
    );
    addAttachments(next);
  }

  // The footer has always advertised mod+Enter; this makes it true.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) {
      e.preventDefault();
      void handleSend();
    }
  }

  const title =
    mode === "reply"
      ? "Reply"
      : mode === "replyAll"
        ? "Reply all"
        : mode === "forward"
          ? "Forward"
          : "New message";

  if (minimized) {
    return (
      <button
        type="button"
        onClick={restore}
        aria-label={`Restore draft: ${draft.subject || title}`}
        className="fixed right-4 bottom-[5.75rem] z-40 flex h-12 w-64 max-w-[calc(100vw-2rem)] animate-rise-in items-center gap-3 rounded-pill bg-sheet pr-3 pl-4 text-sm shadow-lift ring-1 ring-border outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring md:right-6 md:bottom-6 dark:glass dark:ring-0 dark:hover:bg-accent"
      >
        <span aria-hidden className="absolute inset-0 rounded-[inherit] dark:bg-background/50" />
        <span aria-hidden className="relative size-2 shrink-0 rounded-full bg-signal" />
        <span className="relative min-w-0 flex-1 truncate text-left font-medium">
          {draft.subject || title}
        </span>
        <ChevronUp aria-hidden className="relative size-4 text-ink-2" />
      </button>
    );
  }

  const mod = modKeyLabel();
  // Reply-all prefills Cc; never hide recipients the message will go to.
  const ccVisible = showCc || Boolean(draft.cc?.trim()) || Boolean(draft.bcc?.trim());
  // New and forwarded mail start with an empty To; replies start in the body.
  const focusTo = mode === "new" || mode === "forward";

  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={handleKeyDown}
      className={cn(
        "fixed z-40 flex animate-rise-in flex-col overflow-hidden rounded-card bg-sheet text-foreground shadow-lift ring-1 ring-border dark:glass dark:ring-0",
        maximized
          ? "inset-2 sm:inset-6 lg:inset-x-[max(1.5rem,calc((100vw-60rem)/2))]"
          : "inset-2 sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(36rem,calc(100svh-3rem))] sm:w-120",
      )}
    >
      {/* Nebula: tint inside the glass so labels stay legible when the dock floats over the white email paper. */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border pr-3 pl-5 dark:border-glass-border dark:bg-background/50">
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="truncate font-display text-[17px] tracking-[-0.01em]">{title}</h2>
          <p className="readout mt-1 truncate">Autosaves on this device</p>
        </div>
        <TooltipGroup>
          <IconCircle label="Minimize" onClick={minimize}>
            <Minus />
          </IconCircle>
          <IconCircle label={maximized ? "Restore size" : "Expand"} onClick={toggleMaximize}>
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </IconCircle>
          <IconCircle label="Close" onClick={closeCompose}>
            <X />
          </IconCircle>
        </TooltipGroup>
      </div>

      <div className="flex min-h-0 flex-1 flex-col dark:bg-background/50">
        <div className="shrink-0 border-b border-border dark:border-glass-border">
          <Field label="To" htmlFor={`${fieldId}-to`}>
            <Input
              id={`${fieldId}-to`}
              value={draft.to}
              onChange={(e) => setDraft({ to: e.target.value })}
              placeholder="alice@example.com, bob@example.com"
              autoFocus={focusTo}
              className={fieldInput}
            />
            <button
              type="button"
              onClick={() => setShowCc((v) => !v)}
              aria-expanded={ccVisible}
              className="shrink-0 rounded-pill px-2.5 py-1 font-mono text-[11px] tracking-wide text-ink-2 uppercase outline-none transition-colors hover:bg-card-nested hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent"
            >
              Cc Bcc
            </button>
          </Field>
          {ccVisible && (
            <>
              <Field label="Cc" htmlFor={`${fieldId}-cc`}>
                <Input
                  id={`${fieldId}-cc`}
                  value={draft.cc ?? ""}
                  onChange={(e) => setDraft({ cc: e.target.value })}
                  className={fieldInput}
                />
              </Field>
              <Field label="Bcc" htmlFor={`${fieldId}-bcc`}>
                <Input
                  id={`${fieldId}-bcc`}
                  value={draft.bcc ?? ""}
                  onChange={(e) => setDraft({ bcc: e.target.value })}
                  className={fieldInput}
                />
              </Field>
            </>
          )}
          <Field label="Subject" htmlFor={`${fieldId}-subject`}>
            <Input
              id={`${fieldId}-subject`}
              value={draft.subject}
              onChange={(e) => setDraft({ subject: e.target.value })}
              placeholder="What's it about?"
              className={fieldInput}
            />
          </Field>
        </div>

        <Textarea
          value={draft.text}
          onChange={(e) => setDraft({ text: e.target.value })}
          placeholder={draft.quote?.kind === "reply" ? "Write your reply…" : "Write your message…"}
          aria-label="Message body"
          autoFocus={!focusTo}
          className="auto-scroll min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[14.5px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

        {draft.quote && (
          <QuotedOriginal
            key={`${draft.quote.kind}:${draft.quote.header}`}
            quote={draft.quote}
            onRemove={() => setDraft({ quote: undefined })}
          />
        )}

        {attachmentsLoading && (
          <p
            role="status"
            className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3 text-[12px] text-ink-2 dark:border-glass-border"
          >
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Loading the files in this draft…
          </p>
        )}

        {attachments.length > 0 && (
          <ul className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-3 dark:border-glass-border">
            {attachments.map((a, i) => (
              <li
                key={`${a.filename}-${i}`}
                className="inline-flex h-8 max-w-full items-center gap-2 rounded-pill bg-card pr-1 pl-3 text-[12px] ring-1 ring-border dark:bg-card-nested dark:ring-glass-border"
              >
                <span className="max-w-40 truncate font-medium">{a.filename}</span>
                <span className="font-mono text-[10.5px] text-ink-2 tabular">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="grid size-6 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${a.filename}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <TooltipGroup>
          <div className="flex h-16 shrink-0 items-center gap-1.5 border-t border-border px-3 dark:border-glass-border">
            <Button size="pill" onClick={handleSend} disabled={blocked} className="pl-4">
              {busy === "send" ? <LoaderCircle className="animate-spin" /> : <Send />}
              Send
            </Button>
            <IconCircle label="Attach files" onClick={() => fileRef.current?.click()} className="ml-1">
              <Paperclip />
            </IconCircle>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <IconCircle label="Save to Drafts" onClick={handleSaveDraft} disabled={blocked}>
              {busy === "draft" ? <LoaderCircle className="animate-spin" /> : <FilePen />}
            </IconCircle>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1 text-[11px] text-ink-2 sm:inline-flex">
                <Kbd>{mod}</Kbd>
                <Kbd>↵</Kbd>
                <span className="ml-0.5">to send</span>
              </span>
              <IconCircle label="Discard" onClick={handleDiscard} className="hover:text-destructive">
                <Trash2 />
              </IconCircle>
            </div>
          </div>
        </TooltipGroup>
      </div>
    </div>
  );
}
