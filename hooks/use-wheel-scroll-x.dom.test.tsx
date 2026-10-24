import "@/test/dom";
import { describe, expect, test } from "bun:test";

const { renderHook } = await import("@testing-library/react");
const { useWheelScrollX } = await import("./use-wheel-scroll-x");

/** A rail 300px wide holding 900px of tabs. */
function rail(scrollLeft = 0) {
	const el = document.createElement("div");
	Object.defineProperty(el, "clientWidth", { value: 300 });
	Object.defineProperty(el, "scrollWidth", { value: 900 });
	el.scrollLeft = scrollLeft;
	renderHook(() => useWheelScrollX({ current: el }));
	return el;
}

function wheel(el: HTMLElement, init: WheelEventInit) {
	const e = new WheelEvent("wheel", { cancelable: true, ...init });
	// happy-dom's WheelEvent drops modifier keys; browsers keep them.
	if (init.ctrlKey) Object.defineProperty(e, "ctrlKey", { value: true });
	el.dispatchEvent(e);
	return e;
}

describe("useWheelScrollX", () => {
	test("a vertical wheel scrolls the rail sideways", () => {
		const el = rail();
		const e = wheel(el, { deltaY: 100 });
		expect(el.scrollLeft).toBe(100);
		expect(e.defaultPrevented).toBe(true);
	});

	test("line-based wheels move a sensible distance", () => {
		const el = rail();
		wheel(el, { deltaY: 3, deltaMode: 1 });
		expect(el.scrollLeft).toBe(120);
	});

	test("at either end the page keeps the wheel", () => {
		const start = rail(0);
		expect(wheel(start, { deltaY: -100 }).defaultPrevented).toBe(false);
		const end = rail(600);
		expect(wheel(end, { deltaY: 100 }).defaultPrevented).toBe(false);
	});

	test("trackpad sideways swipes and pinch zoom pass through", () => {
		const el = rail(50);
		expect(wheel(el, { deltaX: 40, deltaY: 10 }).defaultPrevented).toBe(false);
		expect(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
		expect(el.scrollLeft).toBe(50);
	});
});
