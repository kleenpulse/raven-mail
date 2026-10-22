import { describe, expect, test } from "bun:test";
import { docToText, draftHtml, textToHtml, type DocNode } from "@/lib/mail/rich-text";

const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const t = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text, marks });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });

describe("textToHtml", () => {
  test("a paragraph per line, blank lines kept, HTML escaped", () => {
    expect(textToHtml("Hi <b>&\n\n-- \nSam")).toBe("<p>Hi &lt;b&gt;&amp;</p><p></p><p>-- </p><p>Sam</p>");
  });
});

describe("docToText", () => {
  test("paragraphs round-trip the text compose started with", () => {
    expect(docToText(doc(p(t("Hello")), p(), p(t("-- ")), p(t("Sam"))))).toBe("Hello\n\n-- \nSam");
  });

  test("bold and italic are just text; hard breaks are new lines", () => {
    expect(docToText(doc(p(t("a", [{ type: "bold" }]), { type: "hardBreak" }, t("b", [{ type: "italic" }]))))).toBe("a\nb");
  });

  test("links show their address unless the text is the address", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];
    expect(docToText(doc(p(t("the doc", link("https://x.io/d")), t(" and "), t("https://y.io", link("https://y.io")))))).toBe(
      "the doc <https://x.io/d> and https://y.io",
    );
  });

  test("lists keep bullets and numbers, nested items indent", () => {
    const li = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
    const text = docToText(
      doc(
        { type: "bulletList", content: [li(p(t("one"))), li(p(t("two")), { type: "bulletList", content: [li(p(t("deep")))] })] },
        { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("three"))), li(p(t("four")))] },
      ),
    );
    expect(text).toBe("- one\n- two\n  - deep\n3. three\n4. four");
  });

  test("quotes get '>' and code blocks stay as written", () => {
    expect(
      docToText(
        doc({ type: "blockquote", content: [p(t("said")), p()] }, { type: "codeBlock", content: [t("x = 1\ny = 2")] }),
      ),
    ).toBe("> said\n>\nx = 1\ny = 2");
  });
});

describe("draftHtml", () => {
  test("no HTML written: no HTML part", () => {
    expect(draftHtml({ html: undefined, quote: undefined })).toBeUndefined();
    expect(draftHtml({ html: "<p></p>", quote: undefined })).toBeUndefined();
  });

  test("the editor's trailing empty paragraphs are dropped", () => {
    expect(draftHtml({ html: "<ul><li><p>a</p></li></ul><p></p><p><br></p>", quote: undefined })).toBe("<ul><li><p>a</p></li></ul>");
  });

  test("a reply quotes the original in a blockquote, escaped", () => {
    expect(draftHtml({ html: "<p>Yes</p>", quote: { kind: "reply", header: "On Mon, <a@x> wrote:", body: "Ship?\n<script>" } })).toBe(
      "<p>Yes</p><p>On Mon, &lt;a@x&gt; wrote:</p><blockquote><p>Ship?</p><p>&lt;script&gt;</p></blockquote>",
    );
  });

  test("a forward puts the original under its header", () => {
    expect(draftHtml({ html: "<p>FYI</p>", quote: { kind: "forward", header: "From: A", body: "Hi" } })).toBe(
      "<p>FYI</p><p>From: A</p><p>Hi</p>",
    );
  });
});
