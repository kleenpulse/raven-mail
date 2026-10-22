import { beforeEach, describe, expect, test, setSystemTime } from "bun:test";
import { formatAddress, formatBytes, formatFullDate, formatListDate, formatRelative, initials, splitAddressList } from "@/lib/format";

// Friday, 25 Sep 2026, 12:00 UTC (the preload pins TZ=UTC).
const NOW = new Date("2026-09-25T12:00:00.000Z");

beforeEach(() => {
	setSystemTime(NOW);
});

describe("formatListDate", () => {
	test.each([
		["2026-09-25T09:05:00Z", "09:05"],
		["2026-09-25T00:00:00Z", "00:00"],
		["2026-09-25T23:59:00Z", "23:59"],
		["2026-09-24T23:59:00Z", "Sep 24"],
		["2026-01-01T00:00:00Z", "Jan 1"],
		["2025-12-31T23:59:00Z", "Dec 31, 2025"],
		["2027-02-03T10:00:00Z", "Feb 3, 2027"],
	])("%s → %s", (input, out) => {
		expect(formatListDate(input)).toBe(out);
	});

	test("an offset date is shown in local (UTC) time", () => {
		expect(formatListDate("2026-09-25T08:30:00+02:00")).toBe("06:30");
	});
});

describe("formatFullDate", () => {
	test.each([
		["2026-09-25T09:05:00Z", "Sep 25, 2026 at 09:05"],
		["2020-02-29T18:45:00Z", "Feb 29, 2020 at 18:45"],
	])("%s → %s", (input, out) => {
		expect(formatFullDate(input)).toBe(out);
	});
});

describe("formatRelative", () => {
	test.each([
		["2026-09-25T11:59:30Z", "30 seconds ago"],
		["2026-09-25T11:55:00Z", "5 minutes ago"],
		["2026-09-25T09:00:00Z", "3 hours ago"],
		["2026-09-23T12:00:00Z", "2 days ago"],
		["2025-09-25T12:00:00Z", "1 year ago"],
		["2026-09-25T13:00:00Z", "in 1 hour"],
	])("%s → %s", (input, out) => {
		expect(formatRelative(input)).toBe(out);
	});
});

describe("initials", () => {
	test.each([
		["Maya Chen", undefined, "MC"],
		["maya chen", undefined, "MC"],
		["  Maya   Van Der Berg ", undefined, "MV"],
		["Maya", undefined, "M"],
		["Émile Zola", undefined, "ÉZ"],
		[undefined, "maya.chen@x.com", "MC"],
		[undefined, "maya_chen@x.com", "MC"],
		[undefined, "maya-chen@x.com", "MC"],
		[undefined, "maya@x.com", "M"],
		["   ", "sam.okafor@x.com", "SO"],
		["", "", "?"],
		[undefined, undefined, "?"],
		[undefined, "@x.com", "?"],
		["---", undefined, "?"],
		["...", "a@b.c", "?"],
	])("(%p, %p) → %p", (name, address, out) => {
		expect(initials(name, address)).toBe(out);
	});

	// Regression: the first letter was a UTF-16 code unit, so an emoji-led name rendered a
	// lone surrogate in the avatar.
	test("keeps astral characters whole (emoji-led display names)", () => {
		expect(initials("😀 Smile")).toBe("😀S");
		expect(initials("𠮷田")).toBe("𠮷");
	});
});

describe("formatBytes", () => {
	test.each([
		[0, "0 B"],
		[1023, "1023 B"],
		[1024, "1.0 KB"],
		[1536, "1.5 KB"],
		[48_211, "47.1 KB"],
		[1024 * 1024, "1.0 MB"],
		[5.5 * 1024 * 1024, "5.5 MB"],
		[3 * 1024 ** 3, "3072.0 MB"],
	])("%p → %p", (bytes, out) => {
		expect(formatBytes(bytes)).toBe(out);
	});
});

describe("splitAddressList", () => {
	test("plain, named, comma and semicolon separated, blanks dropped", () => {
		expect(splitAddressList(" a@x.com, Maya Chen <maya@x.com>;b@y.org ;, ")).toEqual([
			{ address: "a@x.com" },
			{ name: "Maya Chen", address: "maya@x.com" },
			{ address: "b@y.org" },
		]);
	});

	test("bare angle address has no name", () => {
		expect(splitAddressList("<a@x.com>")).toEqual([{ name: undefined, address: "a@x.com" }]);
	});

	test("trims inside the brackets", () => {
		expect(splitAddressList("Sam < sam@x.com >")).toEqual([{ name: "Sam", address: "sam@x.com" }]);
	});

	test("empty input", () => {
		expect(splitAddressList("")).toEqual([]);
		expect(splitAddressList(" , ; ")).toEqual([]);
	});

	test("text without a closing bracket is taken as-is", () => {
		expect(splitAddressList("Sam <sam@x.com")).toEqual([{ address: "Sam <sam@x.com" }]);
	});

	// Regression: every comma split, so a quoted "Last, First" display name (common from
	// Exchange directories) became two bogus recipients, and reply-all to such a sender
	// got a recipient called "Chen". smtp.ts and dev-store.ts now share this parser.
	test("keeps a quoted display name containing a comma together", () => {
		expect(splitAddressList(`"Chen, Maya" <maya@x.com>, b@y.org`)).toEqual([
			{ name: "Chen, Maya", address: "maya@x.com" },
			{ address: "b@y.org" },
		]);
	});

	test("semicolons and escaped quotes inside a quoted name, emoji names", () => {
		expect(splitAddressList(`"Ops; Night \\"Owl\\"" <ops@x.com>; 🦉 Owl <owl@x.com>`)).toEqual([
			{ name: 'Ops; Night "Owl"', address: "ops@x.com" },
			{ name: "🦉 Owl", address: "owl@x.com" },
		]);
	});
});

describe("formatAddress", () => {
	test("plain names stay plain; bare addresses stay bare", () => {
		expect(formatAddress({ name: "Maya Chen", address: "maya@x.com" })).toBe("Maya Chen <maya@x.com>");
		expect(formatAddress({ address: "a@x.com" })).toBe("a@x.com");
	});

	test("a name with a separator or quote is quoted, and reads back whole", () => {
		const list = [
			{ name: "Chen, Maya", address: "maya@x.com" },
			{ name: 'Ops; Night "Owl"', address: "ops@x.com" },
			{ name: "Back\\slash", address: "b@x.com" },
		];
		const field = list.map(formatAddress).join(", ");
		expect(field).toBe(`"Chen, Maya" <maya@x.com>, "Ops; Night \\"Owl\\"" <ops@x.com>, "Back\\\\slash" <b@x.com>`);
		expect(splitAddressList(field)).toEqual(list);
	});
});
