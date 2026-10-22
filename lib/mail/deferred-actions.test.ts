import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createDeferredQueue, type DeferredMove } from "@/lib/mail/deferred-actions";
import type { MessagesCache } from "@/lib/mail/cache-pages";
import type { MailSummary } from "@/lib/mail/types";

const DELAY = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const row = (uid: string): MailSummary => ({
  uid,
  folder: "INBOX",
  subject: `m${uid}`,
  from: { address: "a@x" },
  to: [],
  preview: "",
  date: "2026-10-01T00:00:00.000Z",
  flags: { seen: false, flagged: false, answered: false, draft: false },
  hasAttachments: false,
});

const list = (pages: string[][], count = pages.flat().length): MessagesCache => ({
  pages: pages.map((uids) => ({ messages: uids.map(row), count })),
  pageParams: pages.map((_, i) => (i === 0 ? null : String(i))),
});

const key = (folder: string, search = "") => ["acct", "me", "messages", folder, search];
let qc: QueryClient;
let committed: { move: DeferredMove; keepalive: boolean }[];
let failNext = false;
let failures = 0;

const queues: ReturnType<typeof createDeferredQueue>[] = [];

function makeQueue() {
  const q = createDeferredQueue({
    client: () => qc,
    listRoot: (folder) => ["acct", "me", "messages", folder],
    delayMs: () => DELAY,
    commit: async (move, { keepalive }) => {
      if (failNext) {
        failNext = false;
        throw new Error("NO");
      }
      committed.push({ move, keepalive });
    },
    onFailed: () => failures++,
  });
  queues.push(q);
  return q;
}

const uids = (k: unknown[]) => qc.getQueryData<MessagesCache>(k)!.pages.map((p) => p.messages.map((m) => m.uid));
const count = (k: unknown[]) => qc.getQueryData<MessagesCache>(k)!.pages[0]!.count;

// A batch left pending would commit into the next test.
afterEach(() => {
  for (const q of queues.splice(0)) while (q.undoLatest());
});

beforeEach(() => {
  qc = new QueryClient();
  committed = [];
  failNext = false;
  failures = 0;
  qc.setQueryData(key("INBOX"), list([["9", "8", "7"], ["6", "5", "4"]]));
  qc.setQueryData(key("INBOX", "invoice"), list([["8", "5"]]));
  qc.setQueryData(key("Archive"), list([["3"]]));
});

describe("createDeferredQueue", () => {
  test("rows leave every cached list of the folder at once, counts follow", () => {
    const q = makeQueue();
    q.defer({ kind: "archive", folder: "INBOX", uids: ["8", "5"], destination: "Archive" });
    expect(uids(key("INBOX"))).toEqual([["9", "7"], ["6", "4"]]);
    expect(count(key("INBOX"))).toBe(4);
    expect(uids(key("INBOX", "invoice"))).toEqual([[]]);
    expect(uids(key("Archive"))).toEqual([["3"]]);
    expect(committed).toEqual([]);
  });

  test("commits once the window ends, and the rows stay gone", async () => {
    const q = makeQueue();
    const move: DeferredMove = { kind: "trash", folder: "INBOX", uids: ["9"] };
    q.defer(move);
    await sleep(DELAY / 2);
    expect(committed).toEqual([]);
    await sleep(DELAY * 2);
    expect(committed).toEqual([{ move, keepalive: false }]);
    expect(uids(key("INBOX"))[0]).toEqual(["8", "7"]);
    expect(q.size).toBe(0);
  });

  test("undo restores rows in their old order and never commits", async () => {
    const q = makeQueue();
    let restored = false;
    const id = q.defer({ kind: "trash", folder: "INBOX", uids: ["8"] }, { onUndo: () => (restored = true) });
    expect(q.undo(id!)).toBe(true);
    expect(restored).toBe(true);
    expect(uids(key("INBOX"))).toEqual([["9", "8", "7"], ["6", "5", "4"]]);
    expect(count(key("INBOX"))).toBe(6);
    await sleep(DELAY * 2);
    expect(committed).toEqual([]);
    expect(q.undo(id!)).toBe(false);
  });

  test("bulk undo puts rows back on the right pages, at the right places", () => {
    const q = makeQueue();
    const id = q.defer({ kind: "archive", folder: "INBOX", uids: ["9", "7", "6", "4"], destination: "Archive" });
    expect(uids(key("INBOX"))).toEqual([["8"], ["5"]]);
    q.undo(id!);
    expect(uids(key("INBOX"))).toEqual([["9", "8", "7"], ["6", "5", "4"]]);
    expect(count(key("INBOX"))).toBe(6);
  });

  test("undoLatest takes the most recent batch first", () => {
    const q = makeQueue();
    q.defer({ kind: "trash", folder: "INBOX", uids: ["9"] });
    q.defer({ kind: "trash", folder: "INBOX", uids: ["4"] });
    expect(q.undoLatest()).toBe(true);
    expect(uids(key("INBOX"))).toEqual([["8", "7"], ["6", "5", "4"]]);
    expect(q.undoLatest()).toBe(true);
    expect(uids(key("INBOX"))).toEqual([["9", "8", "7"], ["6", "5", "4"]]);
    expect(q.undoLatest()).toBe(false);
  });

  test("a failed commit puts the rows back", async () => {
    const q = makeQueue();
    failNext = true;
    q.defer({ kind: "archive", folder: "INBOX", uids: ["7"], destination: "Archive" });
    await sleep(DELAY * 2);
    expect(failures).toBe(1);
    expect(uids(key("INBOX"))[0]).toEqual(["9", "8", "7"]);
  });

  test("flush commits everything now, as keepalive, and the timers don't fire again", async () => {
    const q = makeQueue();
    q.defer({ kind: "trash", folder: "INBOX", uids: ["9"] });
    q.defer({ kind: "inbox", folder: "Archive", uids: ["3"], destination: "INBOX" });
    q.flush();
    await sleep(0);
    expect(committed.map((c) => [c.move.kind, c.keepalive])).toEqual([
      ["trash", true],
      ["inbox", true],
    ]);
    await sleep(DELAY * 2);
    expect(committed).toHaveLength(2);
    expect(q.undoLatest()).toBe(false);
  });

  test("onSettled runs once, on commit or on undo", async () => {
    const q = makeQueue();
    let settled = 0;
    const a = q.defer({ kind: "trash", folder: "INBOX", uids: ["9"] }, { onSettled: () => settled++ });
    q.defer({ kind: "trash", folder: "INBOX", uids: ["8"] }, { onSettled: () => settled++ });
    q.undo(a!);
    await sleep(DELAY * 2);
    expect(settled).toBe(2);
  });

  test("still commits when nothing was cached", async () => {
    qc.clear();
    const q = makeQueue();
    q.defer({ kind: "trash", folder: "INBOX", uids: ["9"] });
    await sleep(DELAY * 2);
    expect(committed).toHaveLength(1);
  });

  test("nothing to do without uids", () => {
    expect(makeQueue().defer({ kind: "trash", folder: "INBOX", uids: [] })).toBeNull();
  });
});
