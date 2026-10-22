import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeSession } from "@/test/helpers/session";

// getThread / expandThreadUids against a stand-in imapflow that records each SEARCH.

type Fake = { uid: number; messageId: string; date: string; threadId?: string; references?: string; inReplyTo?: string };
let mailboxes: Record<string, Fake[]> = {};
let anchor: Fake & { folder: string };
const searches: { mailbox: string; criteria: Record<string, unknown> }[] = [];
let connects = 0;
// A SEARCH that never answers, like a header scan on a huge unindexed folder.
// As in imapflow, close() rejects whatever is still pending.
let hangSearch = false;

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  mailbox: { path: string; uidValidity: bigint } | null = null;
  private pending: ((err: Error) => void)[] = [];
  async connect() {
    connects++;
  }
  async list() {
    return [
      { path: "INBOX", delimiter: "/", specialUse: "\\Inbox", flags: new Set() },
      { path: "Sent", delimiter: "/", specialUse: "\\Sent", flags: new Set() },
      { path: "Archive", delimiter: "/", specialUse: "\\Archive", flags: new Set() },
    ];
  }
  async getMailboxLock(path: string) {
    this.mailbox = { path, uidValidity: BigInt(1) };
    return { release() {} };
  }
  async fetchOne() {
    return {
      uid: anchor.uid,
      internalDate: new Date(anchor.date),
      threadId: anchor.threadId,
      envelope: { messageId: anchor.messageId, inReplyTo: anchor.inReplyTo },
      headers: Buffer.from(anchor.references ? `References: ${anchor.references}\r\n\r\n` : "\r\n"),
    };
  }
  async search(criteria: Record<string, unknown>) {
    const path = this.mailbox!.path;
    searches.push({ mailbox: path, criteria });
    if (hangSearch) return new Promise<number[]>((_, reject) => this.pending.push(reject));
    return (mailboxes[path] ?? []).map((m) => m.uid);
  }
  async fetchAll(uids: number[]) {
    const path = this.mailbox!.path;
    return (mailboxes[path] ?? [])
      .filter((m) => uids.includes(m.uid))
      .map((m) => ({
        uid: m.uid,
        flags: new Set(["\\Seen"]),
        internalDate: new Date(m.date),
        threadId: m.threadId,
        envelope: { messageId: m.messageId, subject: "Plan", from: [{ address: "a@x" }], to: [] },
        headers: Buffer.from("\r\n"),
      }));
  }
  async logout() {
    if (!this.usable) throw new Error("Connection not available");
  }
  close() {
    this.usable = false;
    for (const reject of this.pending.splice(0)) reject(new Error("Connection not available"));
  }
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { getThread, expandThreadUids } = await import("@/lib/mail/imap");

const session = () => makeSession({ dev: false });

beforeEach(() => {
  searches.length = 0;
  mailboxes = {};
  hangSearch = false;
  connects = 0;
});

describe("getThread over IMAP", () => {
  test("a server thread id searches by it, in the folder and Sent, and merges oldest first", async () => {
    anchor = { folder: "INBOX", uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" };
    mailboxes = {
      INBOX: [
        { uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" },
        { uid: 3, messageId: "<a@x>", date: "2026-10-18T10:00:00Z", threadId: "777" },
      ],
      Sent: [{ uid: 5, messageId: "<b@x>", date: "2026-10-19T10:00:00Z", threadId: "777" }],
    };
    const t = await getThread(session(), "INBOX", "9");
    expect(searches).toEqual([
      { mailbox: "INBOX", criteria: { threadId: "777" } },
      { mailbox: "Sent", criteria: { threadId: "777" } },
    ]);
    expect(t.messages.map((m) => `${m.folder}:${m.uid}`)).toEqual(["INBOX:3", "Sent:5", "INBOX:9"]);
  });

  test("no thread id: one OR'd header SEARCH, bounded by SINCE 180 days before the message", async () => {
    anchor = {
      folder: "INBOX",
      uid: 9,
      messageId: "<c@x>",
      inReplyTo: "<b@x>",
      references: "<a@x> <b@x>",
      date: "2026-10-20T10:00:00Z",
    };
    mailboxes = { INBOX: [{ uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z" }] };
    await getThread(session(), "INBOX", "9");
    const c = searches[0]!.criteria as { since: Date; or: unknown[] };
    expect(c.since.toISOString()).toBe("2026-04-23T10:00:00.000Z");
    expect(c.or).toEqual([
      { header: { "message-id": "<a@x>" } },
      { header: { "message-id": "<b@x>" } },
      { header: { "message-id": "<c@x>" } },
      { header: { references: "<a@x>" } },
      { header: { "in-reply-to": "<c@x>" } },
    ]);
    expect(searches.map((s) => s.mailbox)).toEqual(["INBOX", "Sent"]);
  });

  test("opened from Sent, the other folder is the Inbox", async () => {
    anchor = { folder: "Sent", uid: 5, messageId: "<b@x>", date: "2026-10-19T10:00:00Z", threadId: "777" };
    await getThread(session(), "Sent", "5");
    expect(searches.map((s) => s.mailbox)).toEqual(["Sent", "INBOX"]);
  });

  test("mail to yourself (same Message-ID in both folders) shows once, from the open folder", async () => {
    anchor = { folder: "INBOX", uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" };
    mailboxes = {
      INBOX: [{ uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" }],
      Sent: [{ uid: 5, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" }],
    };
    const t = await getThread(session(), "INBOX", "9");
    expect(t.messages.map((m) => `${m.folder}:${m.uid}`)).toEqual(["INBOX:9"]);
  });

  test("one login per conversation, not one per folder", async () => {
    const s = session();
    anchor = { folder: "INBOX", uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" };
    await getThread(s, "INBOX", "9"); // warms the cached folder list
    connects = 0;
    await getThread(s, "INBOX", "9");
    expect(connects).toBe(1);
  });

  test("an abort closes the connection, so a stuck SEARCH gives its slot back", async () => {
    const s = session();
    anchor = { folder: "INBOX", uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" };
    await getThread(s, "INBOX", "9");
    hangSearch = true;
    // Fill all four connection slots with searches that never answer.
    const stuck = Array.from({ length: 4 }, () =>
      getThread(s, "INBOX", "9", AbortSignal.timeout(30)).then(
        () => "resolved",
        () => "aborted",
      ),
    );
    expect(await Promise.all(stuck)).toEqual(["aborted", "aborted", "aborted", "aborted"]);
    hangSearch = false;
    mailboxes = { INBOX: [{ uid: 3, messageId: "<a@x>", date: "" }] };
    const next = expandThreadUids(s, "INBOX", ["9"], ["777"]);
    const late = new Promise((r) => setTimeout(() => r("still waiting for a slot"), 500));
    expect(await Promise.race([next.then((u) => u.sort()), late])).toEqual(["3", "9"]);
  });

  test("an abort while waiting for a slot never connects", async () => {
    const s = session();
    anchor = { folder: "INBOX", uid: 9, messageId: "<c@x>", date: "2026-10-20T10:00:00Z", threadId: "777" };
    await getThread(s, "INBOX", "9");
    const ctl = new AbortController();
    ctl.abort();
    connects = 0;
    await expect(getThread(s, "INBOX", "9", ctl.signal)).rejects.toThrow();
    expect(connects).toBe(0);
  });
});

describe("expandThreadUids", () => {
  test("adds every message of the thread in the folder", async () => {
    mailboxes = { INBOX: [{ uid: 3, messageId: "<a@x>", date: "" }, { uid: 9, messageId: "<c@x>", date: "" }] };
    expect((await expandThreadUids(session(), "INBOX", ["9"], ["777"])).sort()).toEqual(["3", "9"]);
    expect(searches).toEqual([{ mailbox: "INBOX", criteria: { threadId: "777" } }]);
  });

  test("several threads OR together; none means no SEARCH at all", async () => {
    mailboxes = { INBOX: [] };
    await expandThreadUids(session(), "INBOX", ["9"], ["1", "2"]);
    expect(searches[0]!.criteria).toEqual({ or: [{ threadId: "1" }, { threadId: "2" }] });
    searches.length = 0;
    expect(await expandThreadUids(session(), "INBOX", ["9"], [])).toEqual(["9"]);
    expect(searches).toEqual([]);
  });
});
