import { describe, expect, test } from "bun:test";
import {
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
