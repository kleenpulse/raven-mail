import { afterEach, describe, expect, test } from "bun:test";
import { allowSingleKey, messageKeyAction, SHORTCUTS } from "@/lib/keyboard";
import { resetPrefs, setPref } from "@/lib/prefs/store";

type Mods = {
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	repeat?: boolean;
	target?: unknown;
};

const press = (key: string, mods: Mods = {}) => ({
	key,
	target: (mods.target ?? null) as EventTarget | null,
	metaKey: mods.metaKey ?? false,
	ctrlKey: mods.ctrlKey ?? false,
	altKey: mods.altKey ?? false,
	shiftKey: mods.shiftKey ?? false,
	repeat: mods.repeat ?? false,
});

afterEach(() => resetPrefs());

/** A stand-in element whose ancestors carry `attrs`; `closest` understands `[name]` and `[name="value"]`. */
function inside(el: { tagName: string }, attrs: Record<string, string>) {
	const matches = (sel: string) => {
		const m = sel.trim().match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
		return Boolean(m && m[1]! in attrs && (m[2] === undefined || attrs[m[1]!] === m[2]));
	};
	return {
		...el,
		isContentEditable: false,
		closest: (selector: string) => (selector.split(",").some(matches) ? {} : null),
	};
}

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

describe("messageKeyAction", () => {
	test.each([
		["e", false, "archive"],
		["#", true, "trash"],
		["#", false, "trash"],
		["s", false, "star"],
		["U", true, "unread"],
		["r", false, "reply"],
		["a", false, "replyAll"],
		["F", true, "forward"],
	] as const)("%s (shift %p) → %s", (key, shiftKey, action) => {
		expect(messageKeyAction(press(key, { shiftKey }))).toBe(action);
	});

	test("plain f and u stay wide view and back-to-list", () => {
		expect(messageKeyAction(press("f"))).toBeNull();
		expect(messageKeyAction(press("u"))).toBeNull();
	});

	test("Shift on the other letters does nothing (Shift+E, Shift+R)", () => {
		expect(messageKeyAction(press("E", { shiftKey: true }))).toBeNull();
		expect(messageKeyAction(press("R", { shiftKey: true }))).toBeNull();
	});

	test.each(["INPUT", "TEXTAREA"])("nothing fires while typing in %s", (tagName) => {
		const target = { tagName, isContentEditable: false };
		for (const [key, shiftKey] of [["e", false], ["#", true], ["s", false], ["U", true], ["r", false], ["a", false], ["F", true]] as const) {
			expect(messageKeyAction(press(key, { shiftKey, target }))).toBeNull();
		}
	});

	test.each([
		["a dialog (settings sheet, Ask Jev tray)", { role: "dialog" }],
		["a modal", { "aria-modal": "true" }],
		["a menu", { role: "menu" }],
		["a listbox (select, palette)", { role: "listbox" }],
		["the compose dock (focus on its Attach button)", { "data-compose": "" }],
	])("nothing fires with focus inside %s", (_name, ancestor) => {
		const target = inside({ tagName: "BUTTON" }, ancestor);
		expect(messageKeyAction(press("e", { target }))).toBeNull();
		expect(messageKeyAction(press("#", { target, shiftKey: true }))).toBeNull();
		expect(messageKeyAction(press("r", { target }))).toBeNull();
		expect(allowSingleKey(press("j", { target }))).toBe(false);
		// Escape still closes things from in there.
		expect(allowSingleKey(press("Escape", { target }))).toBe(true);
	});

	test("an element outside any overlay still gets the keys", () => {
		expect(messageKeyAction(press("e", { target: inside({ tagName: "DIV" }, { role: "main" }) }))).toBe("archive");
	});

	test("Caps Lock doesn't matter: case comes from Shift alone", () => {
		expect(messageKeyAction(press("E"))).toBe("archive");
		expect(messageKeyAction(press("S"))).toBe("star");
		expect(messageKeyAction(press("R"))).toBe("reply");
		expect(messageKeyAction(press("A"))).toBe("replyAll");
		// Caps Lock + Shift sends lowercase with shiftKey set.
		expect(messageKeyAction(press("u", { shiftKey: true }))).toBe("unread");
		expect(messageKeyAction(press("f", { shiftKey: true }))).toBe("forward");
		// Caps Lock alone on F and U is still the wide toggle and back-to-list.
		expect(messageKeyAction(press("F"))).toBeNull();
		expect(messageKeyAction(press("U"))).toBeNull();
	});

	test("nothing fires in a contenteditable (the rich editor later)", () => {
		expect(messageKeyAction(press("e", { target: { tagName: "DIV", isContentEditable: true } }))).toBeNull();
	});

	test.each(["metaKey", "ctrlKey", "altKey"] as const)("%s combos are left alone (Ctrl+A, Cmd+R…)", (mod) => {
		expect(messageKeyAction(press("a", { [mod]: true }))).toBeNull();
		expect(messageKeyAction(press("r", { [mod]: true }))).toBeNull();
	});

	test("Single-Key Shortcuts off turns them all off", () => {
		setPref("keyboard.singleKey", false);
		expect(messageKeyAction(press("e"))).toBeNull();
		expect(messageKeyAction(press("#", { shiftKey: true }))).toBeNull();
		expect(messageKeyAction(press("F", { shiftKey: true }))).toBeNull();
	});

	test("a held key doesn't repeat (holding E won't archive a run of messages)", () => {
		expect(messageKeyAction(press("e", { repeat: true }))).toBeNull();
	});

	test("every triage key is listed in Keyboard settings", () => {
		const listed = SHORTCUTS.map((s) => s.keys.join("+"));
		for (const keys of ["E", "#", "S", "Shift+U", "R", "A", "Shift+F"]) expect(listed).toContain(keys);
		// F and U keep their old meanings in the list too.
		expect(SHORTCUTS.find((s) => s.keys.join("+") === "F")?.label).toBe("Wide reader on or off");
		expect(SHORTCUTS.find((s) => s.keys.join("+") === "U")?.label).toBe("Back to the list");
	});
});
