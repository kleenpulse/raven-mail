/** Pure timezone helpers: every bin is computed in the viewer's IANA zone, never the server's. */

export type LocalParts = { dateKey: string; hour: number; minute: number; weekday: number };

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function makeLocalizer(tz: string): (epoch: number) => LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const cache = new Map<number, LocalParts>();
  return (epoch) => {
    const key = Math.floor(epoch / 60_000);
    const hit = cache.get(key);
    if (hit) return hit;
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(key * 60_000))) parts[p.type] = p.value;
    const local: LocalParts = {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      weekday: WEEKDAY[parts.weekday ?? "Mon"] ?? 0,
    };
    cache.set(key, local);
    return local;
  };
}

function keyToUtc(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Calendar arithmetic on YYYY-MM-DD — immune to DST because it never touches wall clocks. */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  return new Date(keyToUtc(dateKey) + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

export function dayDiff(fromKey: string, toKey: string): number {
  return Math.round((keyToUtc(toKey) - keyToUtc(fromKey)) / 86_400_000);
}

/** Oldest → newest, ending at `todayKey`. */
export function windowDateKeys(todayKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDateKey(todayKey, i - (days - 1)));
}

export function weekdayOfKey(dateKey: string): number {
  const utcDay = new Date(keyToUtc(dateKey)).getUTCDay(); // 0 = Sunday
  return (utcDay + 6) % 7;
}

export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}
