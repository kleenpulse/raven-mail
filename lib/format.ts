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
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function splitAddressList(raw: string): { name?: string; address: string }[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*?)<([^>]+)>$/);
      if (match) return { name: match[1]?.trim() || undefined, address: match[2]!.trim() };
      return { address: entry };
    });
}
