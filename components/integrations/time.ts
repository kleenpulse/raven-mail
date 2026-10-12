/** "just now" · "4 min ago" · "3 h ago" · "yesterday" · "Sep 21" — `now` from useNow(). */
export function ago(iso: string, now: number): string {
	const diff = Math.max(0, now - Date.parse(iso));
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	if (hours < 48) return "yesterday";
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Day heading for grouped activity: Today / Yesterday / Mon, Sep 21. */
export function dayLabel(iso: string, now: number): string {
	const day = new Date(iso);
	const today = new Date(now);
	const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const delta = Math.round((start(today) - start(day)) / 86_400_000);
	if (delta === 0) return "Today";
	if (delta === 1) return "Yesterday";
	return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function duration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
