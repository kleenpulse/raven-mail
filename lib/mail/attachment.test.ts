import { describe, expect, test } from "bun:test";
import {
  attachmentHeaders,
  attachmentHref,
  base64ToBytes,
  bytesToBase64,
  canPreview,
  isMediaType,
  contentDisposition,
  PREVIEW_MAX_BYTES,
  previewType,
  safeContentType,
  SECTION_RE,
} from "@/lib/mail/attachment";

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

describe("previewType", () => {
  test("media and PDF open as themselves", () => {
    expect(previewType("image/png")).toBe("image/png");
    expect(previewType("application/pdf")).toBe("application/pdf");
    expect(previewType("video/mp4")).toBe("video/mp4");
  });

  test.each(["text/html", "image/svg+xml", "text/xml", "application/xml", "application/javascript", "text/plain"])(
    "%s opens as plain text, never rendered",
    (type) => {
      expect(previewType(type)).toBe("text/plain; charset=utf-8");
    },
  );

  test("source files with no useful type still open by extension", () => {
    expect(previewType("application/octet-stream", "AMOLED_Vxrcel.xml")).toBe("text/plain; charset=utf-8");
    expect(previewType("", "notes.MD")).toBe("text/plain; charset=utf-8");
  });

  test("anything else downloads", () => {
    expect(previewType("application/zip", "a.zip")).toBeNull();
    expect(previewType(undefined, "setup.exe")).toBeNull();
    expect(previewType("multipart/mixed")).toBeNull();
  });
});

describe("canPreview", () => {
  test("previewable types open in the page, others download", () => {
    expect(canPreview({ contentType: "image/png", filename: "a.png", size: 10 })).toBe(true);
    expect(canPreview({ contentType: "application/zip", filename: "a.zip", size: 10 })).toBe(false);
  });

  test("the type comes from the metadata and the filename", () => {
    expect(canPreview({ contentType: "application/octet-stream", filename: "AMOLED.xml", size: 10 })).toBe(true);
  });

  test("server files above the limit download, local bytes have no limit", () => {
    const big = { contentType: "video/mp4", filename: "clip.mp4", size: 30 * 1024 * 1024 };
    expect(canPreview(big, { remote: true })).toBe(false);
    expect(canPreview({ ...big, size: PREVIEW_MAX_BYTES }, { remote: true })).toBe(true);
    expect(canPreview(big)).toBe(true);
  });
});

describe("base64ToBytes", () => {
  test("round-trips bytesToBase64", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("bytesToBase64", () => {
  test("matches Buffer for every byte value, across the chunk boundary", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 7 }, (_, i) => (i * 31) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("empty input", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("isMediaType", () => {
  test("images and videos open in the media viewer", () => {
    expect(isMediaType("image/png")).toBe(true);
    expect(isMediaType("video/mp4")).toBe(true);
  });

  test("documents, text, audio and downloads do not", () => {
    expect(isMediaType("application/pdf")).toBe(false);
    expect(isMediaType("audio/mpeg")).toBe(false);
    expect(isMediaType(previewType("image/svg+xml", "logo.svg"))).toBe(false);
    expect(isMediaType(null)).toBe(false);
  });
});
