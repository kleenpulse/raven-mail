/**
 * Download headers for attachment bytes. Pure, so the reader can build links
 * and tests can pin the encoding.
 */

/** IMAP section numbers: "1", "2.1", "3.2.1". */
export const SECTION_RE = /^\d{1,4}(\.\d{1,4}){0,9}$/;

export function attachmentHref(folder: string, uid: string, part: string): string {
  const params = new URLSearchParams({ folder, uid, part });
  return `/api/mail/attachment?${params}`;
}

const MAX_NAME = 200;

/** Control characters, path separators and anything a header or shell would read. */
function cleanFilename(raw: string | undefined): string {
  const chars = [
    ...(raw ?? "")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .replace(/[/\\]/g, "_")
      .trim()
      .replace(/^\.+/, ""),
  ];
  if (chars.length === 0) return "attachment";
  if (chars.length <= MAX_NAME) return chars.join("");
  // Cut the stem, never the extension, or the saved file loses its type.
  const dot = chars.lastIndexOf(".");
  const ext = dot > 0 && chars.length - dot <= 11 ? chars.slice(dot) : [];
  return [...chars.slice(0, MAX_NAME - ext.length), ...ext].join("");
}

// encodeURIComponent leaves these, but RFC 5987 attr-char doesn't allow them.
const encodeExtValue = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** RFC 6266: an ASCII fallback for old clients, then the exact name as RFC 5987 UTF-8. */
export function contentDisposition(filename: string | undefined): string {
  const name = cleanFilename(filename);
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["%;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeExtValue(name)}`;
}

// Anything a browser would run as a document if it ever ignored the disposition.
const ACTIVE = /html|xml|svg|javascript|ecmascript|flash|^multipart\//;

/** The declared type for passive files, octet-stream for active or malformed ones. */
export function safeContentType(contentType: string | undefined, charset?: string): string {
  const type = (contentType ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) || ACTIVE.test(type)) {
    return "application/octet-stream";
  }
  const cs = charset?.trim().toLowerCase();
  return type.startsWith("text/") && cs && /^[a-z0-9_.:-]{1,40}$/.test(cs) ? `${type}; charset=${cs}` : type;
}

export function attachmentHeaders(file: { filename?: string; contentType?: string; charset?: string; size?: number }): Headers {
  const headers = new Headers({
    "Content-Type": safeContentType(file.contentType, file.charset),
    "Content-Disposition": contentDisposition(file.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  });
  if (file.size !== undefined) headers.set("Content-Length", String(file.size));
  return headers;
}
