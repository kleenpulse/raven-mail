import { afterEach, describe, expect, test } from "bun:test";
import {
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  ATTACHMENT_TTL_MS,
  clearAttachmentCache,
  forgetAttachments,
  recallAttachment,
  rememberAttachment,
} from "@/lib/mail/attachment-cache";

const file = (bytes: number, fill = 1) => ({ bytes: new Uint8Array(bytes).fill(fill), filename: "a.png", contentType: "image/png" });

afterEach(clearAttachmentCache);

describe("attachment cache", () => {
  test("hands back what was kept, for the same mailbox, folder, message and part only", () => {
    rememberAttachment("me", "INBOX", "7", "2", file(4));
    expect(recallAttachment("me", "INBOX", "7", "2")).toEqual(file(4));
    expect(recallAttachment("someone-else", "INBOX", "7", "2")).toBeUndefined();
    expect(recallAttachment("me", "Archive", "7", "2")).toBeUndefined();
    expect(recallAttachment("me", "INBOX", "8", "2")).toBeUndefined();
    expect(recallAttachment("me", "INBOX", "7", "3")).toBeUndefined();
  });

  test("keeps its own copy of the bytes", () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    rememberAttachment("me", "INBOX", "7", "2", { bytes: source.subarray(1, 3) });
    source.fill(0);
    const kept = recallAttachment("me", "INBOX", "7", "2")!;
    expect([...kept.bytes]).toEqual([2, 3]);
    expect(kept.bytes.buffer.byteLength).toBe(2);
  });

  test("forgets a file after a few minutes", () => {
    rememberAttachment("me", "INBOX", "7", "2", file(4), 1_000);
    expect(recallAttachment("me", "INBOX", "7", "2", 1_000 + ATTACHMENT_TTL_MS - 1)).toBeDefined();
    expect(recallAttachment("me", "INBOX", "7", "2", 1_000 + ATTACHMENT_TTL_MS)).toBeUndefined();
  });

  test("never keeps a file over the size limit", () => {
    rememberAttachment("me", "INBOX", "7", "2", file(ATTACHMENT_MAX_FILE_BYTES + 1));
    expect(recallAttachment("me", "INBOX", "7", "2")).toBeUndefined();
  });

  test("drops the least recently used files to stay under the total", () => {
    const quarter = ATTACHMENT_MAX_TOTAL_BYTES / 4;
    for (const part of ["1", "2", "3", "4"]) rememberAttachment("me", "INBOX", "7", part, file(quarter));
    // Opening part 1 again makes part 2 the oldest.
    expect(recallAttachment("me", "INBOX", "7", "1")).toBeDefined();
    rememberAttachment("me", "INBOX", "7", "5", file(quarter));
    expect(recallAttachment("me", "INBOX", "7", "2")).toBeUndefined();
    for (const part of ["1", "3", "4", "5"]) expect(recallAttachment("me", "INBOX", "7", part)).toBeDefined();
  });

  test("keeping the same part again replaces it rather than counting it twice", () => {
    const quarter = ATTACHMENT_MAX_TOTAL_BYTES / 4;
    for (const part of ["1", "2", "3", "4"]) rememberAttachment("me", "INBOX", "7", part, file(quarter));
    rememberAttachment("me", "INBOX", "7", "4", file(quarter, 2));
    for (const part of ["1", "2", "3"]) expect(recallAttachment("me", "INBOX", "7", part)).toBeDefined();
    expect(recallAttachment("me", "INBOX", "7", "4")!.bytes[0]).toBe(2);
  });

  test("sign-out forgets that mailbox's files and no one else's", () => {
    rememberAttachment("me", "INBOX", "7", "2", file(4));
    rememberAttachment("you", "INBOX", "7", "2", file(4));
    forgetAttachments("me");
    expect(recallAttachment("me", "INBOX", "7", "2")).toBeUndefined();
    expect(recallAttachment("you", "INBOX", "7", "2")).toBeDefined();
  });
});
