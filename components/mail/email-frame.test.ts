import { describe, expect, test } from "bun:test";
import { frameMode, hasNativeDark } from "@/components/mail/email-frame";

const NEWSLETTER = '<table bgcolor="#ffffff"><tr><td>News</td></tr></table>';
const DARK_AWARE = `<style>@media (prefers-color-scheme: dark){body{background:#000}}</style>${NEWSLETTER}`;

describe("hasNativeDark", () => {
	test("spots dark media queries, Outlook's data-ogsc and color-scheme", () => {
		expect(hasNativeDark(DARK_AWARE)).toBe(true);
		expect(hasNativeDark('<style>[data-ogsc] .t{color:#fff}</style>')).toBe(true);
		expect(hasNativeDark('<div style="color-scheme: light dark">')).toBe(true);
	});

	test("ignores mail without a dark look", () => {
		expect(hasNativeDark(NEWSLETTER)).toBe(false);
		expect(hasNativeDark('<div style="color-scheme: light">')).toBe(false);
	});
});

describe("frameMode", () => {
	test("plain mail always takes the skin", () => {
		expect(frameMode("<p>hi</p>", { designed: false, dark: true, forceDark: true })).toBe("themed");
	});

	test("designed mail stays on paper in light, or with force dark off", () => {
		expect(frameMode(NEWSLETTER, { designed: true, dark: false, forceDark: true })).toBe("paper");
		expect(frameMode(NEWSLETTER, { designed: true, dark: true, forceDark: false })).toBe("paper");
	});

	test("force dark prefers the mail's own dark look over the filter", () => {
		expect(frameMode(DARK_AWARE, { designed: true, dark: true, forceDark: true })).toBe("native");
		expect(frameMode(NEWSLETTER, { designed: true, dark: true, forceDark: true })).toBe("inverted");
	});
});
