import { describe, expect, test } from "bun:test";
import type { DesktopUpdateState } from "@/lib/desktop/bridge";
import { parseUpdateAction, type UpdateState } from "./bridge";
import { NO_UPDATE, nextUpdateState, updateActionAllowed, updateMenuItem, updateNotice, type UpdateEvent } from "./update-state";

// The page keeps its own copy of the type (lib/desktop/bridge.ts); these only compile while both match.
const toPage = (state: UpdateState): DesktopUpdateState => state;
const fromPage = (state: DesktopUpdateState): UpdateState => state;

const run = (events: UpdateEvent[], selfInstall = true, from: UpdateState = NO_UPDATE) => events.reduce((state, event) => nextUpdateState(state, event, selfInstall), from);

describe("nextUpdateState", () => {
	test("auto: available, progress in whole percents, then ready", () => {
		expect(run([{ type: "available", version: "0.11.0" }])).toEqual({ kind: "downloading", version: "0.11.0", percent: 0 });
		expect(run([{ type: "available", version: "0.11.0" }, { type: "progress", percent: 41.7 }])).toEqual({ kind: "downloading", version: "0.11.0", percent: 41 });
		expect(run([{ type: "available", version: "0.11.0" }, { type: "progress", percent: 99.9 }, { type: "downloaded", version: "0.11.0" }])).toEqual({ kind: "ready", version: "0.11.0" });
	});

	test("returns the same object when the page would show nothing new", () => {
		const downloading = run([{ type: "available", version: "0.11.0" }, { type: "progress", percent: 12.1 }]);
		expect(nextUpdateState(downloading, { type: "progress", percent: 12.9 }, true)).toBe(downloading);
		expect(nextUpdateState(downloading, { type: "available", version: "0.11.0" }, true)).toBe(downloading);
		const ready: UpdateState = { kind: "ready", version: "0.11.0" };
		expect(nextUpdateState(ready, { type: "downloaded", version: "0.11.0" }, true)).toBe(ready);
		expect(nextUpdateState(NO_UPDATE, { type: "progress", percent: 50 }, true)).toBe(NO_UPDATE);
	});

	test("progress stays between 0 and 100", () => {
		const downloading: UpdateState = { kind: "downloading", version: "0.11.0", percent: 5 };
		expect(nextUpdateState(downloading, { type: "progress", percent: 140 }, true)).toEqual({ ...downloading, percent: 100 });
		expect(nextUpdateState(downloading, { type: "progress", percent: -3 }, true)).toEqual({ ...downloading, percent: 0 });
		expect(nextUpdateState(downloading, { type: "progress", percent: Number.NaN }, true)).toEqual({ ...downloading, percent: 0 });
	});

	test("a later check doesn't hide a ready update", () => {
		const ready: UpdateState = { kind: "ready", version: "0.11.0" };
		expect(nextUpdateState(ready, { type: "available", version: "0.11.0" }, true)).toBe(ready);
		expect(nextUpdateState(ready, { type: "error" }, true)).toBe(ready);
		// A newer release downloads over it.
		expect(nextUpdateState(ready, { type: "available", version: "0.11.1" }, true)).toEqual({ kind: "downloading", version: "0.11.1", percent: 0 });
	});

	test("a failed download hides the pill", () => {
		expect(run([{ type: "available", version: "0.11.0" }, { type: "progress", percent: 30 }, { type: "error" }])).toBe(NO_UPDATE);
	});

	test("builds that can't install updates say a version is out", () => {
		const available = run([{ type: "available", version: "0.11.0" }], false);
		expect(available).toEqual({ kind: "available", version: "0.11.0" });
		expect(nextUpdateState(available, { type: "available", version: "0.11.0" }, false)).toBe(available);
		expect(nextUpdateState(available, { type: "error" }, false)).toBe(available);
		expect(nextUpdateState(available, { type: "progress", percent: 50 }, false)).toBe(available);
	});
});

describe("updateActionAllowed", () => {
	test("restart only once ready, the release page only when available", () => {
		expect(updateActionAllowed({ kind: "ready", version: "1.0.0" }, "restart")).toBe(true);
		expect(updateActionAllowed({ kind: "available", version: "1.0.0" }, "open-release")).toBe(true);
		for (const state of [NO_UPDATE, { kind: "downloading", version: "1.0.0", percent: 50 }, { kind: "available", version: "1.0.0" }] as UpdateState[]) {
			expect(updateActionAllowed(state, "restart")).toBe(false);
		}
		for (const state of [NO_UPDATE, { kind: "downloading", version: "1.0.0", percent: 50 }, { kind: "ready", version: "1.0.0" }] as UpdateState[]) {
			expect(updateActionAllowed(state, "open-release")).toBe(false);
		}
	});
});

describe("parseUpdateAction", () => {
	test("only the two actions get through", () => {
		expect(parseUpdateAction("restart")).toBe("restart");
		expect(parseUpdateAction("open-release")).toBe("open-release");
		for (const bad of ["Restart", "quit", "", null, undefined, 1, { action: "restart" }, ["restart"]]) expect(parseUpdateAction(bad)).toBeNull();
	});
});

describe("notices and the tray item", () => {
	test("say the version and what a click does", () => {
		expect(updateNotice({ kind: "ready", version: "0.11.0" })).toEqual({ title: "Raven 0.11.0 is ready.", body: "Click to restart and update." });
		expect(updateNotice({ kind: "available", version: "0.11.0" })).toEqual({ title: "Raven 0.11.0 is out.", body: "Click to open the download page." });
		expect(updateMenuItem({ kind: "ready", version: "0.11.0" })).toEqual({ label: "Restart to update to 0.11.0", action: "restart" });
		expect(updateMenuItem({ kind: "available", version: "0.11.0" })).toEqual({ label: "Download Raven 0.11.0…", action: "open-release" });
	});

	test("nothing while downloading or idle", () => {
		for (const state of [NO_UPDATE, { kind: "downloading", version: "0.11.0", percent: 3 }] as UpdateState[]) {
			expect(updateNotice(state)).toBeNull();
			expect(updateMenuItem(state)).toBeNull();
		}
	});
});

void toPage;
void fromPage;
