import { describe, expect, test } from "bun:test";
import { DEFAULT_SIZE, parseWindowState, placeWindow, windowStateRecord, type Rect, type WindowState } from "./window-state";

const LAPTOP: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT: Rect = { x: 1920, y: 0, width: 2560, height: 1400 };
const SMALL: Rect = { x: 0, y: 0, width: 1280, height: 680 };

const state = (bounds: Rect, maximized = false): WindowState => ({ bounds, maximized });

describe("parseWindowState", () => {
	test("round-trips a saved record", () => {
		const saved = state({ x: 10, y: 20, width: 1300, height: 900 }, true);
		expect(parseWindowState(windowStateRecord(saved))).toEqual(saved);
	});

	test("rejects missing, broken and nonsense records", () => {
		expect(parseWindowState(null)).toBeNull();
		expect(parseWindowState("{oops")).toBeNull();
		expect(parseWindowState("null")).toBeNull();
		expect(parseWindowState(JSON.stringify({ bounds: { x: 0, y: 0, width: 0, height: 800 } }))).toBeNull();
		expect(parseWindowState(JSON.stringify({ bounds: { x: 0.5, y: 0, width: 1000, height: 800 } }))).toBeNull();
		expect(parseWindowState(JSON.stringify({ bounds: { x: "0", y: 0, width: 1000, height: 800 } }))).toBeNull();
	});

	test("anything but true is not maximized", () => {
		const text = JSON.stringify({ bounds: { x: 0, y: 0, width: 1000, height: 800 }, maximized: "yes" });
		expect(parseWindowState(text)?.maximized).toBe(false);
	});
});

describe("placeWindow", () => {
	test("first launch: default size, centred by Electron", () => {
		expect(placeWindow(null, [LAPTOP])).toEqual({ ...DEFAULT_SIZE, maximized: false });
	});

	test("first launch on a small screen: fits the screen", () => {
		expect(placeWindow(null, [SMALL])).toEqual({ width: 1280, height: 680, maximized: false });
	});

	test("reuses a place that's on a screen", () => {
		const saved = state({ x: 2100, y: 100, width: 1400, height: 1000 }, true);
		expect(placeWindow(saved, [LAPTOP, RIGHT])).toEqual({ x: 2100, y: 100, width: 1400, height: 1000, maximized: true });
	});

	test("monitor unplugged: drops the place, keeps the size and maximized", () => {
		const saved = state({ x: 2100, y: 100, width: 1400, height: 1000 }, true);
		expect(placeWindow(saved, [LAPTOP])).toEqual({ width: 1400, height: 1000, maximized: true });
	});

	test("title bar off the top of every screen: drops the place", () => {
		const saved = state({ x: 100, y: -500, width: 1200, height: 800 });
		expect(placeWindow(saved, [LAPTOP]).x).toBeUndefined();
	});

	test("too big for its screen: shrinks to fit and moves on", () => {
		const saved = state({ x: 200, y: 100, width: 2400, height: 1600 });
		expect(placeWindow(saved, [LAPTOP])).toEqual({ x: 0, y: 0, width: 1920, height: 1040, maximized: false });
	});

	test("spills over the right edge: pulled fully on", () => {
		const saved = state({ x: 1500, y: 50, width: 1200, height: 800 });
		expect(placeWindow(saved, [LAPTOP])).toEqual({ x: 720, y: 50, width: 1200, height: 800, maximized: false });
	});

	test("never smaller than the minimum when the screen has room", () => {
		const saved = state({ x: 10, y: 10, width: 400, height: 300 });
		expect(placeWindow(saved, [LAPTOP])).toMatchObject({ width: 900, height: 600 });
	});

	test("works with screens left of or above the primary", () => {
		const left: Rect = { x: -1920, y: -200, width: 1920, height: 1080 };
		const saved = state({ x: -1800, y: -150, width: 1200, height: 800 });
		expect(placeWindow(saved, [LAPTOP, left])).toEqual({ x: -1800, y: -150, width: 1200, height: 800, maximized: false });
	});
});
