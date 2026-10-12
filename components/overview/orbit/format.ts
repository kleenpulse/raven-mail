import type { SenderStat, ThreadRef } from "@/lib/insights/types";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const NUMBER = new Intl.NumberFormat("en-US");

/** Locale-pinned so server and client render the same digits. */
export function formatCount(n: number): string {
	return NUMBER.format(Math.round(n));
}

/** 130 → "2h 10m", 45 → "45m", 1680 → "1d 4h", null → "—". */
export function formatDuration(minutes: number | null | undefined): string {
	if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return "—";
	if (minutes < 1) return "<1m";
	const total = Math.round(minutes);
	if (total < 60) return `${total}m`;
	if (total < 1440) {
		const h = Math.floor(total / 60);
		const m = total % 60;
		return m ? `${h}h ${m}m` : `${h}h`;
	}
	const d = Math.floor(total / 1440);
	const h = Math.round((total % 1440) / 60);
	return h ? `${d}d ${h}h` : `${d}d`;
}

/** Compact age for thread rows: "12m", "3h", "2d", "5w". */
export function formatAge(hours: number): string {
	if (!Number.isFinite(hours) || hours < 0) return "—";
	if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
	if (hours < 24) return `${Math.round(hours)}h`;
	const days = hours / 24;
	if (days < 14) return `${Math.round(days)}d`;
	return `${Math.round(days / 7)}w`;
}

/** "just now", "12m ago", "3h ago", "2d ago", "3w ago". */
export function formatAgo(iso: string, now: number): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "—";
	const diff = Math.max(0, now - t);
	if (diff < MINUTE) return "just now";
	return `${formatAge(diff / HOUR)} ago`;
}

/** Long form for screen readers: "3 hours ago". */
export function formatAgoLong(iso: string, now: number): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "unknown";
	const diff = Math.max(0, now - t);
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	if (diff < MINUTE) return "just now";
	if (diff < HOUR) return plural(Math.round(diff / MINUTE), "minute");
	if (diff < DAY) return plural(Math.round(diff / HOUR), "hour");
	if (diff < 14 * DAY) return plural(Math.round(diff / DAY), "day");
	return plural(Math.round(diff / (7 * DAY)), "week");
}

/** Wall-clock time at a fixed UTC offset: (now, 60) → "11:40 pm". */
export function formatClock(epochMs: number, offsetMin: number): string {
	const d = new Date(epochMs + offsetMin * MINUTE);
	const h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function localHour(epochMs: number, offsetMin: number): number {
	return new Date(epochMs + offsetMin * MINUTE).getUTCHours();
}

/** 60 → "UTC+1", -210 → "UTC−3:30", 0 → "UTC". */
export function formatUtcOffset(offsetMin: number): string {
	if (!offsetMin) return "UTC";
	const sign = offsetMin > 0 ? "+" : "−";
	const abs = Math.abs(offsetMin);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Tone of someone's local hour, for the "their local time" readout. */
export function dayPart(hour: number): "night" | "morning" | "working" | "evening" {
	if (hour >= 21 || hour < 7) return "night";
	if (hour < 9) return "morning";
	if (hour < 18) return "working";
	return "evening";
}

/** "Tue, Sep 23 · 2:05 pm" in the viewer's own clock. */
export function formatStamp(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
	const h = d.getHours();
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${day} · ${h12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function displayName(sender: Pick<SenderStat, "name" | "address">): string {
	const name = sender.name?.trim();
	if (name) return name;
	return sender.address.split("@")[0] || sender.address;
}

/** People get addressed by first name; services keep their full name. */
export function firstName(sender: Pick<SenderStat, "name" | "address" | "bucket">): string {
	const name = displayName(sender);
	if (sender.bucket !== "people") return name;
	return name.split(/\s+/)[0] || name;
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

/** Deep link into Mail for one message. */
export function threadHref(ref: Pick<ThreadRef, "folder" | "uid" | "messageId">): string {
	const base = `/mail?folder=${encodeURIComponent(ref.folder)}&uid=${encodeURIComponent(ref.uid)}`;
	return ref.messageId ? `${base}&mid=${encodeURIComponent(ref.messageId)}` : base;
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${formatCount(n)} ${n === 1 ? one : many}`;
}
