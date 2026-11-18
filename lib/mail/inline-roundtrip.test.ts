import { describe, expect, mock, test } from "bun:test";
import { makeSession } from "@/test/helpers/session";

// A message with an inline image, through the real builder (nodemailer) and the
// real reader (mailparser, sanitize), then back into compose's shape: the path a
// saved draft takes when it's reopened. Only the IMAP connection is a stand-in.

const messages = new Map<string, Buffer>();

// What a server reports for the tree buildRawMessage writes: mixed > (alternative > (text, related > (html, image)), file).
const STRUCTURE = {
  type: "multipart/mixed",
  childNodes: [
    {
      part: "1",
      type: "multipart/alternative",
      childNodes: [
        { part: "1.1", type: "text/plain", parameters: { charset: "utf-8" } },
        {
          part: "1.2",
          type: "multipart/related",
          childNodes: [
            { part: "1.2.1", type: "text/html", parameters: { charset: "utf-8" } },
            { part: "1.2.2", type: "image/png", disposition: "inline", dispositionParameters: { filename: "team shot.png" } },
          ],
        },
      ],
    },
    { part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "notes.pdf" } },
  ],
};

class FakeImapFlow {
  usable = true;
  capabilities = new Map();
  mailbox: { path: string; uidValidity: bigint } | null = null;
  async connect() {}
  async download() {
    return { meta: {}, content: undefined };
  }
  async list() {
    return [{ path: "Drafts", delimiter: "/", specialUse: "\\Drafts", flags: new Set() }];
  }
  async getMailboxLock(path: string) {
    this.mailbox = { path, uidValidity: BigInt(1) };
    return { release() {} };
  }
  async fetchOne(uid: string) {
    return {
      uid: Number(uid),
      flags: new Set(["\\Draft"]),
      internalDate: new Date("2026-11-18T10:00:00Z"),
      envelope: {},
      source: messages.get(uid),
      bodyStructure: STRUCTURE,
    };
  }
  async logout() {}
  close() {}
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));
const { getMessage } = await import("@/lib/mail/imap");
const { buildRawMessage } = await import("@/lib/mail/smtp");
const { draftFromMessage } = await import("@/lib/mail/reply");
const { adoptDataImages } = await import("@/lib/mail/inline-images");

/** Not a real picture: nothing on this path decodes it. */
function bytes(length: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) % 251;
  return out;
}

async function roundTrip(uid: string, image: Buffer) {
  const session = makeSession({ dev: false });
  const { raw } = await buildRawMessage(
    session,
    {
      to: "a@x.example",
      subject: "Shot",
      text: "Look: [image: team shot.png]",
      html: '<p>Look: <img src="cid:abc123@raven.mail" alt="team shot.png" width="560" style="max-width:100%;height:auto"></p>',
      attachments: [
        { filename: "team shot.png", contentType: "image/png", contentBase64: image.toString("base64"), cid: "abc123@raven.mail" },
        { filename: "notes.pdf", contentType: "application/pdf", contentBase64: Buffer.from("pdf").toString("base64") },
      ],
    },
    { keepBcc: true },
  );
  messages.set(uid, raw);
  const message = await getMessage(session, "Drafts", uid);
  const draft = draftFromMessage(message);
  return { message, draft, adopted: adoptDataImages(draft.html ?? "", () => "new1@raven.mail") };
}

describe("an inline image, sent or saved and then read back", () => {
  for (const [label, size] of [
    ["a small image", 4_000],
    ["an image over 1.5 MB", 2_000_000],
  ] as const) {
    test(`${label} comes back into compose as the same inline image`, async () => {
      const image = bytes(size);
      const { message, draft, adopted } = await roundTrip(String(size), image);

      // The reader shows it in the body and lists only the real attachment, once.
      expect(message.html).not.toContain("cid:");
      expect(message.html.match(/<img/g)).toHaveLength(1);
      expect(message.attachments.map((a) => [a.filename, a.part])).toEqual([["notes.pdf", "2"]]);

      // Back in compose: one cid image, same bytes, same name, alt and width; no data: URL kept.
      expect(adopted.images).toHaveLength(1);
      const [back] = adopted.images;
      expect(Buffer.from(back!.contentBase64, "base64").equals(image)).toBe(true);
      expect(back).toMatchObject({
        filename: "team shot.png",
        contentType: "image/png",
        size,
        cid: "new1@raven.mail",
        width: 560,
      });
      expect(adopted.html).toBe('<p>Look: <img src="cid:new1@raven.mail" alt="team shot.png" width="560"></p>');
      expect(adopted.html).not.toContain("data:");
      expect(draft.text).toBe("Look: [image: team shot.png]");
    });
  }
});
