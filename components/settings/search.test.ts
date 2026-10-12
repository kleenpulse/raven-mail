import { describe, expect, test } from "bun:test";
import { highlightParts, searchSettings, SECTION_IDS, sectionPrefs, SETTINGS } from "@/components/settings";
import { PREF_KEYS } from "@/lib/prefs/schema";

describe("searchSettings", () => {
	test("matches labels, descriptions and keywords", () => {
		expect(searchSettings("density").map((s) => s.id)).toContain("density");
		expect(searchSettings("tracking").map((s) => s.id)).toEqual(["remote-images"]);
		expect(searchSettings("dark").map((s) => s.id)).toContain("theme");
	});

	test("every word must match", () => {
		expect(searchSettings("reduce motion").map((s) => s.id)).toEqual(["motion"]);
		expect(searchSettings("reduce zzz")).toEqual([]);
	});

	test("matches the section name too", () => {
		const ids = searchSettings("keyboard").map((s) => s.id);
		expect(ids).toContain("single-key");
		expect(ids).toContain("shortcut-list");
	});

	test("blank query returns nothing", () => {
		expect(searchSettings("   ")).toEqual([]);
	});
});

describe("highlightParts", () => {
	test("marks each matched run, case-insensitively", () => {
		expect(highlightParts("Reduce Motion", "motion")).toEqual([
			{ text: "Reduce ", match: false },
			{ text: "Motion", match: true },
		]);
	});

	test("regex characters in the query are literal", () => {
		expect(highlightParts("a.b", ".")).toEqual([
			{ text: "a", match: false },
			{ text: ".", match: true },
			{ text: "b", match: false },
		]);
	});
});

describe("registry", () => {
	test("every pref has a row, exactly once", () => {
		const owned = SETTINGS.flatMap((s) => s.prefs ?? []);
		expect([...owned].sort()).toEqual([...PREF_KEYS].sort());
		expect(SECTION_IDS.flatMap(sectionPrefs).length).toBe(PREF_KEYS.length);
	});

	test("row ids are unique", () => {
		expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length);
	});
});
