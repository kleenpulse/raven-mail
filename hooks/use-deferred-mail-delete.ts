"use client";

import * as React from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteMessagesAction } from "@/lib/actions/mail";
import { mapCachedPages, useInvalidateMail, type MessagesCache } from "@/hooks/use-mail";
import { useAccount } from "@/components/providers/account-provider";
import { getPref } from "@/lib/prefs/store";
import { qk } from "@/lib/query-keys";
import type { MailSummary } from "@/lib/mail/types";


type RemovedItem = { message: MailSummary; page: number; index: number };

type PendingBatch = {
  folder: string;
  key: QueryKey;
  removed: RemovedItem[];
  timer: ReturnType<typeof setTimeout>;
};

type SharedState = {
  qc: ReturnType<typeof useQueryClient> | null;
  invalidate: ReturnType<typeof useInvalidateMail> | null;
  pending: Map<string, PendingBatch>;
};

// Module-level so an undo batch survives MailReaderInner unmount (key={uid}
// remount) and MailListInner folder remount — grace window is never cut short.
const shared: SharedState = { qc: null, invalidate: null, pending: new Map() };

function mergeRemoved(messages: MailSummary[], removed: RemovedItem[]): MailSummary[] {
  const next = [...messages];
  const present = new Set(next.map((m) => m.uid));
  for (const { message, index } of removed) {
    if (present.has(message.uid)) continue;
    next.splice(Math.max(0, Math.min(index, next.length)), 0, message);
  }
  return next;
}

function restoreBatch(batch: PendingBatch) {
  const qc = shared.qc;
  if (!qc) return;
  qc.setQueryData<MessagesCache>(batch.key, (old) =>
    mapCachedPages(
      old,
      (messages, page) => mergeRemoved(messages, batch.removed.filter((r) => r.page === page)),
      batch.removed.length,
    ),
  );
}

async function commitBatch(batchId: string) {
  const batch = shared.pending.get(batchId);
  if (!batch) return;
  shared.pending.delete(batchId);
  clearTimeout(batch.timer);
  const uids = batch.removed.map((r) => r.message.uid);
  try {
    const res = await deleteMessagesAction({ folder: batch.folder, uids });
    if (!res.ok) throw new Error(res.error);
    shared.invalidate?.invalidateMessages(batch.folder);
    shared.invalidate?.invalidateFolders();
  } catch (err) {
    restoreBatch(batch);
    toast.error(err instanceof Error ? err.message : "Could not delete");
  }
}

function undoBatch(batchId: string) {
  const batch = shared.pending.get(batchId);
  if (!batch) return;
  clearTimeout(batch.timer);
  shared.pending.delete(batchId);
  restoreBatch(batch);
  toast.success(batch.removed.length > 1 ? "Restored" : "Message restored");
}

/**
 * Optimistic permanent delete with an undo window (Settings → Mail, 5s default) (ellum deferred-delete
 * pattern). Rows leave the React Query cache immediately; the server delete
 * only runs after grace — Undo puts them back and cancels the commit.
 */
export function useDeferredMailDelete() {
  const qc = useQueryClient();
  const invalidate = useInvalidateMail();
  const { email } = useAccount();

  React.useEffect(() => {
    shared.qc = qc;
    shared.invalidate = invalidate;
    return () => {
      if (shared.qc === qc) shared.qc = null;
      if (shared.invalidate === invalidate) shared.invalidate = null;
    };
  }, [qc, invalidate]);

  const deleteWithUndo = React.useCallback(
    (folder: string, uids: string[]): string | null => {
      if (uids.length === 0) return null;
      const key = qk.messages(email, folder, "");
      const prev = qc.getQueryData<MessagesCache>(key);
      if (!prev) return null;

      const uidSet = new Set(uids);
      const removed: RemovedItem[] = [];
      prev.pages.forEach((p, page) =>
        p.messages.forEach((message, index) => {
          if (uidSet.has(message.uid)) removed.push({ message, page, index });
        }),
      );
      if (removed.length === 0) return null;

      qc.setQueryData<MessagesCache>(key, (old) =>
        mapCachedPages(old, (messages) => messages.filter((m) => !uidSet.has(m.uid)), -removed.length),
      );

      const batchId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;

      const graceMs = getPref("mail.undoMs");
      const timer = setTimeout(() => {
        void commitBatch(batchId);
      }, graceMs);

      shared.pending.set(batchId, { folder, key, removed, timer });

      const count = removed.length;
      const toastId = toast(
        count > 1 ? `${count} messages deleted` : "Message deleted",
        {
          duration: graceMs,
          description: "Deleting permanently…",
          action: {
            label: "Undo",
            onClick: () => {
              undoBatch(batchId);
              toast.dismiss(toastId);
            },
          },
        },
      );

      return batchId;
    },
    [qc, email],
  );

  return { deleteWithUndo, undo: undoBatch };
}
