import { describe, expect, test } from "bun:test";
import { getCenteredRect, toRect } from "./fit-rect";

const viewport = { viewportWidth: 1000, viewportHeight: 800, padding: 50 };

describe("getCenteredRect", () => {
	test("a landscape image fills the padded width and centers vertically", () => {
		expect(getCenteredRect({ ...viewport, aspectRatio: 2 })).toEqual({ top: 175, left: 50, width: 900, height: 450 });
	});

	test("a portrait image fills the padded height and centers horizontally", () => {
		expect(getCenteredRect({ ...viewport, aspectRatio: 0.5 })).toEqual({ top: 50, left: 325, width: 350, height: 700 });
	});

	test("the box never shrinks below the minimum size", () => {
		const rect = getCenteredRect({ ...viewport, aspectRatio: 100, minHeight: 60 });
		expect(rect.height).toBe(60);
		expect(rect.top).toBe(370);
	});

	test("a bad ratio falls back to a square", () => {
		expect(getCenteredRect({ ...viewport, aspectRatio: 0 })).toEqual({ top: 50, left: 150, width: 700, height: 700 });
		expect(getCenteredRect({ ...viewport, aspectRatio: Number.NaN }).width).toBe(700);
	});
});

test("toRect copies only the four box fields", () => {
	expect(toRect({ top: 1, left: 2, width: 3, height: 4, x: 2, y: 1 } as DOMRect)).toEqual({ top: 1, left: 2, width: 3, height: 4 });
});
