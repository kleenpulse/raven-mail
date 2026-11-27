import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { mapCachedPages, type MessagesCache } from "@/lib/mail/cache-pages";
import type { MailSummary } from "@/lib/mail/types";

export type DeferredKind = "archive" | "trash" | "inbox" | "deleteForever";

export type DeferredMove = {
  kind: DeferredKind;
  folder: string;
  uids: string[];
  destination?: string;
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
  listRoot: (folder: string) => QueryKey;
  commit: (move: DeferredMove, opts: { keepalive: boolean }) => Promise<void>;
  delayMs: () => number;
  onCommitted?: (move: DeferredMove) => void;
  onFailed?: (move: DeferredMove, err: unknown) => void;
};

function merge(messages: MailSummary[], items: RemovedItem[]): MailSummary[] {
  const next = [...messages];
  const present = new Set(next.map((m) => m.uid));
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
    defer(move: DeferredMove, hooks: { onUndo?: () => void; onSettled?: () => void } = {}): string | null {
      if (move.uids.length === 0) return null;
      const id = `deferred-${++seq}`;
      const removed = removeRows(move);
      const timer = setTimeout(() => void commit(id, false), opts.delayMs());
      pending.set(id, { id, move, removed, timer, ...hooks });
      return id;
    },
    undo(id: string): boolean {
      const batch = take(id);
      if (!batch) return false;
      restoreRows(batch);
      batch.onSettled?.();
      batch.onUndo?.();
      return true;
    },
    undoLatest(): boolean {
      const latest = [...pending.keys()].at(-1);
      return latest ? this.undo(latest) : false;
    },
    flush() {
      for (const id of [...pending.keys()]) void commit(id, true);
    },
    get size() {
      return pending.size;
    },
  };
}

export type DeferredQueue = ReturnType<typeof createDeferredQueue>;
