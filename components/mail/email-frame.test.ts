import { describe, expect, test } from "bun:test";
import { frameMode, hasNativeDark, luminance } from "@/components/mail/email-frame";

const NEWSLETTER = '<table bgcolor="#ffffff"><tr><td>News</td></tr></table>';
const DARK_AWARE = `<style>@media (prefers-color-scheme: dark){body{background:#000}}</style>${NEWSLETTER}`;

describe("hasNativeDark", () => {
	test("spots dark media queries", () => {
		expect(hasNativeDark(DARK_AWARE)).toBe(true);
	});

	test("ignores hints that can't restyle mail in a browser", () => {
		expect(hasNativeDark(NEWSLETTER)).toBe(false);
		// Outlook.com-only rules and bare declarations leave the white panels white.
		expect(hasNativeDark('<style>[data-ogsc] .t{color:#fff}</style>')).toBe(false);
		expect(hasNativeDark('<div style="color-scheme: light dark">')).toBe(false);
	});
});

describe("luminance", () => {
	test("reads computed rgb and rgba colours", () => {
		expect(luminance("rgb(0, 0, 0)")).toBe(0);
		expect(luminance("rgb(255, 255, 255)")).toBeCloseTo(1);
		expect(luminance("rgba(17, 17, 17, 0.5)")!).toBeLessThan(0.4);
		expect(luminance("rgb(234 242 241)")!).toBeGreaterThan(0.4);
		expect(luminance("transparent")).toBeNull();
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
