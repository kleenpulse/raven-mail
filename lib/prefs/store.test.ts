import { afterEach, describe, expect, test } from "bun:test";
import { getPref, resetPrefs, setPref, usePrefsStore } from "@/lib/prefs/store";

afterEach(() => resetPrefs());

const overrides = () => usePrefsStore.getState().overrides;

describe("prefs store", () => {
	test("untouched prefs read their defaults", () => {
		expect(getPref("mail.undoMs")).toBe(5000);
		expect(overrides()).toEqual({});
	});

	test("setting a value stores only that override", () => {
		setPref("appearance.density", "compact");
		expect(getPref("appearance.density")).toBe("compact");
		expect(overrides()).toEqual({ "appearance.density": "compact" });
	});

	test("choosing the default clears the override", () => {
		setPref("appearance.density", "compact");
		setPref("appearance.density", "comfortable");
		expect(overrides()).toEqual({});
	});

	test("remote images keeps an explicit no: it means the prompt was answered", () => {
		setPref("mail.remoteImages", false);
		expect(overrides()).toEqual({ "mail.remoteImages": false });
	});

	test("reset clears only the keys asked for", () => {
		setPref("appearance.density", "compact");
		setPref("mail.undoMs", 20_000);
		resetPrefs(["mail.undoMs"]);
		expect(overrides()).toEqual({ "appearance.density": "compact" });
		resetPrefs();
		expect(overrides()).toEqual({});
	});
});
