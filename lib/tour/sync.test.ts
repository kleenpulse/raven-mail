import { describe, expect, test } from "bun:test";
import { parseBlob, reconcile, serializeBlob, stamp } from "./sync";
import { DEFAULT_TOUR_STATE, isNewer, tourStateSchema, type TourState } from "./types";

const at = (iso: string, over: Partial<TourState> = {}): TourState => ({ ...DEFAULT_TOUR_STATE, ...over, updatedAt: iso });

describe("parseBlob", () => {
	test("round-trips the owner's state", () => {
		const state = at("2026-09-29T10:00:00.000Z", { lastStep: 3, voice: "gb" });
		expect(parseBlob(serializeBlob("owner-a", state), "owner-a")).toEqual(state);
	});

	test("ignores another mailbox's blob on a shared device", () => {
		const state = at("2026-09-29T10:00:00.000Z", { completed: true });
		expect(parseBlob(serializeBlob("owner-a", state), "owner-b")).toBeNull();
	});

	test("drops empty, malformed and out-of-range blobs", () => {
		expect(parseBlob(null, "o")).toBeNull();
		expect(parseBlob("{not json", "o")).toBeNull();
		expect(parseBlob(JSON.stringify({ owner: "o", state: { ...DEFAULT_TOUR_STATE, voice: "fr" } }), "o")).toBeNull();
		expect(parseBlob(JSON.stringify({ owner: "o", state: { ...DEFAULT_TOUR_STATE, lastStep: 99 } }), "o")).toBeNull();
	});
});

describe("reconcile", () => {
	const older = at("2026-09-29T10:00:00.000Z", { lastStep: 2 });
	const newer = at("2026-09-29T11:00:00.000Z", { completed: true, voice: "gb" });

	test("adopts a newer replica", () => {
		expect(reconcile(older, newer)).toEqual({ kind: "adopt", state: newer });
	});

	test("pushes when this device is newer", () => {
		expect(reconcile(newer, older)).toEqual({ kind: "push" });
	});

	test("pushes a touched local state to an empty replica", () => {
		expect(reconcile(older, null)).toEqual({ kind: "push" });
	});

	test("an untouched device against an empty replica does nothing", () => {
		expect(reconcile(DEFAULT_TOUR_STATE, null)).toEqual({ kind: "none" });
	});

	test("a fresh device takes whatever the replica has", () => {
		expect(reconcile(DEFAULT_TOUR_STATE, older)).toEqual({ kind: "adopt", state: older });
	});

	test("equal stamps are already in sync", () => {
		expect(reconcile(older, { ...older })).toEqual({ kind: "none" });
	});
});

describe("stamp", () => {
	test("merges the patch and stamps a valid ISO time", () => {
		const now = new Date("2026-09-29T12:34:56.000Z");
		const next = stamp(DEFAULT_TOUR_STATE, { skipped: true, lastStep: 4 }, now);
		expect(next).toEqual({ ...DEFAULT_TOUR_STATE, skipped: true, lastStep: 4, updatedAt: now.toISOString() });
		expect(tourStateSchema.safeParse(next).success).toBe(true);
	});
});

test("isNewer: null never wins, any stamp beats null", () => {
	expect(isNewer(null, "2026-01-01T00:00:00.000Z")).toBe(false);
	expect(isNewer("2026-01-01T00:00:00.000Z", null)).toBe(true);
	expect(isNewer(null, null)).toBe(false);
});
