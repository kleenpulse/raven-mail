export type PendingSendOptions<T> = {
  delayMs: () => number;
  send: (payload: T) => Promise<void>;
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
    undo(id: string): T | null {
      const entry = waiting.get(id);
      if (!entry) return null;
      waiting.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      options.persist?.remove(id);
      return entry.payload;
    },
    flush(): Promise<void> {
      return Promise.all([...waiting.keys()].map(go)).then(() => undefined);
    },
    isWaiting: (id: string) => waiting.has(id),
    pending: () => waiting.size + inFlight,
  };
}
