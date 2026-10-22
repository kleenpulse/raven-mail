/*
 * Sends held back for an undo window. The queue owns timing only; the caller
 * persists each entry (so a closed tab brings the message back unsent) and
 * shows the countdown. Framework-free so the timing can be tested directly.
 */

export type PendingSendOptions<T> = {
  /** 0 sends at once, with no window. */
  delayMs: () => number;
  send: (payload: T) => Promise<void>;
  /** Called on queue, when the send starts, and when it settles (sent, failed or undone). */
  persist?: {
    save: (id: string, payload: T, until: number) => void;
    sending: (id: string) => void;
    remove: (id: string) => void;
  };
  onSending?: (payload: T, id: string) => void;
  onSent?: (payload: T, id: string) => void;
  onFailed?: (payload: T, err: unknown, id: string) => void;
  newId?: () => string;
};

type Entry<T> = { payload: T; timer: ReturnType<typeof setTimeout> | null };

export type SendRecord = { id: string; until: number; sending?: boolean };

/**
 * On page load: a record whose lock nobody holds belongs to a tab that closed
 * before its send finished. Bring back the newest such one; keep the rest
 * (live tabs' records, and older orphans for the next load).
 */
export function pickOrphan<R extends SendRecord>(
  records: R[],
  isHeld: (id: string) => boolean,
): { restore: R | null; keep: R[] } {
  const orphans = records.filter((r) => !isHeld(r.id)).sort((a, b) => b.until - a.until);
  const restore = orphans[0] ?? null;
  return { restore, keep: records.filter((r) => r !== restore) };
}

export function createSendQueue<T>(options: PendingSendOptions<T>) {
  const waiting = new Map<string, Entry<T>>();
  let inFlight = 0;
  const newId = options.newId ?? (() => crypto.randomUUID());

  async function go(id: string): Promise<void> {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    inFlight++;
    options.persist?.sending(id);
    options.onSending?.(entry.payload, id);
    try {
      await options.send(entry.payload);
      options.persist?.remove(id);
      options.onSent?.(entry.payload, id);
    } catch (err) {
      options.persist?.remove(id);
      options.onFailed?.(entry.payload, err, id);
    } finally {
      inFlight--;
    }
  }

  return {
    defer(payload: T): { id: string; until: number } {
      const id = newId();
      const ms = Math.max(0, options.delayMs());
      const until = Date.now() + ms;
      const entry: Entry<T> = { payload, timer: null };
      waiting.set(id, entry);
      options.persist?.save(id, payload, until);
      if (ms === 0) void go(id);
      else entry.timer = setTimeout(() => void go(id), ms);
      return { id, until };
    },
    /** The payload, if it hadn't started sending yet; null when it's too late. */
    undo(id: string): T | null {
      const entry = waiting.get(id);
      if (!entry) return null;
      waiting.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      options.persist?.remove(id);
      return entry.payload;
    },
    /** Sends everything still waiting, now. */
    flush(): Promise<void> {
      return Promise.all([...waiting.keys()].map(go)).then(() => undefined);
    },
    isWaiting: (id: string) => waiting.has(id),
    /** Waiting or on the wire: leaving the page now would lose or cut one off. */
    pending: () => waiting.size + inFlight,
  };
}
