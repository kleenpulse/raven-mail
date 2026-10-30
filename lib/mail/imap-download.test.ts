import { describe, expect, mock, test } from "bun:test";
import { PassThrough } from "node:stream";
import { makeSession } from "@/test/helpers/session";

// A stand-in imapflow: each download hands out a stream the test ends by hand.
const streams: PassThrough[] = [];
const downloadOptions: unknown[] = [];
let connected = 0;

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  async connect() {
    connected += 1;
  }
  async noop() {}
  async getMailboxLock() {
    return { release() {} };
  }
  async download(_range: string, _part: string, options: unknown) {
    downloadOptions.push(options);
    const content = new PassThrough();
    streams.push(content);
    return { meta: { filename: "a.pdf", contentType: "application/pdf" }, content };
  }
  async logout() {
    connected -= 1;
  }
  close() {
    connected -= 1;
  }
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { downloadAttachment, verifyCredentials, DOWNLOAD_CHUNK_BYTES } = await import("@/lib/mail/imap");

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("downloadAttachment", () => {
  test("at most 2 downloads per mailbox; a 3rd waits while UI calls still connect", async () => {
    const session = makeSession({ dev: false });
    const started: number[] = [];
    const pending = [1, 2, 3].map((n) =>
      downloadAttachment(session, "INBOX", String(n), "2").then((file) => {
        started.push(n);
        return file;
      }),
    );
    await tick();
    expect(started.sort()).toEqual([1, 2]);

    // Two of the four connection slots are still free: the list/poll/reader path isn't starved.
    await Promise.race([
      Promise.all([verifyCredentials(session), verifyCredentials(session)]),
      tick().then(() => {
        throw new Error("a UI call was blocked behind downloads");
      }),
    ]);

    // Finishing one download lets the third start.
    streams[0]!.end();
    streams[0]!.resume();
    await tick();
    expect(started).toContain(3);

    for (const s of streams) s.destroy();
    await Promise.all(pending);
  });

  test("a failed download frees its slots", async () => {
    const session = makeSession({ dev: false });
    const original = FakeImapFlow.prototype.download;
    FakeImapFlow.prototype.download = async () => ({ meta: {}, content: undefined }) as never;
    try {
      for (let i = 0; i < 3; i++) {
        await expect(downloadAttachment(session, "INBOX", "1", "9")).rejects.toThrow("Attachment not found");
      }
    } finally {
      FakeImapFlow.prototype.download = original;
    }
    const file = await downloadAttachment(session, "INBOX", "1", "2");
    expect(file.filename).toBe("a.pdf");
    streams.at(-1)!.destroy();
  });

  test("fetches in large windows and reports time spent queued", async () => {
    const session = makeSession({ dev: false });
    const first = streams.length;
    await Promise.all([1, 2].map((n) => downloadAttachment(session, "INBOX", String(n), "2")));
    const third = downloadAttachment(session, "INBOX", "3", "2");
    await tick();
    streams[first]!.destroy();
    const file = await third;
    expect(downloadOptions.at(-1)).toEqual({ uid: true, chunkSize: DOWNLOAD_CHUNK_BYTES });
    // It sat behind the other two for at least one tick before its turn came.
    expect(file.timings.wait).toBeGreaterThanOrEqual(5);
    for (const s of streams.slice(first)) s.destroy();
    await tick();
  });

  test("other mailboxes have their own download slots", async () => {
    const [a, b] = [makeSession({ dev: false }), makeSession({ dev: false })];
    const first = streams.length;
    await Promise.all([1, 2].map((n) => downloadAttachment(a, "INBOX", String(n), "2")));
    const other = await Promise.race([
      downloadAttachment(b, "INBOX", "1", "2"),
      tick().then(() => null),
    ]);
    expect(other).not.toBeNull();
    for (const s of streams.slice(first)) s.destroy();
    await tick();
    expect(connected).toBe(0);
  });
});
