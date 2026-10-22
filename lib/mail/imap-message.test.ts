import { describe, expect, mock, test } from "bun:test";
import { makeSession } from "@/test/helpers/session";

// getMessage / getUnsubscribeHeaders against a stand-in imapflow serving one raw message.

const RAW = [
  "From: Weekly <news@reads.example>",
  "To: me@x.example",
  "Subject: Issue 12",
  "Message-ID: <i12@reads.example>",
  "List-Id: Weekly <weekly.reads.example>",
  "List-Unsubscribe: <https://reads.example/u/abc>,",
  " <mailto:leave@reads.example?subject=stop>",
  "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello.",
].join("\r\n");

const queries: Record<string, unknown>[] = [];

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  mailbox: { path: string; uidValidity: bigint } | null = null;
  async connect() {}
  async list() {
    return [{ path: "INBOX", delimiter: "/", specialUse: "\\Inbox", flags: new Set() }];
  }
  async getMailboxLock(path: string) {
    this.mailbox = { path, uidValidity: BigInt(1) };
    return { release() {} };
  }
  async fetchOne(_uid: string, query: Record<string, unknown>) {
    queries.push(query);
    const head = RAW.slice(0, RAW.indexOf("\r\n\r\n") + 4);
    if (!query.source) return { uid: 7, headers: Buffer.from(head) };
    return {
      uid: 7,
      flags: new Set(["\\Seen"]),
      internalDate: new Date("2026-10-20T10:00:00Z"),
      envelope: { subject: "Issue 12", messageId: "<i12@reads.example>" },
      source: Buffer.from(RAW),
    };
  }
  async logout() {}
  close() {}
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { getMessage, getUnsubscribeHeaders } = await import("@/lib/mail/imap");

const session = () => makeSession({ dev: false });

describe("List-* headers over IMAP", () => {
  test("getMessage keeps the raw List-Unsubscribe pair (mailparser folds them into `list`)", async () => {
    const message = await getMessage(session(), "INBOX", "7");
    expect(message.headers["list-unsubscribe"]).toBe("<https://reads.example/u/abc>, <mailto:leave@reads.example?subject=stop>");
    expect(message.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");
    expect(message.headers["list-id"]).toBe("Weekly <weekly.reads.example>");
    expect(message.headers.list).toBeUndefined();
  });

  test("getUnsubscribeHeaders fetches only those two headers", async () => {
    queries.length = 0;
    const headers = await getUnsubscribeHeaders(session(), "INBOX", "7");
    expect(queries).toEqual([{ uid: true, headers: ["list-unsubscribe", "list-unsubscribe-post"] }]);
    expect(headers["list-unsubscribe"]).toBe("<https://reads.example/u/abc>, <mailto:leave@reads.example?subject=stop>");
    expect(headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");
  });
});
