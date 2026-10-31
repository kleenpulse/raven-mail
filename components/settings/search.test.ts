import { describe, expect, test } from "bun:test";
import { highlightParts, searchSettings, SECTION_IDS, sectionEntries, sectionPrefs, SETTINGS, shown } from "@/components/settings";
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

	test("finds the Jev key row by the words people use for it", () => {
		for (const query of ["byok", "api key", "typesafe"]) {
			expect(searchSettings(query).map((s) => s.id)).toContain("jev-key");
		}
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
		// Tests run as the web build, which hides desktop-only rows.
		const desktopOnly = SETTINGS.filter((s) => s.desktopOnly).flatMap((s) => s.prefs ?? []);
		expect(SECTION_IDS.flatMap(sectionPrefs).length).toBe(PREF_KEYS.length - desktopOnly.length);
	});

	test("desktop-only rows show in the desktop app and nowhere on the web", () => {
		const row = SETTINGS.find((s) => s.id === "system-notifications")!;
		expect(row.desktopOnly).toBe(true);
		expect(shown(row, true)).toBe(true);
		expect(shown(row, false)).toBe(false);
		expect(sectionEntries("notifications").map((s) => s.id)).not.toContain("system-notifications");
		expect(searchSettings("desktop notifications").map((s) => s.id)).not.toContain("system-notifications");
		expect(shown(SETTINGS.find((s) => s.id === "banner-position")!, false)).toBe(true);
	});

	test("row ids are unique", () => {
		expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length);
	});
});
