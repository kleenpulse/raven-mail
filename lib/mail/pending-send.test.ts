import { beforeEach, describe, expect, test } from "bun:test";
import { createSendQueue, pickOrphan } from "@/lib/mail/pending-send";

const DELAY = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sent: string[];
let log: string[];
let failNext: boolean;
let delay: number;

function makeQueue(send?: (p: string) => Promise<void>) {
  let n = 0;
  return createSendQueue<string>({
    delayMs: () => delay,
    newId: () => `s${++n}`,
    send:
      send ??
      (async (p) => {
        if (failNext) {
          failNext = false;
          throw new Error("NO");
        }
        sent.push(p);
      }),
    persist: {
      save: (id) => log.push(`save ${id}`),
      sending: (id) => log.push(`sending ${id}`),
      remove: (id) => log.push(`remove ${id}`),
    },
    onSent: (p) => log.push(`sent ${p}`),
    onFailed: (p) => log.push(`failed ${p}`),
  });
}

beforeEach(() => {
  sent = [];
  log = [];
  failNext = false;
  delay = DELAY;
});

describe("createSendQueue", () => {
  test("waits out the window, then sends once", async () => {
    const q = makeQueue();
    const { id, until } = q.defer("hello");
    expect(until).toBeGreaterThan(Date.now());
    expect(q.isWaiting(id)).toBe(true);
    expect(q.pending()).toBe(1);
    await sleep(DELAY / 2);
    expect(sent).toEqual([]);
    await sleep(DELAY + 10);
    expect(sent).toEqual(["hello"]);
    expect(q.pending()).toBe(0);
    expect(log).toEqual(["save s1", "sending s1", "remove s1", "sent hello"]);
  });

  test("undo inside the window gives the payload back and never sends", async () => {
    const q = makeQueue();
    const { id } = q.defer("hello");
    expect(q.undo(id)).toBe("hello");
    expect(q.pending()).toBe(0);
    await sleep(DELAY + 10);
    expect(sent).toEqual([]);
    expect(log).toEqual(["save s1", "remove s1"]);
    expect(q.undo(id)).toBeNull();
  });

  test("undo is too late once the send has started", async () => {
    let release!: () => void;
    const q = makeQueue(() => new Promise<void>((r) => (release = r)));
    const { id } = q.defer("hello");
    await sleep(DELAY + 10);
    expect(q.isWaiting(id)).toBe(false);
    expect(q.undo(id)).toBeNull();
    expect(q.pending()).toBe(1); // still on the wire
    release();
    await sleep(0);
    expect(q.pending()).toBe(0);
  });

  test("Off (0 s) sends at once, with no timer", async () => {
    delay = 0;
    const q = makeQueue();
    q.defer("now");
    await sleep(0);
    expect(sent).toEqual(["now"]);
  });

  test("flush sends everything still waiting, now", async () => {
    const q = makeQueue();
    q.defer("a");
    q.defer("b");
    await q.flush();
    expect(sent).toEqual(["a", "b"]);
    await sleep(DELAY + 10);
    expect(sent).toEqual(["a", "b"]);
  });

  test("a failed send is reported and its record removed", async () => {
    const q = makeQueue();
    failNext = true;
    q.defer("oops");
    await q.flush();
    expect(sent).toEqual([]);
    expect(log).toEqual(["save s1", "sending s1", "remove s1", "failed oops"]);
    expect(q.pending()).toBe(0);
  });
});

describe("pickOrphan", () => {
  const rec = (id: string, until: number, sending?: boolean) => ({ id, until, sending });

  test("a record another live tab still holds is left alone", () => {
    const records = [rec("a", 100)];
    expect(pickOrphan(records, () => true)).toEqual({ restore: null, keep: records });
  });

  test("brings back the newest orphan and keeps the rest for later", () => {
    const live = rec("live", 300);
    const older = rec("old", 100);
    const newer = rec("new", 200, true);
    const { restore, keep } = pickOrphan([older, live, newer], (id) => id === "live");
    expect(restore).toBe(newer);
    expect(keep).toEqual([older, live]);
  });

  test("nothing stored, nothing to do", () => {
    expect(pickOrphan([], () => false)).toEqual({ restore: null, keep: [] });
  });
});
