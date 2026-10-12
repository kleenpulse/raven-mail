import { describe, expect, test } from "bun:test";
import { ago, dayLabel, duration } from "@/components/integrations/time";

// TZ is pinned to UTC by the test preload.
const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("ago", () => {
	test.each([
		[0, "just now"],
		[59_999, "just now"],
		[MIN, "1 min ago"],
		[59 * MIN + 59_000, "59 min ago"],
		[HOUR, "1 h ago"],
		[23 * HOUR + 59 * MIN, "23 h ago"],
		[24 * HOUR, "yesterday"],
		[47 * HOUR + 59 * MIN, "yesterday"],
	])("%p ms ago → %p", (ms, out) => {
		expect(ago(before(ms), NOW)).toBe(out);
	});

	test("future timestamps (clock skew) read as just now", () => {
		expect(ago(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe("just now");
	});

	test("two days or more → a short calendar date", () => {
		const iso = "2026-09-21T09:00:00.000Z";
		const out = ago(iso, NOW);
		expect(out).toBe(new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
		expect(out).toContain("21");
		expect(out).not.toMatch(/ago|yesterday|2026/);
	});
});

describe("dayLabel", () => {
	test.each([
		["2026-09-25T00:00:00.000Z", "Today"],
		["2026-09-25T23:59:00.000Z", "Today"],
		["2026-09-24T23:59:00.000Z", "Yesterday"],
		["2026-09-24T00:00:00.000Z", "Yesterday"],
	])("%s → %s", (iso, out) => {
		expect(dayLabel(iso, NOW)).toBe(out);
	});

	test("goes by calendar day, not 24h windows", () => {
		// Only an hour earlier, but on the previous calendar day.
		expect(dayLabel("2026-09-24T23:30:00.000Z", Date.parse("2026-09-25T00:30:00.000Z"))).toBe("Yesterday");
	});

	test("older days → weekday + date", () => {
		const iso = "2026-09-21T10:00:00.000Z";
		const out = dayLabel(iso, NOW);
		expect(out).toBe(new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
		expect(out).toContain("21");
	});
});

describe("duration", () => {
	test.each([
		[0, "0 ms"],
		[12.4, "12 ms"],
		[999, "999 ms"],
		[1000, "1.0 s"],
		[1450, "1.4 s"],
		[9_999, "10.0 s"],
		[10_000, "10 s"],
		[61_500, "62 s"],
	])("%p → %p", (ms, out) => {
		expect(duration(ms)).toBe(out);
	});
});
