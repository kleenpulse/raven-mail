import type { MailMessage } from "@/lib/mail/types";

export const PRELOAD_MAX_UIDS = 12;
export const PRELOAD_MAX_MESSAGE_BYTES = 1_000_000;
export const PRELOAD_BATCH_BYTES = 3_000_000;

export type PreloadResult = { messages: MailMessage[]; skipped: string[] };

export function planPreload(
  items: readonly { uid: number; size: number }[],
  { maxMessageBytes = PRELOAD_MAX_MESSAGE_BYTES, batchBytes = PRELOAD_BATCH_BYTES } = {},
): { take: number[]; tooBig: number[] } {
  const take: number[] = [];
  const tooBig: number[] = [];
  let bytes = 0;
  for (const { uid, size } of [...items].sort((a, b) => b.uid - a.uid)) {
    if (size > maxMessageBytes) {
      tooBig.push(uid);
    } else if (take.length === 0 || bytes + size <= batchBytes) {
      take.push(uid);
      bytes += size;
    }
  }
  return { take, tooBig };
}

export type Preloader = {
  setRows(uids: readonly string[]): void;
  see(uid: string, inView: boolean): void;
  poke(): void;
  stop(): void;
};

export function createPreloader({
  load,
  isWarm,
  seed,
  canRun = () => true,
  batch = PRELOAD_MAX_UIDS,
  settleMs = 200,
  now = Date.now,
}: {
  load: (uids: string[], signal: AbortSignal) => Promise<PreloadResult>;
  isWarm: (uid: string) => boolean;
  seed: (message: MailMessage) => void;
  canRun?: () => boolean;
  batch?: number;
  settleMs?: number;
  now?: () => number;
}): Preloader {
  let rows: readonly string[] = [];
  const inView = new Set<string>();
  const skipped = new Set<string>();
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = 0;
  let retryAt = 0;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(flush, settleMs);
  }

  function fail() {
    backoff = Math.min(backoff * 2 || 5_000, 60_000);
    retryAt = now() + backoff;
  }

  function flush() {
    if (stopped || inFlight || now() < retryAt || !canRun()) return;
    const uids = rows.filter((uid) => inView.has(uid) && !skipped.has(uid) && !isWarm(uid)).slice(0, batch);
    if (uids.length === 0) return;
    const request = new AbortController();
    inFlight = request;
    load(uids, request.signal).then(
      (result) => {
        if (request.signal.aborted) return;
        inFlight = null;
        for (const message of result.messages) seed(message);
        for (const uid of result.skipped) skipped.add(uid);
        if (result.messages.length + result.skipped.length === 0) return fail();
        backoff = 0;
        flush();
      },
      () => {
        if (request.signal.aborted) return;
        inFlight = null;
        fail();
      },
    );
  }

  return {
    setRows(uids) {
      rows = uids;
      inView.clear();
    },
    see(uid, visible) {
      if (visible) inView.add(uid);
      else inView.delete(uid);
      schedule();
    },
    poke: schedule,
    stop() {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
      inFlight = null;
    },
  };
}
