import type { ComposeDraft } from "@/lib/mail/types";
import { escapeHtml } from "@/lib/mail/rich-text";
import { MAX_FILES, SEND_LIMITS } from "@/lib/mail/send-limits";

/*
 * Images inside the compose body. The editor's HTML only ever holds
 * `<img src="cid:…">`; the bytes sit with the other attachments, marked by the
 * same `cid`. Pure, so the rules are tested without an editor or a browser.
 */

type OutgoingFile = NonNullable<ComposeDraft["attachments"]>[number];

/** Image types mail clients show inline. Anything else is a normal attachment. */
export const INLINE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function isInlineType(contentType: string): boolean {
  return (INLINE_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/** Files, HTML and text of one send may add up to this many bytes (see send-limits.ts). */
export const PAYLOAD_BUDGET = Number(process.env.SEND_BUDGET_BYTES) || SEND_LIMITS.selfHosted.budget;

/** Addresses, subject and the request's own framing. */
const OVERHEAD = 16_384;

/** A Content-ID for a new inline image. getRandomValues, as randomUUID is missing on plain-http installs. */
export function newCid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}@raven.mail`;
}

// The editor writes these tags itself: attributes are double-quoted, and every way an
// alt gets in goes through plainName, so no value holds a ">" or a quote.
const IMG_TAG = /<img\b[^>]*>/g;
const CID_SRC = /\bsrc="cid:([^"]+)"/;

/** The cids the body's images point at. */
export function usedCids(html: string): Set<string> {
  const cids = new Set<string>();
  for (const tag of html.match(IMG_TAG) ?? []) {
    const cid = CID_SRC.exec(tag)?.[1];
    if (cid) cids.add(cid);
  }
  return cids;
}

/** What would be sent now: every plain file, and the inline images the body still shows. */
export function liveAttachments<T extends { cid?: string }>(html: string, attachments: T[]): T[] {
  const used = usedCids(html);
  return attachments.filter((a) => !a.cid || used.has(a.cid));
}

/**
 * The body and files as they go out: images whose bytes are gone are taken out
 * of the HTML, and inline images deleted from the body are left out of the
 * files. Returns new values; compose keeps its own, so undo can bring a
 * deleted image back.
 */
export function pruneInline<T extends { cid?: string }>(html: string, attachments: T[]): { html: string; attachments: T[] } {
  const known = new Set(attachments.flatMap((a) => (a.cid ? [a.cid] : [])));
  const kept = html.replace(IMG_TAG, (tag) => {
    const cid = CID_SRC.exec(tag)?.[1];
    return cid && !known.has(cid) ? "" : tag;
  });
  return { html: kept, attachments: liveAttachments(kept, attachments) };
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** Bytes a send or save puts in its request: the files as base64, the HTML and the text. */
export function payloadSize(draft: Pick<ComposeDraft, "text" | "html" | "attachments">): number {
  const files = (draft.attachments ?? []).reduce((n, a) => n + a.contentBase64.length, 0);
  return files + utf8Length(draft.html ?? "") + utf8Length(draft.text) + OVERHEAD;
}

/** About how many megabytes of files fit in one message. */
export function fileAllowanceMb(budget = PAYLOAD_BUDGET): number {
  return Math.floor((budget * 3) / 4 / (1024 * 1024));
}

/** Why this message can't go as it is, in words for a toast; null when it can. */
export function sendProblem(
  draft: Pick<ComposeDraft, "text" | "html" | "attachments">,
  budget = PAYLOAD_BUDGET,
): string | null {
  if ((draft.attachments?.length ?? 0) > MAX_FILES) {
    return `A message can hold up to ${MAX_FILES} files. Remove some and try again.`;
  }
  if (payloadSize(draft) > budget) {
    return `This message is too big to send. Its files can add up to about ${fileAllowanceMb(budget)} MB.`;
  }
  return null;
}

export type RejectReason = "empty" | "count" | "size";

/**
 * Which of the new files fit. Counts only what would be sent now, so an image
 * pasted and then deleted from the body doesn't use up the allowance.
 */
export function planFiles<F extends { name: string; size: number; type: string }>(
  files: F[],
  current: { html: string; text: string; attachments: (OutgoingFile & { cid?: string })[] },
  budget = PAYLOAD_BUDGET,
): { accepted: F[]; rejected: { name: string; reason: RejectReason }[] } {
  const live = liveAttachments(current.html, current.attachments);
  let count = live.length;
  let used = payloadSize({ html: current.html, text: current.text, attachments: live });
  const accepted: F[] = [];
  const rejected: { name: string; reason: RejectReason }[] = [];
  for (const file of files) {
    // A clipboard can hand over an image with nothing in it.
    if (file.size === 0 && file.type.startsWith("image/")) rejected.push({ name: file.name, reason: "empty" });
    else if (count >= MAX_FILES) rejected.push({ name: file.name, reason: "count" });
    else if (used + base64Length(file.size) > budget) rejected.push({ name: file.name, reason: "size" });
    else {
      accepted.push(file);
      count += 1;
      used += base64Length(file.size);
    }
  }
  return { accepted, rejected };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Text safe to sit in an `alt` attribute and a filename: the editor's HTML is matched tag by tag. */
export function plainName(name: string): string {
  return name.replace(/[<>"\r\n\\/]/g, "").trim().slice(0, 200);
}

/** Every clipboard screenshot arrives as "image.png"; give it a name that says when it was pasted. */
export function pastedName(file: { name: string; type: string }, now = new Date()): string {
  const name = plainName(file.name);
  if (name && !/^image\.\w+$/i.test(name)) return name;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-image-${day}-${time}.${EXTENSION[file.type.toLowerCase()] ?? "png"}`;
}

export type AdoptedImage = {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
  cid: string;
  width?: number;
};

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** One double-quoted attribute of a tag, or undefined. */
function attribute(tag: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const start = tag.indexOf(key);
  if (start === -1) return undefined;
  const from = start + key.length;
  const end = tag.indexOf('"', from);
  return end === -1 ? undefined : tag.slice(from, end);
}

/** Where the tag opening at `start` closes: the first ">" outside a quoted value. */
function tagEnd(html: string, start: number): number {
  let pos = start;
  let close = html.indexOf(">", pos);
  while (close !== -1) {
    const quote = html.indexOf('"', pos);
    if (quote === -1 || quote > close) return close;
    const endQuote = html.indexOf('"', quote + 1);
    if (endQuote === -1) return -1;
    pos = endQuote + 1;
    if (close < pos) close = html.indexOf(">", pos);
  }
  return -1;
}

/**
 * A saved draft read back from the server carries its inline images as data:
 * URLs. Turn each into a `cid:` image plus its bytes, as compose holds them;
 * the `alt` (the filename) and `width` stay. data: images of other types are
 * dropped, so none is left in the HTML. Walks the string once: it can be
 * many megabytes.
 */
export function adoptDataImages(html: string, makeCid: () => string = newCid): { html: string; images: AdoptedImage[] } {
  const images: AdoptedImage[] = [];
  let out = "";
  let pos = 0;
  for (;;) {
    const start = html.indexOf("<img", pos);
    const end = start === -1 ? -1 : tagEnd(html, start);
    if (start === -1 || end === -1) break;
    out += html.slice(pos, start);
    pos = end + 1;
    const tag = html.slice(start, pos);
    const src = attribute(tag, "src") ?? "";
    if (!src.startsWith("data:")) {
      out += tag;
      continue;
    }
    const comma = src.indexOf(",");
    const [contentType = "", encoding] = src.slice(5, Math.max(comma, 5)).toLowerCase().split(";");
    if (comma === -1 || encoding !== "base64" || !isInlineType(contentType)) continue;
    const contentBase64 = src.slice(comma + 1);
    const padding = contentBase64.endsWith("==") ? 2 : contentBase64.endsWith("=") ? 1 : 0;
    const alt = plainName(unescapeHtml(attribute(tag, "alt") ?? ""));
    const width = Number.parseInt(attribute(tag, "width") ?? "", 10);
    const extension = EXTENSION[contentType] ?? "png";
    // Another mail client's draft can describe the picture ("Team photo") rather than name a file.
    const named = !alt || /\.\w{1,5}$/.test(alt) ? alt : `${alt}.${extension}`;
    const image: AdoptedImage = {
      filename: named || `image-${images.length + 1}.${extension}`,
      contentType,
      contentBase64,
      size: Math.max(0, (contentBase64.length / 4) * 3 - padding),
      cid: makeCid(),
      ...(width > 0 ? { width } : {}),
    };
    images.push(image);
    out += `<img src="cid:${image.cid}" alt="${escapeHtml(image.filename)}"${width > 0 ? ` width="${width}"` : ""}>`;
  }
  return { html: out + html.slice(pos), images };
}
