import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { mapCachedPages, type MessagesCache } from "@/lib/mail/cache-pages";
import type { MailSummary } from "@/lib/mail/types";

/*
 * Archive, trash, move-to-Inbox and delete-forever, held back for an undo
 * window. Rows leave every cached list of the folder at once; the server call
 * runs when the window ends, or straight away when the page is hidden.
 * Framework-free so the timing and cache logic can be tested directly.
 */

export type DeferredKind = "archive" | "trash" | "inbox" | "deleteForever";

export type DeferredMove = {
  kind: DeferredKind;
  folder: string;
  uids: string[];
  /** archive / inbox only. */
  destination?: string;
  /**
   * Server thread ids of the rows acted on. The commit reaches every message of
   * those threads in the folder, loaded or not; undo restores the rows that showed.
   */
  threadIds?: string[];
};

type RemovedItem = { message: MailSummary; page: number; index: number };
type RemovedFromList = { key: QueryKey; items: RemovedItem[] };

type Batch = {
  id: string;
  move: DeferredMove;
  removed: RemovedFromList[];
  timer: ReturnType<typeof setTimeout>;
  onUndo?: () => void;
  onSettled?: () => void;
};

export type DeferredQueueOptions = {
  client: () => QueryClient | null;
  /** Prefix shared by every cached list (plain and searched) of a folder. */
  listRoot: (folder: string) => QueryKey;
  /** Throws on failure. `keepalive` is set when the page is going away. */
  commit: (move: DeferredMove, opts: { keepalive: boolean }) => Promise<void>;
  delayMs: () => number;
  onCommitted?: (move: DeferredMove) => void;
  onFailed?: (move: DeferredMove, err: unknown) => void;
};

function merge(messages: MailSummary[], items: RemovedItem[]): MailSummary[] {
  const next = [...messages];
  const present = new Set(next.map((m) => m.uid));
  // Ascending index, so each insert lands where it was before the ones after it.
  for (const { message, index } of [...items].sort((a, b) => a.index - b.index)) {
    if (present.has(message.uid)) continue;
    next.splice(Math.min(index, next.length), 0, message);
  }
  return next;
}

let seq = 0;

export function createDeferredQueue(opts: DeferredQueueOptions) {
  const pending = new Map<string, Batch>();

  function removeRows(move: DeferredMove): RemovedFromList[] {
    const qc = opts.client();
    if (!qc) return [];
    const ids = new Set(move.uids);
    const out: RemovedFromList[] = [];
    for (const [key, data] of qc.getQueriesData<MessagesCache>({ queryKey: opts.listRoot(move.folder) })) {
      if (!data?.pages) continue;
      const items: RemovedItem[] = [];
      data.pages.forEach((p, page) =>
        p.messages.forEach((message, index) => {
          if (ids.has(message.uid)) items.push({ message, page, index });
        }),
      );
      if (items.length === 0) continue;
      qc.setQueryData<MessagesCache>(key, (old) =>
        mapCachedPages(old, (messages) => messages.filter((m) => !ids.has(m.uid)), -items.length),
      );
      out.push({ key, items });
    }
    return out;
  }

  function restoreRows(batch: Batch) {
    const qc = opts.client();
    if (!qc) return;
    for (const { key, items } of batch.removed) {
      qc.setQueryData<MessagesCache>(key, (old) =>
        mapCachedPages(old, (messages, page) => merge(messages, items.filter((r) => r.page === page)), items.length),
      );
    }
  }

  function take(id: string): Batch | undefined {
    const batch = pending.get(id);
    if (!batch) return undefined;
    pending.delete(id);
    clearTimeout(batch.timer);
    return batch;
  }

  async function commit(id: string, keepalive: boolean) {
    const batch = take(id);
    if (!batch) return;
    batch.onSettled?.();
    try {
      await opts.commit(batch.move, { keepalive });
      opts.onCommitted?.(batch.move);
    } catch (err) {
      restoreRows(batch);
      opts.onFailed?.(batch.move, err);
    }
  }

  return {
    /** Hides the rows now and schedules the server call. Returns the batch id. */
    defer(move: DeferredMove, hooks: { onUndo?: () => void; onSettled?: () => void } = {}): string | null {
      if (move.uids.length === 0) return null;
      const id = `deferred-${++seq}`;
      const removed = removeRows(move);
      const timer = setTimeout(() => void commit(id, false), opts.delayMs());
      pending.set(id, { id, move, removed, timer, ...hooks });
      return id;
    },
    /** Puts the rows back where they were and cancels the server call. */
    undo(id: string): boolean {
      const batch = take(id);
      if (!batch) return false;
      restoreRows(batch);
      batch.onSettled?.();
      batch.onUndo?.();
      return true;
    },
    /** The most recent batch still in its window (Ctrl/⌘+Z). */
    undoLatest(): boolean {
      const latest = [...pending.keys()].at(-1);
      return latest ? this.undo(latest) : false;
    },
    /** Commit everything now; used on pagehide, where the request must outlive the page. */
    flush() {
      for (const id of [...pending.keys()]) void commit(id, true);
    },
    get size() {
      return pending.size;
    },
  };
}

export type DeferredQueue = ReturnType<typeof createDeferredQueue>;
