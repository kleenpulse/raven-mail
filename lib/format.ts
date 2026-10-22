import { format, formatDistanceToNowStrict, isThisYear, isToday, parseISO } from "date-fns";

export function formatListDate(input: string): string {
  const date = parseISO(input);
  if (isToday(date)) return format(date, "HH:mm");
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yyyy");
}

export function formatFullDate(input: string): string {
  const date = parseISO(input);
  return format(date, "MMM d, yyyy 'at' HH:mm");
}

export function formatRelative(input: string): string {
  return formatDistanceToNowStrict(parseISO(input), { addSuffix: true });
}

export function initials(name?: string, address?: string): string {
  const source = name?.trim() || address?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  // By code point, so an emoji or other astral first letter stays whole.
  const first = (s: string) => Array.from(s)[0]!;
  if (parts.length === 1) return first(parts[0]!).toUpperCase();
  return `${first(parts[0]!)}${first(parts[1]!)}`.toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unquote(name: string): string {
  return /^"[\s\S]*"$/.test(name) ? name.slice(1, -1).replace(/\\(.)/g, "$1") : name;
}

/**
 * A To/Cc/Bcc field into addresses. Commas and semicolons separate them,
 * except inside a quoted name (`"Chen, Maya" <maya@x.com>`) or the angle
 * brackets.
 */
export function splitAddressList(raw: string): { name?: string; address: string }[] {
  const out: { name?: string; address: string }[] = [];
  const push = (part: string) => {
    const entry = part.trim();
    if (!entry) return;
    const match = entry.match(/^([\s\S]*?)<([^>]+)>$/);
    if (match) out.push({ name: unquote(match[1]!.trim()) || undefined, address: match[2]!.trim() });
    else out.push({ address: entry });
  };
  let current = "";
  let quoted = false;
  let angle = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quoted && ch === "\\" && i + 1 < raw.length) {
      current += ch + raw[++i];
      continue;
    }
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    else if ((ch === "," || ch === ";") && !quoted && !angle) {
      push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  push(current);
  return out;
}

/** A plausible user@host.tld; anything else gets flagged in the field before sending. */
export function looksLikeAddress(address: string): boolean {
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;.]+$/.test(address);
}

/** One address for a To/Cc field; a name with a separator or quote is quoted so it reads back whole. */
export function formatAddress(a: { name?: string; address: string }): string {
  if (!a.name) return a.address;
  const name = /[,;"<>\\]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, "\\$1")}"` : a.name;
  return `${name} <${a.address}>`;
}
