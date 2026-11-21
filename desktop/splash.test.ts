import { describe, expect, test } from "bun:test";
import { RAVEN_GLYPH } from "@/components/shell/raven-mark";
import { isLight, SPLASH_DEFAULTS, SPLASH_STEPS, splashHtml, splashPalette, splashStepScript, splashUrl } from "./splash";

const EMBER_PAGE = { color: "#f3f3f1", symbol: "#55554f" };
const DARK_PAGE = { color: "#101418", symbol: "#c0c8d0" };

describe("splashPalette", () => {
	test("tells light backgrounds from dark ones", () => {
		expect(isLight("#f3f3f1")).toBe(true);
		expect(isLight("#ffffff")).toBe(true);
		expect(isLight("#050a0b")).toBe(false);
		expect(isLight("#000000")).toBe(false);
	});

	test("with nothing saved it is Nebula on the default background", () => {
		expect(splashPalette(null).background).toBe(SPLASH_DEFAULTS.color);
		expect(splashPalette(null).signal).toBe("#e6c27a");
	});

	test("a light page gets Ember, a dark page Nebula, each on the page's own background", () => {
		expect(splashPalette(EMBER_PAGE)).toMatchObject({ background: "#f3f3f1", signal: "#c84e2a", ink: "#111111" });
		expect(splashPalette(DARK_PAGE)).toMatchObject({ background: "#101418", signal: "#e6c27a" });
	});
});

describe("splashHtml", () => {
	const html = splashHtml(splashPalette(null));

	test("loads nothing: there is no server yet to load from", () => {
		expect(html).not.toMatch(/https?:|\bsrc=|\bhref=|url\(|@import/i);
	});

	test("draws the app's own raven glyph", () => {
		expect(html).toContain(`d="${RAVEN_GLYPH}"`);
	});

	test("starts on the first step and knows them all", () => {
		expect(html).toContain(`<div class="step" id="step">${SPLASH_STEPS[0]}</div>`);
		for (const step of SPLASH_STEPS) expect(html).toContain(step);
		expect(html.match(/<i\b/g)).toHaveLength(SPLASH_STEPS.length);
	});

	test("holds still for people who ask for less motion, and can be dragged by its top", () => {
		expect(html).toContain("prefers-reduced-motion:reduce");
		expect(html).toContain("-webkit-app-region:drag");
	});

	test("uses the palette it is given", () => {
		const ember = splashHtml(splashPalette(EMBER_PAGE));
		expect(ember).toContain("background:#f3f3f1");
		expect(ember).toContain("#c84e2a");
		expect(ember).not.toContain("#e6c27a");
	});

	test("the data: URL carries the same page", () => {
		const url = splashUrl(null);
		expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
		expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(html);
	});
});

describe("the start screen's steps", () => {
	/** Runs the page's own script against a stand-in document. */
	function page() {
		const script = /<script>([\s\S]*)<\/script>/.exec(splashHtml(splashPalette(null)))![1]!;
		const classes = (initial = "") => {
			const set = new Set(initial ? [initial] : []);
			return { add: (name: string) => void set.add(name), remove: (name: string) => void set.delete(name), has: (name: string) => set.has(name) };
		};
		const label = { textContent: SPLASH_STEPS[0] as string, classList: classes() };
		const slow = { classList: classes() };
		const bars = SPLASH_STEPS.map((_, i) => ({ className: i === 0 ? "now" : "" }));
		const timers: (() => void)[] = [];
		const document = {
			getElementById: (id: string) => (id === "step" ? label : slow),
			querySelectorAll: () => bars,
		};
		const setTimeout = (run: () => void) => void timers.push(run);
		const setStep = new Function("document", "setTimeout", `${script};return setStep`)(document, setTimeout) as (n: number) => void;
		const flush = () => {
			for (const run of timers.splice(0)) run();
		};
		return { setStep, label, slow, bars, flush };
	}

	test("moves forward: bars fill and the words change", () => {
		const { setStep, label, bars, flush } = page();
		setStep(1);
		flush();
		expect(label.textContent).toBe(SPLASH_STEPS[1]);
		expect(bars.map((bar) => bar.className)).toEqual(["done", "now", ""]);
		setStep(2);
		flush();
		expect(label.textContent).toBe(SPLASH_STEPS[2]);
		expect(bars.map((bar) => bar.className)).toEqual(["done", "done", "now"]);
	});

	test("never goes back, and ignores steps it doesn't have", () => {
		const { setStep, label, bars, flush } = page();
		setStep(2);
		setStep(1);
		setStep(0);
		setStep(7);
		flush();
		expect(label.textContent).toBe(SPLASH_STEPS[2]);
		expect(bars.map((bar) => bar.className)).toEqual(["done", "done", "now"]);
	});

	test("says so when the start is slow", () => {
		const { slow, flush } = page();
		expect(slow.classList.has("on")).toBe(false);
		flush();
		expect(slow.classList.has("on")).toBe(true);
	});

	test("the shell's script is safe on a page without the steps", () => {
		expect(splashStepScript(2)).toBe('typeof setStep==="function"&&setStep(2)');
		expect(new Function(`return ${splashStepScript(1)}`)()).toBe(false);
	});
});
