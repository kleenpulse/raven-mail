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

// Message 8 carries a small PNG as section 2.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const WITH_FILE = [
  "From: Ada <ada@x.example>",
  "To: me@x.example",
  "Subject: Logo",
  'Content-Type: multipart/mixed; boundary="b"',
  "",
  "--b",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Here it is.",
  "--b",
  'Content-Type: image/png; name="logo.png"',
  'Content-Disposition: attachment; filename="logo.png"',
  "Content-Transfer-Encoding: base64",
  "",
  PNG.toString("base64"),
  "--b--",
  "",
].join("\r\n");
const WITH_FILE_STRUCTURE = {
  type: "multipart/mixed",
  childNodes: [
    { part: "1", type: "text/plain", parameters: { charset: "utf-8" } },
    { part: "2", type: "image/png", disposition: "attachment", dispositionParameters: { filename: "logo.png" } },
  ],
};

const queries: Record<string, unknown>[] = [];
let connects = 0;
let downloads = 0;

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  mailbox: { path: string; uidValidity: bigint } | null = null;
  async connect() {
    connects += 1;
  }
  async download() {
    downloads += 1;
    return { meta: {}, content: undefined };
  }
  async list() {
    return [{ path: "INBOX", delimiter: "/", specialUse: "\\Inbox", flags: new Set() }];
  }
  async getMailboxLock(path: string) {
    this.mailbox = { path, uidValidity: BigInt(1) };
    return { release() {} };
  }
  async fetchOne(uid: string, query: Record<string, unknown>) {
    queries.push(query);
    if (uid === "8") {
      return { uid: 8, flags: new Set(), envelope: {}, source: Buffer.from(WITH_FILE), bodyStructure: WITH_FILE_STRUCTURE };
    }
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
const { downloadAttachment, getMessage, getUnsubscribeHeaders } = await import("@/lib/mail/imap");

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

describe("attachments kept from reading the message", () => {
  test("a click on a file in a message just read never goes back to the server", async () => {
    const me = session();
    const message = await getMessage(me, "INBOX", "8");
    expect(message.attachments.map((a) => a.part)).toEqual(["2"]);
    [connects, downloads] = [0, 0];

    const file = await downloadAttachment(me, "INBOX", "8", "2");
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(new Uint8Array(PNG));
    expect(file).toMatchObject({ filename: "logo.png", contentType: "image/png", size: PNG.byteLength });
    expect(Object.keys(file.timings)).toEqual(["memory"]);
    expect([connects, downloads]).toEqual([0, 0]);
  });

  test("another mailbox asking for the same part goes to its own server", async () => {
    await getMessage(session(), "INBOX", "8");
    [connects, downloads] = [0, 0];
    await expect(downloadAttachment(session(), "INBOX", "8", "2")).rejects.toThrow("Attachment not found");
    expect([connects, downloads]).toEqual([1, 1]);
  });
});
