import { afterEach, describe, expect, test } from "bun:test";
import { allowSingleKey } from "@/lib/keyboard";
import { resetPrefs, setPref } from "@/lib/prefs/store";

type Mods = { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: unknown };

const press = (key: string, mods: Mods = {}) => ({
	key,
	target: (mods.target ?? null) as EventTarget | null,
	metaKey: mods.metaKey ?? false,
	ctrlKey: mods.ctrlKey ?? false,
	altKey: mods.altKey ?? false,
});

afterEach(() => resetPrefs());

describe("allowSingleKey", () => {
	test("character and named keys pass by default", () => {
		expect(allowSingleKey(press("c"))).toBe(true);
		expect(allowSingleKey(press("/"))).toBe(true);
		expect(allowSingleKey(press("Escape"))).toBe(true);
	});

	test.each(["metaKey", "ctrlKey", "altKey"] as const)("%s combos are never single-key shortcuts", (mod) => {
		expect(allowSingleKey(press("c", { [mod]: true }))).toBe(false);
	});

	test.each(["INPUT", "TEXTAREA"])("typing in %s blocks them", (tagName) => {
		expect(allowSingleKey(press("j", { target: { tagName, isContentEditable: false } }))).toBe(false);
	});

	test("contenteditable blocks them", () => {
		expect(allowSingleKey(press("j", { target: { tagName: "DIV", isContentEditable: true } }))).toBe(false);
	});

	test("Single-Key Shortcuts off blocks character keys, keeps named keys", () => {
		setPref("keyboard.singleKey", false);
		expect(allowSingleKey(press("c"))).toBe(false);
		expect(allowSingleKey(press("j"))).toBe(false);
		expect(allowSingleKey(press("Escape"))).toBe(true);
		expect(allowSingleKey(press("ArrowDown"))).toBe(true);
	});
});
