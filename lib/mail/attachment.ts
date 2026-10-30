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

const VIEWABLE = /^(image\/(?!svg)|audio\/|video\/|application\/pdf$)/;
const SOURCE_TYPE = /xml|html|svg|json|javascript|ecmascript|^text\//;
const SOURCE_EXT = /\.(xml|json|txt|md|csv|log|html?|svg|js|ts|css|ya?ml|ini|conf)$/i;

/**
 * The type to preview a file as, or null to download it.
 * A blob URL shares the app's origin, so anything a browser would run
 * (HTML, SVG, XML) opens as plain text: the user still sees it, nothing executes.
 */
export function previewType(contentType: string | undefined, filename = ""): string | null {
  const safe = safeContentType(contentType);
  if (VIEWABLE.test(safe)) return safe;
  const type = (contentType ?? "").trim().toLowerCase();
  if (SOURCE_TYPE.test(type) || SOURCE_EXT.test(filename)) return "text/plain; charset=utf-8";
  return null;
}

/** Images and videos open in the media viewer; documents, text and audio in the plain preview. */
export function isMediaType(type: string | null): boolean {
  return type !== null && /^(image|video)\//.test(type);
}

/** Above this a server file downloads instead: the preview holds the whole file in memory first. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Whether a file opens in the in-page preview. The type comes from the message's
 * metadata, never the download response, which serves active types as octet-stream.
 * `remote` files are fetched before anything shows, so they get a size limit.
 */
export function canPreview(
  file: { contentType?: string; filename: string; size?: number },
  { remote = false } = {},
): boolean {
  if (previewType(file.contentType, file.filename) === null) return false;
  return !remote || (file.size ?? Infinity) <= PREVIEW_MAX_BYTES;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** btoa over a byte string, in chunks so large files don't overflow the call stack. */
export function bytesToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
