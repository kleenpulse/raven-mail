import { describe, expect, test } from "bun:test";
import { formatAge, formatBytes, formatDuration, mailLink, plural } from "@/lib/jev/ask/format";

describe("plural", () => {
	test("one vs many, with an irregular many", () => {
		expect(plural(1, "email")).toBe("email");
		expect(plural(0, "email")).toBe("emails");
		expect(plural(2, "email")).toBe("emails");
		expect(plural(2, "reply", "replies")).toBe("replies");
		expect(plural(1, "reply", "replies")).toBe("reply");
	});
});

describe("formatAge (hours)", () => {
	test.each([
		[0, "1m"],
		[0.001, "1m"],
		[0.5, "30m"],
		[1, "1h"],
		[5.4, "5h"],
		[47, "47h"],
		[48, "2d"],
		[72, "3d"],
		[24 * 10.4, "10d"],
	])("%p → %p", (hours, out) => {
		expect(formatAge(hours)).toBe(out);
	});
});

describe("formatDuration (minutes)", () => {
	test.each([
		[null, "—"],
		[0, "1m"],
		[0.2, "1m"],
		[45, "45m"],
		[60, "1h"],
		[90, "1h 30m"],
		[125, "2h 5m"],
		[48 * 60 - 1, "47h 59m"],
		[48 * 60, "2d"],
		[1440 * 5, "5d"],
	])("%p → %p", (minutes, out) => {
		expect(formatDuration(minutes)).toBe(out);
	});

	// BUG (latent): the minutes remainder is rounded after the hour is floored, so
	// 119.6 → "1h 60m" (and 59.6 → "60m"). Current callers pass whole minutes, but
	// formatDuration(baselineHours * 60) in retrieve.ts can carry float noise.
	test.todo("BUG: rounding carries into the hour (119.6 → '2h', not '1h 60m')", () => {
		expect(formatDuration(119.6)).toBe("2h");
		expect(formatDuration(59.6)).toBe("1h");
	});
});

describe("formatBytes", () => {
	test.each([
		[0, "0 B"],
		[1023, "1023 B"],
		[1024, "1 KB"],
		[90_000, "88 KB"],
		[1024 ** 2, "1.0 MB"],
		[5.25 * 1024 ** 2, "5.3 MB"],
		[1024 ** 3, "1.0 GB"],
		[1.5 * 1024 ** 3, "1.5 GB"],
	])("%p → %p", (bytes, out) => {
		expect(formatBytes(bytes)).toBe(out);
	});
});

describe("mailLink", () => {
	test("folder + uid", () => {
		expect(mailLink({ folder: "INBOX", uid: "42" })).toBe("/mail?folder=INBOX&uid=42");
	});

	test("encodes folder paths and message ids", () => {
		const link = mailLink({ folder: "[Gmail]/Sent Mail", uid: "7", messageId: "<a+b@x.example>" });
		expect(link).toBe("/mail?folder=%5BGmail%5D%2FSent+Mail&uid=7&mid=%3Ca%2Bb%40x.example%3E");
		const params = new URL(link, "http://x").searchParams;
		expect(params.get("folder")).toBe("[Gmail]/Sent Mail");
		expect(params.get("mid")).toBe("<a+b@x.example>");
	});

	test("an empty messageId is omitted", () => {
		expect(mailLink({ folder: "INBOX", uid: "1", messageId: "" })).toBe("/mail?folder=INBOX&uid=1");
	});
});
