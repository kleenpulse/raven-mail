import { describe, expect, test } from "bun:test";
import { attachmentHeaders, attachmentHref, contentDisposition, safeContentType, SECTION_RE } from "@/lib/mail/attachment";

/** The RFC 5987 value, decoded the way a browser would. */
const extName = (header: string) => decodeURIComponent(header.split("filename*=UTF-8''")[1]!);
const asciiName = (header: string) => header.match(/filename="([^"]*)"/)![1];

describe("contentDisposition", () => {
  test("plain ASCII keeps its name in both forms", () => {
    expect(contentDisposition("invoice-1842.pdf")).toBe(
      `attachment; filename="invoice-1842.pdf"; filename*=UTF-8''invoice-1842.pdf`,
    );
  });

  test("unicode survives in filename*, with an ASCII fallback", () => {
    const header = contentDisposition("Résumé – 2026 📎.pdf");
    expect(extName(header)).toBe("Résumé – 2026 📎.pdf");
    expect(asciiName(header)).toMatch(/^[\x20-\x7e]+$/);
    expect(asciiName(header)!.endsWith(".pdf")).toBe(true);
  });

  test("encodes the characters encodeURIComponent leaves but attr-char forbids", () => {
    const header = contentDisposition("it's (final)*.txt");
    expect(header).toContain("it%27s%20%28final%29%2A.txt");
    expect(extName(header)).toBe("it's (final)*.txt");
  });

  test("quotes, semicolons and backslashes can't break out of the quoted fallback", () => {
    const header = contentDisposition('a"; filename="evil.html');
    // One quoted value, then one token: nothing escapes into a second parameter.
    expect(header).toMatch(/^attachment; filename="[^"\\;]*"; filename\*=UTF-8''[A-Za-z0-9%!._~-]+$/);
    expect(extName(header)).toBe('a"; filename="evil.html');
  });

  test("CRLF and control characters are dropped, so no header injection", () => {
    const header = contentDisposition("a.txt\r\nSet-Cookie: x=1\u0000");
    expect(header).not.toMatch(/[\r\n\0]/);
  });

  test("path separators and leading dots can't name a path", () => {
    expect(asciiName(contentDisposition("../../etc/passwd"))).toBe("_.._etc_passwd");
    expect(asciiName(contentDisposition("C:\\Windows\\x.exe"))).toBe("C:_Windows_x.exe");
    expect(asciiName(contentDisposition(".bashrc"))).toBe("bashrc");
  });

  test("empty or missing names fall back to 'attachment'", () => {
    expect(asciiName(contentDisposition(undefined))).toBe("attachment");
    expect(asciiName(contentDisposition("  "))).toBe("attachment");
    expect(asciiName(contentDisposition("\r\n"))).toBe("attachment");
  });

  test("very long names are capped, keeping the extension", () => {
    const name = extName(contentDisposition(`${"a".repeat(500)}.pdf`));
    expect(name.length).toBe(200);
    expect(name.endsWith("a.pdf")).toBe(true);
  });

  test("the cap counts characters, so emoji aren't split into broken halves", () => {
    const name = extName(contentDisposition(`${"📎".repeat(300)}.docx`));
    expect([...name]).toHaveLength(200);
    expect(name.endsWith("📎.docx")).toBe(true);
  });

  test("a long 'extension' isn't one, so the plain cap applies", () => {
    const name = extName(contentDisposition(`report.${"x".repeat(300)}`));
    expect(name).toBe(`report.${"x".repeat(193)}`);
  });
});

describe("safeContentType", () => {
  test.each(["text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/javascript", "multipart/mixed"])(
    "%s is served as octet-stream",
    (type) => {
      expect(safeContentType(type)).toBe("application/octet-stream");
    },
  );

  test("passive types keep their declared type", () => {
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(safeContentType("IMAGE/PNG")).toBe("image/png");
  });

  test("malformed or missing types fall back", () => {
    expect(safeContentType(undefined)).toBe("application/octet-stream");
    expect(safeContentType("pdf")).toBe("application/octet-stream");
    expect(safeContentType("text/plain\r\nX-Evil: 1")).toBe("application/octet-stream");
  });

  test("charset only on text, and only when it looks like one", () => {
    expect(safeContentType("text/plain", "UTF-8")).toBe("text/plain; charset=utf-8");
    expect(safeContentType("application/pdf", "utf-8")).toBe("application/pdf");
    expect(safeContentType("text/plain", "utf-8; x=1")).toBe("text/plain");
  });
});

describe("attachmentHeaders", () => {
  test("always a download, never sniffed or rendered", () => {
    const headers = attachmentHeaders({ filename: "board.svg", contentType: "image/svg+xml", size: 42 });
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("content-disposition")!.startsWith("attachment;")).toBe(true);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toContain("sandbox");
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("content-length")).toBe("42");
  });

  test("no Content-Length when the decoded size isn't known", () => {
    expect(attachmentHeaders({ filename: "a.pdf" }).has("content-length")).toBe(false);
  });
});

describe("links", () => {
  test("href encodes folder names", () => {
    expect(attachmentHref("Work/Q3 & Q4", "12", "2.1")).toBe("/api/mail/attachment?folder=Work%2FQ3+%26+Q4&uid=12&part=2.1");
  });

  test("section pattern", () => {
    for (const ok of ["1", "2", "2.1", "3.2.1"]) expect(SECTION_RE.test(ok)).toBe(true);
    for (const bad of ["", "TEXT", "1.MIME", "2.", ".2", "1..2", "-1", "2 1", "1".repeat(5)]) {
      expect(SECTION_RE.test(bad)).toBe(false);
    }
  });
});
