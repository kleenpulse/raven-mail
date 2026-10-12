import { describe, expect, test } from "bun:test";
import { headScript, prefsToAttrs } from "@/lib/prefs/dom";
import { PREFS_STORAGE_KEY } from "@/lib/prefs/store";

describe("prefsToAttrs", () => {
	test("defaults leave every attribute off", () => {
		expect(Object.values(prefsToAttrs({})).every((v) => v === null)).toBe(true);
		const explicit = prefsToAttrs({
			"appearance.uiSize": "default",
			"appearance.density": "comfortable",
			"appearance.motion": "system",
			"appearance.reduceTransparency": false,
		});
		expect(Object.values(explicit).every((v) => v === null)).toBe(true);
	});

	test("changed visual prefs map to their attributes", () => {
		expect(
			prefsToAttrs({
				"appearance.uiSize": "larger",
				"appearance.density": "compact",
				"appearance.motion": "reduce",
				"appearance.reduceTransparency": true,
			}),
		).toEqual({
			"data-ui-size": "larger",
			"data-density": "compact",
			"data-motion": "reduce",
			"data-transparency": "reduce",
		});
	});
});

/** Runs the pre-paint script against stand-ins for localStorage and <html>. */
function runScript(stored: string | null) {
	const attrs: Record<string, string> = {};
	const localStorage = { getItem: (key: string) => (key === PREFS_STORAGE_KEY ? stored : null) };
	const document = {
		documentElement: {
			setAttribute: (k: string, v: string) => {
				attrs[k] = v;
			},
		},
	};
	new Function("localStorage", "document", headScript())(localStorage, document);
	return attrs;
}

describe("headScript", () => {
	test("applies stored overrides before paint", () => {
		const stored = JSON.stringify({
			state: { overrides: { "appearance.uiSize": "large", "appearance.reduceTransparency": true } },
			version: 1,
		});
		expect(runScript(stored)).toEqual({ "data-ui-size": "large", "data-transparency": "reduce" });
	});

	test("nothing stored, nothing set", () => {
		expect(runScript(null)).toEqual({});
	});

	test("corrupt JSON never throws", () => {
		expect(() => runScript("{not json")).not.toThrow();
		expect(runScript("{not json")).toEqual({});
	});

	test("only whitelisted values reach the DOM", () => {
		const stored = JSON.stringify({
			state: { overrides: { "appearance.uiSize": "constructor", "appearance.density": "\"><script>" } },
		});
		expect(runScript(stored)).toEqual({});
	});
});
