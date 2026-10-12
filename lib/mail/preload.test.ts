import { describe, expect, test } from "bun:test";
import { createPreloader, planPreload, type PreloadResult } from "@/lib/mail/preload";
import type { MailMessage } from "@/lib/mail/types";

describe("planPreload", () => {
  test("newest first, oversized out, packed to the batch budget", () => {
    const plan = planPreload(
      [
        { uid: 1, size: 100 },
        { uid: 3, size: 2_000_000 },
        { uid: 2, size: 900_000 },
        { uid: 4, size: 800_000 },
      ],
      { maxMessageBytes: 1_000_000, batchBytes: 1_000_000 },
    );
    // 4 fits, 3 is too big, 2 would overrun the budget (deferred), 1 still fits.
    expect(plan).toEqual({ take: [4, 1], tooBig: [3] });
  });

  test("always takes the first eligible message, so every request makes progress", () => {
    expect(planPreload([{ uid: 5, size: 900 }], { maxMessageBytes: 1_000, batchBytes: 100 })).toEqual({
      take: [5],
      tooBig: [],
    });
  });
});

type Call = {
  uids: string[];
  signal: AbortSignal;
  resolve: (result: PreloadResult) => void;
  reject: (err: unknown) => void;
};

const message = (uid: string) => ({ uid }) as MailMessage;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness(opts: { batch?: number; canRun?: () => boolean } = {}) {
  const calls: Call[] = [];
  const warm = new Set<string>();
  const seeded: string[] = [];
  let clock = 0;
  const preloader = createPreloader({
    load: (uids, signal) => new Promise((resolve, reject) => calls.push({ uids, signal, resolve, reject })),
    isWarm: (uid) => warm.has(uid),
    seed: (m) => {
      seeded.push(m.uid);
      warm.add(m.uid);
    },
    settleMs: 0,
    now: () => clock,
    ...opts,
  });
  const show = (rows: string[], visible = rows) => {
    preloader.setRows(rows);
    for (const uid of visible) preloader.see(uid, true);
  };
  return { preloader, calls, warm, seeded, show, advance: (ms: number) => (clock += ms) };
}

describe("createPreloader", () => {
  test("asks for cold rows in view, top-down, one request at a time", async () => {
    const h = harness({ batch: 2 });
    h.warm.add("8");
    h.show(["9", "8", "7", "6", "5"], ["6", "7", "8", "9"]);
    await tick();
    expect(h.calls.map((c) => c.uids)).toEqual([["9", "7"]]);

    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(1);

    h.calls[0]!.resolve({ messages: [message("9"), message("7")], skipped: [] });
    await tick();
    expect(h.seeded).toEqual(["9", "7"]);
    expect(h.calls[1]!.uids).toEqual(["6"]);
  });

  test("skipped rows are never asked for again; deferred ones are", async () => {
    const h = harness();
    h.show(["3", "2", "1"]);
    await tick();
    h.calls[0]!.resolve({ messages: [message("3")], skipped: ["2"] });
    await tick();
    expect(h.calls[1]!.uids).toEqual(["1"]);

    h.calls[1]!.resolve({ messages: [message("1")], skipped: [] });
    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(2);
  });

  test("forgets rows that scroll away", async () => {
    const h = harness();
    h.show(["2", "1"]);
    h.preloader.see("2", false);
    await tick();
    expect(h.calls[0]!.uids).toEqual(["1"]);
  });

  test("a failure backs off instead of retrying on every scroll", async () => {
    const h = harness();
    h.show(["1"]);
    await tick();
    h.calls[0]!.reject(new Error("502"));
    await tick();

    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(1);

    h.advance(5_000);
    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(2);
  });

  test("a reply that settles nothing counts as a failure", async () => {
    const h = harness();
    h.show(["1"]);
    await tick();
    h.calls[0]!.resolve({ messages: [], skipped: [] });
    await tick();
    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(1);
  });

  test("stop aborts the request and ignores a late reply", async () => {
    const h = harness();
    h.show(["1"]);
    await tick();
    h.preloader.stop();
    expect(h.calls[0]!.signal.aborted).toBe(true);

    h.calls[0]!.resolve({ messages: [message("1")], skipped: [] });
    h.preloader.poke();
    await tick();
    expect(h.seeded).toEqual([]);
    expect(h.calls).toHaveLength(1);
  });

  test("waits while it can't run", async () => {
    let visible = false;
    const h = harness({ canRun: () => visible });
    h.show(["1"]);
    await tick();
    expect(h.calls).toHaveLength(0);

    visible = true;
    h.preloader.poke();
    await tick();
    expect(h.calls).toHaveLength(1);
  });
});
