import { describe, expect, test } from "bun:test";
import {
  attachmentBytes,
  attachmentSections,
  decodeCharset,
  decodeTransfer,
  hasAttachments,
  hasCalendarInvite,
  htmlToText,
  pickTextPart,
  previewFromPart,
  toPreview,
  type MimeNode,
} from "@/lib/mail/mime";

const alternative: MimeNode = {
  type: "multipart/alternative",
  childNodes: [
    { part: "1", type: "text/plain", encoding: "quoted-printable", parameters: { charset: "UTF-8" } },
    { part: "2", type: "text/html", encoding: "base64", parameters: { charset: "utf-8" } },
  ],
};

const invoice: MimeNode = {
  type: "multipart/mixed",
  childNodes: [
    { part: "1", type: "text/html", encoding: "7bit", parameters: { charset: "us-ascii" } },
    {
      part: "2",
      type: "application/pdf",
      encoding: "base64",
      disposition: "attachment",
      dispositionParameters: { filename: "invoice.pdf" },
    },
  ],
};

const related: MimeNode = {
  type: "multipart/related",
  childNodes: [
    alternative,
    { part: "2", type: "image/png", id: "<logo@x>", parameters: { name: "logo.png" }, encoding: "base64" },
  ],
};

describe("structure", () => {
  test("attachment detection", () => {
    expect(hasAttachments(alternative)).toBe(false);
    expect(hasAttachments(invoice)).toBe(true);
    expect(hasAttachments(related)).toBe(false);
    expect(hasAttachments({ type: "application/zip", parameters: { name: "a.zip" } })).toBe(true);
    expect(hasAttachments(undefined)).toBe(false);
  });

  test("calendar invite detection", () => {
    expect(hasCalendarInvite({ type: "multipart/alternative", childNodes: [{ part: "1", type: "text/calendar" }] })).toBe(true);
    expect(hasCalendarInvite(invoice)).toBe(false);
  });

  test("prefers text/plain, falls back to html, single-part uses section 1", () => {
    expect(pickTextPart(alternative)).toEqual({ key: "1", type: "text/plain", encoding: "quoted-printable", charset: "utf-8" });
    expect(pickTextPart(invoice)?.type).toBe("text/html");
    expect(pickTextPart({ type: "text/plain", encoding: "8bit" })?.key).toBe("1");
    expect(pickTextPart({ type: "image/png", parameters: { name: "x.png" } })).toBeNull();
  });
});

describe("attached messages", () => {
  // imapflow nests the inner message's body under the message/rfc822 node.
  const forwarded: MimeNode = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "text/plain", encoding: "7bit" },
      {
        part: "2",
        type: "message/rfc822",
        disposition: "attachment",
        size: 4_000,
        childNodes: [{ part: "2", type: "text/plain", encoding: "7bit" }],
      },
    ],
  };

  test("an attached message is an attachment, even with only text inside", () => {
    expect(hasAttachments(forwarded)).toBe(true);
    expect(attachmentBytes(forwarded)).toBe(4_000);
  });

  test("its inner body is never picked as the preview", () => {
    expect(pickTextPart(forwarded)?.key).toBe("1");
    const onlyForward: MimeNode = { ...forwarded, childNodes: [forwarded.childNodes![1]!] };
    expect(pickTextPart(onlyForward)).toBeNull();
  });

  test("an inline embedded message is body, as mailparser shows it", () => {
    const inline: MimeNode = {
      ...forwarded,
      childNodes: [{ ...forwarded.childNodes![1]!, disposition: "inline" }],
    };
    expect(hasAttachments(inline)).toBe(false);
  });
});

describe("attachmentSections", () => {
  const mixed: MimeNode = {
    type: "multipart/mixed",
    childNodes: [
      {
        part: "1",
        type: "multipart/related",
        childNodes: [
          {
            part: "1.1",
            type: "multipart/alternative",
            childNodes: [
              { part: "1.1.1", type: "text/plain" },
              { part: "1.1.2", type: "text/html" },
            ],
          },
          { part: "1.2", type: "image/png", id: "<logo@x>", parameters: { name: "logo.png" } },
        ],
      },
      { part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "a.pdf" } },
      {
        part: "3",
        type: "application/octet-stream",
        disposition: "attachment",
        dispositionParameters: { filename: "notes.docx" },
      },
      { part: "4", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "b.pdf" } },
      { part: "5", type: "message/rfc822", childNodes: [{ part: "5", type: "text/plain" }] },
    ],
  };

  test("pairs each parsed attachment with its section, nested ones included", () => {
    const parsed = [
      { contentType: "image/png", filename: "logo.png" },
      { contentType: "application/pdf", filename: "a.pdf" },
      // mailparser retypes octet-stream by extension
      { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "notes.docx" },
      { contentType: "application/pdf", filename: "b.pdf" },
      { contentType: "message/rfc822" },
    ];
    expect(attachmentSections(parsed, mixed)).toEqual(["1.2", "2", "3", "4", "5"]);
  });

  test("an unmatched attachment gets no section and doesn't shift the rest", () => {
    const parsed = [
      { contentType: "application/zip", filename: "ghost.zip" },
      { contentType: "application/pdf", filename: "b.pdf" },
    ];
    expect(attachmentSections(parsed, mixed)).toEqual([undefined, "4"]);
  });

  test("never hands out the body text, even to a nameless text attachment", () => {
    const tree: MimeNode = {
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain" },
        { part: "2", type: "text/plain", disposition: "attachment" },
      ],
    };
    expect(attachmentSections([{ contentType: "text/plain" }], tree)).toEqual(["2"]);
  });

  test("a single-part message is section 1", () => {
    const single: MimeNode = { type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "x.pdf" } };
    expect(attachmentSections([{ contentType: "application/pdf", filename: "x.pdf" }], single)).toEqual(["1"]);
  });

  test("no structure, no sections", () => {
    expect(attachmentSections([{ contentType: "application/pdf" }], undefined)).toEqual([undefined]);
  });
});

describe("decoding", () => {
  test("quoted-printable incl. soft breaks and truncated escape", () => {
    const qp = new TextEncoder().encode("Caf=C3=A9 au l=\r\nait =E2=80=94 ok=E");
    expect(decodeCharset(decodeTransfer(qp, "quoted-printable"), "utf-8")).toBe("Café au lait — ok");
  });

  test("truncated base64 and cut multibyte", () => {
    const full = Buffer.from("Hello wörld", "utf-8").toString("base64");
    const cut = new TextEncoder().encode(full.slice(0, full.length - 3));
    expect(decodeCharset(decodeTransfer(cut, "base64"), "utf-8").startsWith("Hello w")).toBe(true);
  });

  test("latin1 charset", () => {
    expect(decodeCharset(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), "iso-8859-1")).toBe("café");
    expect(decodeCharset(new TextEncoder().encode("x"), "bogus-charset")).toBe("x");
  });

  test("html to text", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Hi&nbsp;there</p><p>&amp; welcome&#33;</p></body></html>";
    expect(toPreview(htmlToText(html))).toBe("Hi there & welcome!");
  });

  test("preview drops quoted lines and trims", () => {
    expect(toPreview("Sounds good.\n> On Mon, Maya wrote:\n> old text")).toBe("Sounds good.");
    expect(toPreview("word ".repeat(100)).length).toBeLessThanOrEqual(201);
  });

  test("previewFromPart end to end", () => {
    const raw = new TextEncoder().encode(Buffer.from("<p>Order <b>#9931</b> shipped</p>").toString("base64"));
    expect(previewFromPart(raw, { key: "2", type: "text/html", encoding: "base64", charset: "utf-8" })).toBe(
      "Order #9931 shipped",
    );
  });
});
