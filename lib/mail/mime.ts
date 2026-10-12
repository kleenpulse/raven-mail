/**
 * Pure MIME helpers over IMAP BODYSTRUCTURE. Structural type (not imapflow's)
 * so this stays importable from tests and client-safe code.
 */
export type MimeNode = {
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  id?: string;
  encoding?: string;
  size?: number;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  childNodes?: MimeNode[];
};

export type TextPartRef = {
  /** Section to fetch. Single-part bodies are section "1" (RFC 3501) — BINARY[] rejects TEXT. */
  key: string;
  type: "text/plain" | "text/html";
  encoding: string;
  charset: string;
};

function leaves(node: MimeNode, out: MimeNode[] = []): MimeNode[] {
  if (node.childNodes?.length) {
    for (const child of node.childNodes) leaves(child, out);
  } else {
    out.push(node);
  }
  return out;
}

function filenameOf(node: MimeNode): string | undefined {
  return node.dispositionParameters?.filename ?? node.parameters?.name;
}

export function isAttachmentNode(node: MimeNode): boolean {
  if (node.childNodes?.length) return false;
  const type = node.type.toLowerCase();
  const disposition = node.disposition?.toLowerCase();
  if (disposition === "attachment") return true;
  if (type === "message/rfc822") return true;
  // cid-referenced images are part of the body, not attachments
  if (node.id && type.startsWith("image/")) return false;
  if ((type === "text/plain" || type === "text/html") && !filenameOf(node)) return false;
  return Boolean(filenameOf(node));
}

export function hasAttachments(root: MimeNode | undefined): boolean {
  return root ? leaves(root).some(isAttachmentNode) : false;
}

/** Sum of attachment part sizes (transfer-encoded; close enough for storage stats). */
export function attachmentBytes(root: MimeNode | undefined): number {
  if (!root) return 0;
  return leaves(root)
    .filter(isAttachmentNode)
    .reduce((sum, n) => sum + (n.size ?? 0), 0);
}

export function hasCalendarInvite(root: MimeNode | undefined): boolean {
  if (!root) return false;
  return leaves(root).some((n) => {
    const type = n.type.toLowerCase();
    return type === "text/calendar" || type === "application/ics";
  });
}

export function pickTextPart(root: MimeNode | undefined): TextPartRef | null {
  if (!root) return null;
  const candidates = leaves(root).filter(
    (n) => n.disposition?.toLowerCase() !== "attachment" && !filenameOf(n),
  );
  const pick =
    candidates.find((n) => n.type.toLowerCase() === "text/plain") ??
    candidates.find((n) => n.type.toLowerCase() === "text/html");
  if (!pick) return null;
  const single = !root.childNodes?.length;
  return {
    key: single ? "1" : (pick.part ?? "1"),
    type: pick.type.toLowerCase() as TextPartRef["type"],
    encoding: (pick.encoding ?? "7bit").toLowerCase(),
    charset: (pick.parameters?.charset ?? "utf-8").toLowerCase(),
  };
}

/** Decodes a possibly truncated transfer-encoded slice (partial FETCH). */
export function decodeTransfer(input: Uint8Array, encoding: string): Uint8Array {
  const enc = encoding.toLowerCase();
  if (enc === "base64") {
    const clean = Buffer.from(input).toString("latin1").replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), "base64");
  }
  if (enc === "quoted-printable") {
    const text = Buffer.from(input)
      .toString("latin1")
      .replace(/=\r?\n/g, "")
      .replace(/=[0-9A-Fa-f]?$/, "");
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const hex = text.slice(i + 1, i + 3);
      if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(ch.charCodeAt(0) & 0xff);
      }
    }
    return Uint8Array.from(bytes);
  }
  return input;
}

export function decodeCharset(bytes: Uint8Array, charset: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  // A cut multi-byte sequence decodes to U+FFFD at the tail; drop it.
  return decoder.decode(bytes).replace(/�+$/, "");
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  zwnj: "",
  zwj: "",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?(<\/\1>|$)/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Collapses whitespace, drops quoted reply lines, trims to ~200 chars. */
export function toPreview(text: string, max = 200): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join(" ");
  const clean = lines.replace(/[­͏​-‏⁠﻿]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max)}…`;
}

export function previewFromPart(raw: Uint8Array, part: TextPartRef, alreadyDecoded = false): string {
  const bytes = alreadyDecoded ? raw : decodeTransfer(raw, part.encoding);
  const text = decodeCharset(bytes, part.charset);
  return toPreview(part.type === "text/html" ? htmlToText(text) : text);
}
