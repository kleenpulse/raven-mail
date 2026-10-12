import { describe, expect, test } from "bun:test";
import { DEFAULTS, fromLegacy, parseOverrides, PREF_KEYS, PREF_SCHEMAS } from "@/lib/prefs/schema";

describe("parseOverrides", () => {
	test("keeps valid known keys only", () => {
		expect(parseOverrides({ "appearance.density": "compact", "mail.undoMs": 20_000, "nope.key": 1 })).toEqual({
			"appearance.density": "compact",
			"mail.undoMs": 20_000,
		});
	});

	test("one bad value drops that key, not the rest", () => {
		expect(parseOverrides({ "appearance.uiSize": "huge", "mail.preload": false })).toEqual({ "mail.preload": false });
	});

	test("rejects undo windows outside the offered choices", () => {
		expect(parseOverrides({ "mail.undoMs": 7000 })).toEqual({});
	});

	test.each([[null], [undefined], ["x"], [42], [[]]])("non-objects parse to no overrides (%p)", (raw: unknown) => {
		expect(parseOverrides(raw)).toEqual({});
	});

	test("every default passes its own schema", () => {
		for (const key of PREF_KEYS) expect(PREF_SCHEMAS[key].safeParse(DEFAULTS[key]).success).toBe(true);
	});
});

describe("fromLegacy", () => {
	test("maps the old remote-images answer onto the setting", () => {
		expect(fromLegacy("always")).toEqual({ "mail.remoteImages": true });
		expect(fromLegacy("once")).toEqual({ "mail.remoteImages": false });
		expect(fromLegacy(null)).toEqual({});
		expect(fromLegacy("garbage")).toEqual({});
	});
});
