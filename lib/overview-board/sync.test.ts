import { describe, expect, test } from "bun:test";
import { resolveBoard, seedLayouts } from "./layout";
import {
	afterSave,
	boardStorageKey,
	mergeNewer,
	nextStamp,
	parseBlob,
	parseDoc,
	pickParts,
	reconcile,
	serializeBlob,
	writeLayout,
	writeReset,
	writeRestore,
	writeWidgets,
} from "./sync";
import { boardDocSchema, type BoardDoc, type LayoutPart } from "./types";
import { WIDGET_IDS } from "./widgets";

const T1 = "2026-11-18T10:00:00.000Z";
const T2 = "2026-11-18T11:00:00.000Z";
const NOW = Date.parse("2026-11-18T12:00:00.000Z");

const layout = (updatedAt: string, x = 0): LayoutPart => ({ items: [{ i: "volume", x, y: 0, w: 4, h: 8 }], updatedAt });
const FUTURE = "a-card-from-the-future";

describe("the device copy", () => {
	test("is kept per mailbox, so a second mailbox on one browser cannot overwrite the first", () => {
		expect(boardStorageKey("owner-a")).not.toBe(boardStorageKey("owner-b"));
		const store = new Map<string, string>();
		store.set(boardStorageKey("owner-a"), serializeBlob({ lg: layout(T1, 1) }));
		store.set(boardStorageKey("owner-b"), serializeBlob({ lg: layout(T2, 2) }));
		expect(parseBlob(store.get(boardStorageKey("owner-a")) ?? null)).toEqual({ lg: layout(T1, 1) });
	});

	test("round-trips a record", () => {
		const doc: BoardDoc = { lg: layout(T1), widgets: { on: ["volume"], known: [...WIDGET_IDS], updatedAt: T2 } };
		expect(parseBlob(serializeBlob(doc))).toEqual(doc);
	});

	test("nothing saved is null; a settled default board is an empty record", () => {
		expect(parseBlob(null)).toBeNull();
		expect(parseBlob("{not json")).toBeNull();
		expect(parseBlob(serializeBlob({}))).toEqual({});
	});

	test("one bad part is dropped and the rest stand", () => {
		const doc = parseDoc({ lg: layout(T1), md: { items: "nope", updatedAt: T1 }, sm: { items: null }, widgets: 7 });
		expect(doc).toEqual({ lg: layout(T1) });
	});

	test("a card id this release does not know is not a bad part", () => {
		const part: LayoutPart = { items: [{ i: FUTURE, x: 0, y: 0, w: 4, h: 8 }], updatedAt: T1 };
		expect(parseDoc({ lg: part })).toEqual({ lg: part });
		expect(boardDocSchema.safeParse({ lg: part, widgets: { on: [FUTURE], known: [FUTURE], updatedAt: T1 } }).success).toBe(true);
	});
});

describe("reconcile", () => {
	test("adopts the parts the other copy has newer, pushes the parts this one has newer", () => {
		const local: BoardDoc = { lg: layout(T2, 1), md: layout(T1, 1) };
		const remote: BoardDoc = { lg: layout(T1, 2), md: layout(T2, 2) };
		expect(reconcile(local, remote)).toEqual({ adopt: { md: layout(T2, 2) }, push: ["lg"] });
	});

	test("pushes a touched part to an empty replica, and does nothing for an untouched board", () => {
		expect(reconcile({ sm: layout(T1) }, null)).toEqual({ adopt: {}, push: ["sm"] });
		expect(reconcile({}, null)).toEqual({ adopt: {}, push: [] });
	});

	test("a fresh device takes whatever the replica has", () => {
		const remote: BoardDoc = { lg: layout(T1), widgets: { on: null, known: [], updatedAt: T1 } };
		expect(reconcile({}, remote)).toEqual({ adopt: remote, push: [] });
	});

	test("equal stamps are already in sync", () => {
		expect(reconcile({ lg: layout(T1) }, { lg: layout(T1) })).toEqual({ adopt: {}, push: [] });
	});

	// The desktop removed a card; a phone that had not heard rearranged its own layout later.
	test("a newer phone layout does not bring back a card the desktop removed", () => {
		const desktop: BoardDoc = { widgets: { on: ["volume"], known: [...WIDGET_IDS], updatedAt: T1 } };
		const phone: BoardDoc = {
			sm: {
				items: [
					{ i: "orbit", x: 0, y: 0, w: 2, h: 14 },
					{ i: "volume", x: 0, y: 14, w: 2, h: 9 },
				],
				updatedAt: T2,
			},
		};
		const merged = mergeNewer(desktop, phone);
		expect(merged.widgets).toEqual(desktop.widgets);
		expect(resolveBoard(merged).on).toEqual(["volume"]);
		expect(resolveBoard(merged).layouts.sm.map((i) => i.i)).toEqual(["volume"]);
	});
});

test("mergeNewer keeps the newer of each part", () => {
	expect(mergeNewer({ lg: layout(T2, 1), md: layout(T1, 1) }, { lg: layout(T1, 2), md: layout(T2, 2), sm: layout(T1, 3) })).toEqual({
		lg: layout(T2, 1),
		md: layout(T2, 2),
		sm: layout(T1, 3),
	});
});

test("pickParts sends only the named parts", () => {
	const doc: BoardDoc = { lg: layout(T1), md: layout(T2) };
	expect(pickParts(doc, ["md", "sm"])).toEqual({ md: layout(T2) });
});

describe("nextStamp", () => {
	test("is now on a device whose clock is fine", () => {
		expect(nextStamp(T1, NOW)).toBe(new Date(NOW).toISOString());
		expect(nextStamp(undefined, NOW)).toBe(new Date(NOW).toISOString());
	});

	test("is never older than the newest stamp seen: a slow clock still wins its own edits", () => {
		const seen = "2026-11-18T12:05:00.000Z";
		expect(nextStamp(seen, NOW)).toBe("2026-11-18T12:05:00.001Z");
	});
});

describe("writes", () => {
	const seed = seedLayouts();

	test("a move stamps only its own width", () => {
		const before: BoardDoc = { md: layout(T1) };
		const after = writeLayout(before, "lg", seed.lg, NOW);
		expect(after.lg).toEqual({ items: seed.lg, updatedAt: new Date(NOW).toISOString() });
		expect(after.md).toBe(before.md);
		expect(after.sm).toBeUndefined();
		expect(after.widgets).toBeUndefined();
	});

	test("a move keeps the saved place of a card this release does not know", () => {
		const future = { i: FUTURE, x: 0, y: 30, w: 4, h: 8 };
		const before: BoardDoc = { lg: { items: [...seed.lg, future], updatedAt: T1 } };
		const after = writeLayout(before, "lg", seed.lg.slice(0, 3), NOW);
		expect(after.lg?.items).toEqual([...seed.lg.slice(0, 3), future]);
	});

	test("adding or removing a card keeps unknown ids on, and never forgets what the record knew", () => {
		const before: BoardDoc = { widgets: { on: ["volume", FUTURE], known: ["volume", FUTURE, "long-gone"], updatedAt: T1 } };
		const after = writeWidgets(before, ["volume", "streak"], NOW);
		expect(after.widgets?.on).toEqual(["volume", "streak", FUTURE]);
		expect(after.widgets?.known).toEqual(["volume", FUTURE, "long-gone", ...WIDGET_IDS.filter((id) => id !== "volume")]);
	});

	test("the first removal on a default board keeps a newer release's card on", () => {
		// `on: null` is every card, including one only a newer tab knows.
		const before: BoardDoc = { widgets: { on: null, known: [...WIDGET_IDS, FUTURE], updatedAt: T1 } };
		const after = writeWidgets(before, ["volume"], NOW);
		expect(after.widgets?.on).toEqual(["volume", FUTURE]);
	});

	test("reset puts every part back on the default and stamps all four", () => {
		const before: BoardDoc = { lg: layout(T1), widgets: { on: ["volume"], known: ["volume", FUTURE], updatedAt: T2 } };
		const after = writeReset(before, NOW);
		const at = new Date(NOW).toISOString();
		expect(after.lg).toEqual({ items: null, updatedAt: at });
		expect(after.md).toEqual({ items: null, updatedAt: at });
		expect(after.sm).toEqual({ items: null, updatedAt: at });
		expect(after.widgets?.on).toBeNull();
		expect(after.widgets?.known).toContain(FUTURE);
		expect(resolveBoard(after)).toEqual({ on: [...WIDGET_IDS], layouts: seed });
	});

	test("undo puts the earlier board back as a new edit, so it wins everywhere", () => {
		const earlier: BoardDoc = { lg: layout(T1, 3), widgets: { on: ["volume"], known: [...WIDGET_IDS], updatedAt: T1 } };
		const reset = writeReset(earlier, NOW);
		const undone = writeRestore(reset, earlier, NOW + 5000);
		expect(undone.lg?.items).toEqual(earlier.lg?.items ?? null);
		expect(undone.md?.items).toBeNull();
		expect(undone.widgets?.on).toEqual(["volume"]);
		expect(reconcile(undone, reset).push).toEqual(["lg", "md", "sm", "widgets"]);
	});

	test("every write is a record the schema accepts", () => {
		const doc = writeWidgets(writeLayout(writeReset({}, NOW), "sm", seed.sm, NOW), ["volume"], NOW);
		expect(boardDocSchema.safeParse(doc).success).toBe(true);
	});
});

describe("after a save", () => {
	const T0 = "2026-11-18T09:00:00.000Z";

	test("a part the account already held newer is adopted", () => {
		const local: BoardDoc = { lg: layout(T1, 1) };
		expect(afterSave(local, local, { lg: layout(T2, 2) })).toEqual({ lg: layout(T2, 2) });
	});

	test("a part that landed as sent is left exactly as it is", () => {
		const local: BoardDoc = { lg: layout(T1, 1) };
		expect(afterSave(local, local, { lg: layout(T1, 1) }).lg).toBe(local.lg);
	});

	test("a stamp the server pinned back is taken, so this device stops believing it is ahead", () => {
		// This device's clock runs fast: it stamped T2, the server stored the same cards at T1.
		const local: BoardDoc = { lg: layout(T2, 1) };
		expect(afterSave(local, local, { lg: layout(T1, 1) })).toEqual({ lg: layout(T1, 1) });
	});

	test("a part edited again while the save was in the air keeps the newer edit", () => {
		const sent: BoardDoc = { lg: layout(T1, 1) };
		const local: BoardDoc = { lg: layout(T2, 5) };
		expect(afterSave(local, sent, { lg: layout(T0, 1) })).toEqual(local);
		expect(afterSave(local, sent, { lg: layout(T1, 1) })).toEqual(local);
	});

	test("parts that were not sent follow the usual rule: the newer copy stands", () => {
		const local: BoardDoc = { lg: layout(T1, 1), md: layout(T2, 3), sm: layout(T1, 4) };
		const stored: BoardDoc = { lg: layout(T1, 1), md: layout(T1, 9), sm: layout(T2, 8) };
		expect(afterSave(local, { lg: layout(T1, 1) }, stored)).toEqual({ lg: layout(T1, 1), md: layout(T2, 3), sm: layout(T2, 8) });
	});
});
