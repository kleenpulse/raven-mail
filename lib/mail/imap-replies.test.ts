import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeSession } from "@/test/helpers/session";

// findReplies against a stand-in imapflow: which SEARCHes run, where, and what they answer.

const searches: { mailbox: string; criteria: Record<string, unknown> }[] = [];
/** mailbox → the uids each Message-ID's search finds there. */
let hits: Record<string, Record<string, number[]>> = {};
let connects = 0;
/** Message-IDs whose search crawls until the socket closes. */
let stuck = new Set<string>();
let closed = 0;

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  mailbox: { path: string } | null = null;
  async connect() {
    connects++;
  }
  async list() {
    return [
      { path: "INBOX", delimiter: "/", specialUse: "\\Inbox", flags: new Set() },
      { path: "[Gmail]/Sent Mail", delimiter: "/", specialUse: "\\Sent", flags: new Set() },
    ];
  }
  async getMailboxLock(path: string) {
    this.mailbox = { path };
    return { release() {} };
  }
  async search(criteria: Record<string, unknown>) {
    const path = this.mailbox!.path;
    searches.push({ mailbox: path, criteria });
    const or = (criteria.or as { header: Record<string, string> }[] | undefined) ?? [];
    const header = (criteria.header as Record<string, string> | undefined) ?? or[0]?.header ?? {};
    const id = Object.values(header)[0]!;
    if (stuck.has(id)) return new Promise<number[]>((_, reject) => (this.#onClose = () => reject(new Error("Connection not available"))));
    return hits[path]?.[id] ?? [];
  }
  #onClose = () => {};
  async logout() {}
  close() {
    closed++;
    this.usable = false;
    this.#onClose();
  }
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { findReplies } = await import("@/lib/mail/imap");

const since = new Date("2026-09-22T10:00:00Z");

beforeEach(() => {
  searches.length = 0;
  hits = {};
  connects = 0;
  stuck = new Set();
  closed = 0;
});

describe("findReplies over IMAP", () => {
  test("one Inbox SEARCH per message, by In-Reply-To or References, bounded by SINCE", async () => {
    hits = { INBOX: { "<a@x>": [12] } };
    const answers = await findReplies(makeSession({ dev: false }), [
      { messageId: "<a@x>", since, needUid: false },
      { messageId: "<b@x>", since, needUid: false },
    ]);
    expect(answers.get("<a@x>")).toEqual({ replied: true });
    expect(answers.get("<b@x>")).toEqual({ replied: false });
    expect(searches).toEqual([
      { mailbox: "INBOX", criteria: { since, or: [{ header: { "in-reply-to": "<a@x>" } }, { header: { references: "<a@x>" } }] } },
      { mailbox: "INBOX", criteria: { since, or: [{ header: { "in-reply-to": "<b@x>" } }, { header: { references: "<b@x>" } }] } },
    ]);
  });

  test("finds the Sent copy's newest uid only for the ones that need it", async () => {
    hits = { "[Gmail]/Sent Mail": { "<a@x>": [40, 41] } };
    const answers = await findReplies(makeSession({ dev: false }), [
      { messageId: "<a@x>", since, needUid: true },
      { messageId: "<b@x>", since, needUid: false },
    ]);
    expect(answers.get("<a@x>")).toEqual({ replied: false, sentUid: "41" });
    expect(answers.get("<b@x>")).toEqual({ replied: false });
    expect(searches.filter((s) => s.mailbox === "[Gmail]/Sent Mail")).toEqual([
      { mailbox: "[Gmail]/Sent Mail", criteria: { header: { "message-id": "<a@x>" } } },
    ]);
  });

  test("an abort closes the socket and keeps the answers found so far", async () => {
    hits = { INBOX: { "<a@x>": [12] } };
    stuck = new Set(["<b@x>"]);
    const answers = await findReplies(
      makeSession({ dev: false }),
      [
        { messageId: "<a@x>", since, needUid: true },
        { messageId: "<b@x>", since, needUid: false },
        { messageId: "<c@x>", since, needUid: false },
      ],
      AbortSignal.timeout(30),
    );
    expect([...answers]).toEqual([["<a@x>", { replied: true }]]);
    expect(searches.map((s) => s.mailbox)).toEqual(["INBOX", "INBOX"]);
    expect(closed).toBeGreaterThan(0);
  });

  test("already aborted: no connection at all", async () => {
    const answers = await findReplies(makeSession({ dev: false }), [{ messageId: "<a@x>", since, needUid: false }], AbortSignal.abort());
    expect(answers.size).toBe(0);
    expect(connects).toBe(0);
  });

  test("nothing to check: no connection at all", async () => {
    expect((await findReplies(makeSession({ dev: false }), [])).size).toBe(0);
    expect(connects).toBe(0);
  });
});
