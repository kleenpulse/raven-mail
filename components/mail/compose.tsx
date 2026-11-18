"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  BellRing,
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
import { Kbd } from "@/components/ui/kbd";
import { Tip, TooltipGroup } from "@/components/ui/tooltip";
import { discardDraftAction } from "@/lib/actions/mail";
import { composeImages, useComposeStore, type ComposeAttachment } from "@/lib/store/compose";
import { useMounted } from "@/hooks/use-mounted";
import { useSaveDraft } from "@/hooks/use-save-draft";
import { useContacts, useFolders, useInvalidateMail } from "@/hooks/use-mail";
import { RecipientField } from "@/components/mail/recipient-field";
import { RemindMenu } from "@/components/mail/remind-menu";
import { choiceLabel } from "@/lib/follow-ups/when";
import { AUTOSAVE_KEY, forgetLocalCopy, toOutgoing, useUndoSend } from "@/hooks/use-undo-send";
import {
  fileAllowanceMb,
  isInlineType,
  newCid,
  pastedName,
  planFiles,
  sendProblem,
  type RejectReason,
} from "@/lib/mail/inline-images";
import { MAX_FILES } from "@/lib/mail/send-limits";
import type { RichEditorApi } from "@/components/mail/rich-editor";
import { formatBytes, looksLikeAddress, splitAddressList } from "@/lib/format";
import { modKeyLabel } from "@/lib/utils";
import { base64ToBytes, bytesToBase64, canPreview } from "@/lib/mail/attachment";
import { useAttachmentPreview } from "@/components/mail/attachment-preview";
import { resolveSpecialFolder } from "@/lib/mail/folders";
import type { ComposeDraft } from "@/lib/mail/types";

/** Files the preview can't show: the bytes are already here, so save them without asking the server. */
function downloadAttachment(file: { filename: string; contentBase64: string }) {
  const blob = new Blob([base64ToBytes(file.contentBase64)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const carriesFiles = (data: DataTransfer) => Array.from(data.types).includes("Files");

/** A file by name, for a toast. A clipboard image is always "image.png", which names nothing. */
const called = (name: string) => (!name || /^image\.\w+$/i.test(name) ? "That image" : `"${name}"`);

/** An image's own width, or null when the browser can't decode it. */
async function imageWidth(file: Blob): Promise<number | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width } = bitmap;
    bitmap.close();
    return width > 0 ? width : null;
  } catch {
    return null;
  }
}

// The editor (Tiptap, ProseMirror) loads when compose first opens, not with the mail list.
const RichEditor = dynamic(() => import("@/components/mail/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" />,
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
        <Tip
          label={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="inline-flex h-6 shrink-0 items-center rounded-pill bg-card-nested px-2.5 font-mono text-[12px] leading-none tracking-[0.2em] text-ink-2 ring-1 ring-border outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border"
        >
          •••
        </Tip>
        <p className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
          {quote.kind === "forward" ? label : quote.header}
        </p>
        <Tip
          label={`Don't include the ${label.toLowerCase()}`}
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </Tip>
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
    attachments,
    attachmentsLoading,
    addAttachments,
    removeAttachment,
    session,
  } = useComposeStore();

  // The store rehydrates from localStorage on the client; rendering before
  // hydration finishes would disagree with the server's markup.
  const mounted = useMounted();
  const fieldId = React.useId();
  const [showCc, setShowCc] = React.useState(false);
  const [busy, setBusy] = React.useState<"draft" | null>(null);
  const { data: folders } = useFolders();
  const { invalidateMessages, invalidateFolders } = useInvalidateMail();
  const draftsFolder = resolveSpecialFolder(folders ?? [], "\\Drafts");
  const send = useUndoSend({ draftsFolder });
  const saveDraft = useSaveDraft();
  const { data: contacts = [] } = useContacts(open);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const preview = useAttachmentPreview();
  const savedRef = React.useRef<string>("");
  const editorRef = React.useRef<RichEditorApi | null>(null);
  const ownDrag = React.useRef(false);
  const [dropping, setDropping] = React.useState(false);

  // The dock is a corner of the page: a file dropped beside it would make the
  // browser open that file in place of the app, and the message would be lost.
  React.useEffect(() => {
    if (!open) return;
    const keepPage = (e: DragEvent) => {
      if (e.dataTransfer && carriesFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", keepPage);
    window.addEventListener("drop", keepPage);
    return () => {
      window.removeEventListener("dragover", keepPage);
      window.removeEventListener("drop", keepPage);
    };
  }, [open]);

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

  const refreshDrafts = () => {
    void invalidateMessages(draftsFolder ?? undefined);
    void invalidateFolders();
  };
  // Every file a reopened draft had must be back before its server copy is replaced.
  const blocked = busy !== null || attachmentsLoading;

  // Compose closes at once; the send waits out the undo window, and its local
  // copy stays until the server says it went.
  // Read from the store: a recipient typed then sent with ⌘/Ctrl+Enter joins it in the same keypress.
  function handleSend() {
    const { draft } = useComposeStore.getState();
    if (!draft.to.trim()) {
      toast.error("Add at least one recipient.");
      return;
    }
    const bad = splitAddressList([draft.to, draft.cc, draft.bcc].filter(Boolean).join(", ")).find(
      (a) => !looksLikeAddress(a.address),
    );
    if (bad) {
      toast.error(`"${bad.address}" isn't an email address.`);
      return;
    }
    // Undo can bring a deleted image back after more files went in: check what would really go.
    const problem = sendProblem(toOutgoing({ draft, draftUid, attachments }).draft);
    if (problem) {
      toast.error(problem);
      return;
    }
    send({ mode, draft, draftUid, attachments });
    closeCompose();
  }

  async function handleSaveDraft() {
    setBusy("draft");
    try {
      await saveDraft();
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
          store.openCompose(snapshot.mode, snapshot.draft, {
            signature: false,
            attachments: snapshot.attachments,
            unsaved: true,
          });
        },
      },
    });
  }

  /**
   * Every way a file gets in: the paperclip, the editor's image button, a paste
   * and a drop. With `inline`, images a mail reader can show go into the body;
   * everything else joins the file chips.
   */
  async function addFiles(files: File[], { inline, at }: { inline: boolean; at?: { x: number; y: number } }) {
    if (!files.length) return;
    const start = useComposeStore.getState();
    const { accepted, rejected } = planFiles(files, {
      html: start.draft.html ?? "",
      text: start.draft.text,
      attachments: start.attachments,
    });
    const first = (reason: RejectReason) => rejected.find((r) => r.reason === reason);
    if (first("count")) toast.error(`A message can hold up to ${MAX_FILES} files.`);
    const tooBig = first("size");
    if (tooBig) {
      toast.error(`${called(tooBig.name)} doesn't fit.`, {
        description: `The files in one message can add up to about ${fileAllowanceMb()} MB.`,
      });
    }
    let unread = first("empty")?.name;

    const read = await Promise.all(
      accepted.map(async (file): Promise<ComposeAttachment | null> => {
        try {
          const contentType = file.type || "application/octet-stream";
          const base = { contentType, contentBase64: bytesToBase64(await file.arrayBuffer()), size: file.size };
          const width = inline && isInlineType(contentType) ? await imageWidth(file) : null;
          // An image that won't decode still goes, as a plain file.
          if (!width) return { ...base, filename: file.name || "file" };
          return { ...base, filename: pastedName(file), cid: newCid(), width };
        } catch {
          // A folder, or a file that went away while it was being read.
          unread ??= file.name;
          return null;
        }
      }),
    );
    if (unread !== undefined) toast.error(`Couldn't read ${called(unread).replace(/^T/, "t")}.`);

    const next = read.filter((file) => file !== null);
    const now = useComposeStore.getState();
    // Compose closed or moved on to another message while the files were being read.
    if (!next.length || !now.open || now.session !== start.session) return;
    // Without the editor (still loading), images go as plain files rather than nowhere.
    const editor = editorRef.current;
    const ready: ComposeAttachment[] = editor
      ? next
      : next.map(({ filename, contentType, contentBase64, size }) => ({ filename, contentType, contentBase64, size }));
    addAttachments(ready);
    const pictures = ready.flatMap((file) => (file.cid ? [{ cid: file.cid, alt: file.filename, width: file.width }] : []));
    if (editor && pictures.length) editor.insertImages(pictures, at);
  }

  // The footer has always advertised mod+Enter; this makes it true.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) {
      e.preventDefault();
      handleSend();
    }
  }

  // Capture phase, and stopped here: the editor's own paste would otherwise run too.
  // Works from To, Subject or the body alike.
  function handlePaste(e: React.ClipboardEvent) {
    const data = e.clipboardData;
    let files = Array.from(data.files);
    if (!files.length) {
      files = Array.from(data.items).flatMap((item) => {
        const file = item.kind === "file" ? item.getAsFile() : null;
        return file ? [file] : [];
      });
    }
    // Spreadsheets and word processors copy a picture of the text beside the text: the text wins.
    if (!files.length || data.getData("text/plain").trim()) return;
    e.preventDefault();
    e.stopPropagation();
    void addFiles(files, { inline: true });
  }

  // A drag that began inside the dock (selected text, an image) is the editor's business.
  const fileDrag = (e: React.DragEvent) => !ownDrag.current && carriesFiles(e.dataTransfer);

  function handleDragOver(e: React.DragEvent) {
    if (!fileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  }

  function handleDrop(e: React.DragEvent) {
    const files = fileDrag(e) ? Array.from(e.dataTransfer.files) : [];
    ownDrag.current = false;
    setDropping(false);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    // On the body, images land where they were dropped; anywhere else on the dock, files attach.
    const onBody = (e.target as Element).closest?.(".ProseMirror") != null;
    void addFiles(files, { inline: onBody, at: onBody ? { x: e.clientX, y: e.clientY } : undefined });
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
        data-compose
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
  // Images in the body aren't chips. `index` is the file's place among all the message's files.
  const chips = attachments.flatMap((file, index) => (file.cid ? [] : [{ file, index }]));

  return (
    <>
      {/* Beside the dock, not in it: React key events bubble through portals, and the dock's Ctrl+Enter sends. */}
      {preview.dialog}
      <div
        role="dialog"
        // Single-key shortcuts stand down while focus is anywhere in the dock (lib/keyboard).
        data-compose
        aria-label={title}
        onKeyDown={handleKeyDown}
        onPasteCapture={handlePaste}
        onDragStartCapture={() => {
          ownDrag.current = true;
        }}
        onDragEndCapture={() => {
          ownDrag.current = false;
        }}
        onDragOverCapture={handleDragOver}
        onDragLeaveCapture={handleDragLeave}
        onDropCapture={handleDrop}
        className={cn(
          "fixed z-40 flex animate-rise-in flex-col overflow-hidden rounded-card text-foreground shadow-lift glass-pane",
          dropping && "ring-2 ring-ring",
          maximized
            ? "inset-2 sm:inset-6 lg:inset-x-[max(1.5rem,calc((100vw-60rem)/2))]"
            : "inset-2 sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(36rem,calc(var(--app-h)-3rem))] sm:w-120",
        )}
      >
        {/* Nebula: a light tint inside the glass so labels stay legible when the dock floats over the white email paper. */}
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border pr-3 pl-5 dark:border-glass-border dark:bg-background/25">
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

        <div className="flex min-h-0 flex-1 flex-col dark:bg-background/25">
          <div className="shrink-0 border-b border-border dark:border-glass-border">
            <Field label="To" htmlFor={`${fieldId}-to`}>
              <RecipientField
                id={`${fieldId}-to`}
                label="To"
                value={draft.to}
                onChange={(to) => setDraft({ to })}
                contacts={contacts}
                placeholder="Name or email"
                autoFocus={focusTo}
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
                  <RecipientField
                    id={`${fieldId}-cc`}
                    label="Cc"
                    value={draft.cc ?? ""}
                    onChange={(cc) => setDraft({ cc })}
                    contacts={contacts}
                  />
                </Field>
                <Field label="Bcc" htmlFor={`${fieldId}-bcc`}>
                  <RecipientField
                    id={`${fieldId}-bcc`}
                    label="Bcc"
                    value={draft.bcc ?? ""}
                    onChange={(bcc) => setDraft({ bcc })}
                    contacts={contacts}
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

          <RichEditor
            key={session}
            html={draft.html}
            text={draft.text}
            autoFocus={!focusTo}
            placeholder={draft.quote?.kind === "reply" ? "Write your reply…" : "Write your message…"}
            mod={mod}
            onChange={({ html, text }, how) => setDraft({ html, text }, how)}
            images={composeImages}
            apiRef={editorRef}
            onPickImages={(files) => void addFiles(files, { inline: true })}
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

          {chips.length > 0 && (
            <ul className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-3 dark:border-glass-border">
              {chips.map(({ file: a, index }, i) => (
                <li
                  key={`${a.filename}-${index}`}
                  className="inline-flex h-8 max-w-full items-center gap-2 rounded-pill bg-card pr-1 pl-3 text-[12px] ring-1 ring-border dark:bg-card-nested dark:ring-glass-border"
                >
                  <Tip
                    label={canPreview(a) ? `Preview ${a.filename}` : `Download ${a.filename}`}
                    type="button"
                    data-preview-key={`compose/${i}`}
                    onClick={(e) =>
                      canPreview(a)
                        ? preview.open(a, e.currentTarget, { sources: chips.map((chip) => chip.file), index: i })
                        : downloadAttachment(a)
                    }
                    className="inline-flex min-w-0 items-center gap-2 rounded-pill outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="max-w-40 truncate font-medium">{a.filename}</span>
                    <span className="font-mono text-[10.5px] text-ink-2 tabular">{formatBytes(a.size)}</span>
                  </Tip>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
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
                <Send />
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
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  // Cleared so picking the same file again still counts as a change.
                  e.target.value = "";
                  void addFiles(files, { inline: false });
                }}
              />
              <IconCircle label="Save to Drafts" onClick={handleSaveDraft} disabled={blocked}>
                {busy === "draft" ? <LoaderCircle className="animate-spin" /> : <FilePen />}
              </IconCircle>
              <RemindMenu
                label={draft.remind ? `Reminds you ${choiceLabel(draft.remind)} if no one replies` : "Remind me if no reply"}
                button={
                  draft.remind ? (
                    <Button
                      variant="surface"
                      size="pill-sm"
                      aria-label={`Reminder ${choiceLabel(draft.remind)}`}
                      className="ml-1 text-signal-ink dark:text-signal"
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remind me if no reply"
                      className="rounded-full text-ink-2 hover:text-foreground"
                    />
                  )
                }
                status={draft.remind ? `Reminds you ${choiceLabel(draft.remind)}` : undefined}
                onPick={(remind) => setDraft({ remind })}
                onClear={draft.remind ? () => setDraft({ remind: undefined }) : undefined}
                clearLabel="Don't remind me"
              >
                <BellRing />
                {draft.remind && <span className="hidden sm:inline">{choiceLabel(draft.remind)}</span>}
              </RemindMenu>
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
    </>
  );
}
