import { describe, expect, test } from "bun:test";
import {
	COLS,
	addWidget,
	nudge,
	readingOrder,
	removeWidget,
	resolveBoard,
	sanitizeLayout,
	seedLayouts,
	sizeLimits,
	widgetsOn,
	type BoardItem,
	type BoardLayouts,
} from "./layout";
import { BREAKPOINT_NAMES, type BoardDoc } from "./types";
import { WIDGETS, WIDGET_IDS, type WidgetId } from "./widgets";

const AT = "2026-11-18T10:00:00.000Z";

function overlaps(a: BoardItem, b: BoardItem) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertClean(layouts: BoardLayouts) {
	for (const bp of BREAKPOINT_NAMES) {
		const layout = layouts[bp];
		expect(new Set(layout.map((i) => i.i)).size).toBe(layout.length);
		for (const item of layout) {
			const lim = sizeLimits(item.i, bp);
			expect(item.x).toBeGreaterThanOrEqual(0);
			expect(item.x + item.w).toBeLessThanOrEqual(COLS[bp]);
			expect(item.w).toBeGreaterThanOrEqual(lim.minW);
			expect(item.w).toBeLessThanOrEqual(lim.maxW);
			expect(item.h).toBeGreaterThanOrEqual(lim.minH);
			expect(item.h).toBeLessThanOrEqual(lim.maxH);
			for (const other of layout) if (other !== item) expect(overlaps(item, other)).toBe(false);
		}
	}
}

const place = (layout: BoardItem[], id: WidgetId) => layout.find((i) => i.i === id);

describe("the registry", () => {
	test("every starting size sits inside its own limits, at every width", () => {
		for (const w of WIDGETS) {
			for (const bp of BREAKPOINT_NAMES) {
				const size = w.size[bp];
				const lim = sizeLimits(w.id, bp);
				expect(lim.w).toBe(size.w);
				expect(lim.h).toBe(size.h);
				expect(size.w).toBeGreaterThanOrEqual(lim.minW);
				expect(size.h).toBeGreaterThanOrEqual(lim.minH);
			}
		}
	});
});

describe("seedLayouts", () => {
	test("is clean and carries every card at every width", () => {
		const seed = seedLayouts();
		assertClean(seed);
		for (const bp of BREAKPOINT_NAMES) {
			expect(seed[bp].map((i) => i.i).sort()).toEqual([...WIDGET_IDS].sort());
		}
	});

	// A height cap sized for taller rows once cut the tall cards here without a word.
	test("no card is cut or moved by cleaning: the seed is a fixed point", () => {
		const seed = seedLayouts();
		for (const bp of BREAKPOINT_NAMES) {
			expect(sanitizeLayout(seed[bp], bp)).toEqual(seed[bp]);
			for (const item of seed[bp]) {
				const size = WIDGETS.find((w) => w.id === item.i)?.size[bp];
				expect({ w: item.w, h: item.h }).toEqual({ w: size?.w ?? 0, h: size?.h ?? 0 });
			}
		}
	});

	// Heights are tuned by measuring the cards, so this reads them from the registry: it pins the shape, not the numbers.
	test("the wide board is the Overview as it was: three rows", () => {
		const { lg } = seedLayouts();
		const row = (ids: WidgetId[]) => ids.map((id) => place(lg, id)?.y);
		const h = (id: WidgetId) => place(lg, id)?.h ?? 0;
		const second = h("needs-reply");
		const third = second + h("threads-radar");
		expect(row(["needs-reply", "volume", "inbox-weather", "streak"])).toEqual([0, 0, 0, 0]);
		expect(new Set(["needs-reply", "volume", "inbox-weather", "streak"].map((id) => h(id as WidgetId))).size).toBe(1);
		expect(row(["mail-mix", "threads-radar", "daily-brief"])).toEqual([second, second, second]);
		// Rhythm sits under the brief, and the two together are as tall as their neighbours.
		expect(place(lg, "rhythm-spark")).toMatchObject({ x: 9, y: second + h("daily-brief") });
		expect(h("daily-brief") + h("rhythm-spark")).toBe(h("threads-radar"));
		expect(h("mail-mix")).toBe(h("threads-radar"));
		expect(row(["orbit", "reply-debt"])).toEqual([third, third]);
		expect(h("orbit")).toBe(h("reply-debt"));
	});

	test("the tablet board keeps its side-by-side pairs level", () => {
		const { md } = seedLayouts();
		const at = (id: WidgetId) => place(md, id);
		expect((at("daily-brief")?.h ?? 0) + (at("rhythm-spark")?.h ?? 0)).toBe(at("reply-debt")?.h ?? -1);
		expect(at("needs-reply")?.y).toBe(at("volume")?.y);
		expect(at("mail-mix")?.y).toBe(at("inbox-weather")?.y);
		expect(at("inbox-weather")?.y).toBe(at("streak")?.y);
		expect(at("mail-mix")?.h).toBe(at("inbox-weather")?.h);
	});

	test("the phone board is one column in today's order", () => {
		const { sm } = seedLayouts();
		expect(sm.every((i) => i.x === 0 && i.w === 2)).toBe(true);
		expect(readingOrder(sm)).toEqual([
			"daily-brief",
			"rhythm-spark",
			"needs-reply",
			"reply-debt",
			"volume",
			"inbox-weather",
			"streak",
			"mail-mix",
			"threads-radar",
			"orbit",
		]);
	});

	test("callers cannot spoil the seed for each other", () => {
		seedLayouts().lg.length = 0;
		expect(seedLayouts().lg).toHaveLength(WIDGET_IDS.length);
	});
});

describe("sanitizeLayout", () => {
	test("drops unknown and duplicate cards", () => {
		const out = sanitizeLayout(
			[
				{ i: "streak", x: 0, y: 0, w: 2, h: 8 },
				{ i: "a-card-from-the-future", x: 4, y: 0, w: 4, h: 2 },
				{ i: "streak", x: 8, y: 0, w: 2, h: 8 },
			],
			"lg",
		);
		expect(out.map((i) => i.i)).toEqual(["streak"]);
	});

	test("clamps size to the card's limits and the board, and keeps it on the board", () => {
		const [streak] = sanitizeLayout([{ i: "streak", x: 11, y: -5, w: 99, h: 0.4 }], "lg");
		expect(streak).toEqual({ i: "streak", x: 8, y: 0, w: 4, h: 5 });
	});

	test("rounds fractional cells", () => {
		const [volume] = sanitizeLayout([{ i: "volume", x: 1.4, y: 0, w: 3.6, h: 8.2 }], "lg");
		expect(volume).toMatchObject({ x: 1, w: 4, h: 8 });
	});

	test("resolves overlaps by pushing down", () => {
		const out = sanitizeLayout(
			[
				{ i: "volume", x: 0, y: 0, w: 4, h: 8 },
				{ i: "needs-reply", x: 2, y: 0, w: 4, h: 8 },
			],
			"lg",
		);
		expect(out).toHaveLength(2);
		const [a, b] = out as [BoardItem, BoardItem];
		expect(overlaps(a, b)).toBe(false);
	});

	test("does not mutate its input", () => {
		const raw = [{ i: "volume", x: 0, y: 5, w: 4, h: 8 }];
		sanitizeLayout(raw, "lg");
		expect(raw[0]).toEqual({ i: "volume", x: 0, y: 5, w: 4, h: 8 });
	});
});

describe("widgetsOn", () => {
	test("no record, or on: null, is every card", () => {
		expect(widgetsOn(undefined)).toEqual([...WIDGET_IDS]);
		expect(widgetsOn({ on: null, known: [] })).toEqual([...WIDGET_IDS]);
	});

	test("a card the record has heard of and does not list stays off", () => {
		const on = widgetsOn({ on: ["volume"], known: [...WIDGET_IDS] });
		expect(on).toEqual(["volume"]);
	});

	test("a card the record has never heard of is on: a later release's new card reaches a saved board", () => {
		const before = WIDGET_IDS.filter((id) => id !== "orbit");
		const on = widgetsOn({ on: ["volume"], known: before });
		expect(on).toEqual(["volume", "orbit"]);
	});

	test("ids from a newer release are ignored here, not treated as cards", () => {
		expect(widgetsOn({ on: ["volume", "a-card-from-the-future"], known: [...WIDGET_IDS, "a-card-from-the-future"] })).toEqual(["volume"]);
	});

	test("an empty board stays empty", () => {
		expect(widgetsOn({ on: [], known: [...WIDGET_IDS] })).toEqual([]);
	});
});

describe("resolveBoard", () => {
	test("nothing saved is the seed", () => {
		expect(resolveBoard(null)).toEqual({ on: [...WIDGET_IDS], layouts: seedLayouts() });
		expect(resolveBoard({})).toEqual({ on: [...WIDGET_IDS], layouts: seedLayouts() });
	});

	test("a part reset to null follows the seed", () => {
		const doc: BoardDoc = { lg: { items: null, updatedAt: AT }, widgets: { on: null, known: [...WIDGET_IDS], updatedAt: AT } };
		expect(resolveBoard(doc).layouts).toEqual(seedLayouts());
	});

	test("an emptied board stays empty at every width", () => {
		const doc: BoardDoc = { widgets: { on: [], known: [...WIDGET_IDS], updatedAt: AT } };
		expect(resolveBoard(doc)).toEqual({ on: [], layouts: { lg: [], md: [], sm: [] } });
	});

	test("a width that was never saved starts from the seed, limited to the cards on the board", () => {
		const doc: BoardDoc = {
			lg: { items: [{ i: "volume", x: 0, y: 0, w: 6, h: 9 }], updatedAt: AT },
			widgets: { on: ["volume"], known: [...WIDGET_IDS], updatedAt: AT },
		};
		const { layouts } = resolveBoard(doc);
		expect(layouts.lg).toEqual([{ i: "volume", x: 0, y: 0, w: 6, h: 9 }]);
		expect(layouts.md.map((i) => i.i)).toEqual(["volume"]);
		expect(layouts.sm.map((i) => i.i)).toEqual(["volume"]);
		expect(layouts.sm[0]?.y).toBe(0);
	});

	test("the widgets part wins over a layout that disagrees: a card it lists is placed at the bottom", () => {
		// Device A added Streak and wrote every part; device B's newer phone layout lacks it.
		const doc: BoardDoc = {
			sm: { items: [{ i: "volume", x: 0, y: 0, w: 2, h: 9 }], updatedAt: AT },
			widgets: { on: ["volume", "streak"], known: [...WIDGET_IDS], updatedAt: AT },
		};
		const { layouts } = resolveBoard(doc);
		expect(layouts.sm).toEqual([
			{ i: "volume", x: 0, y: 0, w: 2, h: 9 },
			{ i: "streak", x: 0, y: 9, w: 2, h: sizeLimits("streak", "sm").h },
		]);
		assertClean(layouts);
	});

	test("the widgets part wins over a layout that disagrees: a card it dropped is not drawn", () => {
		// The desktop removed Orbit; a phone that had not heard yet rearranged its own layout.
		const doc: BoardDoc = {
			sm: {
				items: [
					{ i: "orbit", x: 0, y: 0, w: 2, h: 14 },
					{ i: "volume", x: 0, y: 14, w: 2, h: 9 },
				],
				updatedAt: AT,
			},
			widgets: { on: ["volume"], known: [...WIDGET_IDS], updatedAt: AT },
		};
		expect(resolveBoard(doc).layouts.sm).toEqual([{ i: "volume", x: 0, y: 0, w: 2, h: 9 }]);
	});

	test("a card from a later release in a saved layout is not drawn, and breaks nothing", () => {
		const doc: BoardDoc = {
			lg: {
				items: [
					{ i: "a-card-from-the-future", x: 0, y: 0, w: 4, h: 8 },
					{ i: "volume", x: 4, y: 0, w: 4, h: 8 },
				],
				updatedAt: AT,
			},
			widgets: { on: ["volume", "a-card-from-the-future"], known: [...WIDGET_IDS, "a-card-from-the-future"], updatedAt: AT },
		};
		const board = resolveBoard(doc);
		expect(board.on).toEqual(["volume"]);
		expect(board.layouts.lg).toEqual([{ i: "volume", x: 4, y: 0, w: 4, h: 8 }]);
	});
});

describe("addWidget / removeWidget", () => {
	test("removes from every width and closes the gap", () => {
		const out = removeWidget(seedLayouts(), "daily-brief");
		for (const bp of BREAKPOINT_NAMES) expect(out[bp].some((i) => i.i === "daily-brief")).toBe(false);
		expect(out.sm[0]).toMatchObject({ i: "rhythm-spark", y: 0 });
		assertClean(out);
	});

	test("adds to every width at the bottom, once", () => {
		const without = removeWidget(seedLayouts(), "volume");
		const out = addWidget(without, "volume");
		for (const bp of BREAKPOINT_NAMES) {
			expect(out[bp].filter((i) => i.i === "volume")).toHaveLength(1);
			const added = place(out[bp], "volume");
			expect(out[bp].every((i) => i.i === "volume" || i.y + i.h <= (added?.y ?? 0) || !overlapsColumns(i, added))).toBe(true);
		}
		expect(addWidget(out, "volume")).toEqual(out);
		assertClean(out);
	});
});

function overlapsColumns(a: BoardItem, b: BoardItem | undefined) {
	return !!b && a.x < b.x + b.w && b.x < a.x + a.w;
}

describe("nudge", () => {
	const row: BoardItem[] = [
		{ i: "volume", x: 0, y: 0, w: 4, h: 8 },
		{ i: "needs-reply", x: 4, y: 0, w: 4, h: 8 },
	];

	test("moves right and stops at the edge", () => {
		const moved = nudge([{ i: "volume", x: 0, y: 0, w: 4, h: 8 }], "volume", "right", "move", "lg");
		expect(moved).toEqual([{ i: "volume", x: 1, y: 0, w: 4, h: 8 }]);
		expect(nudge([{ i: "volume", x: 8, y: 0, w: 4, h: 8 }], "volume", "right", "move", "lg")).toBeNull();
		expect(nudge([{ i: "volume", x: 0, y: 0, w: 4, h: 8 }], "volume", "left", "move", "lg")).toBeNull();
	});

	test("moving down jumps past the card below instead of floating back", () => {
		const stack: BoardItem[] = [
			{ i: "volume", x: 0, y: 0, w: 2, h: 9 },
			{ i: "streak", x: 0, y: 9, w: 2, h: 6 },
		];
		const out = nudge(stack, "volume", "down", "move", "sm");
		expect(out && place(out, "streak")?.y).toBe(0);
		expect(out && place(out, "volume")?.y).toBe(6);
	});

	test("a lone card at the top cannot move up or down", () => {
		const lone: BoardItem[] = [{ i: "volume", x: 0, y: 0, w: 4, h: 8 }];
		expect(nudge(lone, "volume", "up", "move", "lg")).toBeNull();
		expect(nudge(lone, "volume", "down", "move", "lg")).toBeNull();
	});

	test("resizes within limits and pushes neighbours, not itself", () => {
		const out = nudge(row, "volume", "right", "resize", "lg");
		expect(out && place(out, "volume")).toEqual({ i: "volume", x: 0, y: 0, w: 5, h: 8 });
		const neighbour = out && place(out, "needs-reply");
		expect(neighbour && overlaps(neighbour, { i: "volume", x: 0, y: 0, w: 5, h: 8 })).toBe(false);
		expect(nudge(row, "volume", "up", "resize", "lg")).toBeNull(); // already at its minimum height
	});

	test("a card can grow past the old 12-row cap", () => {
		const tall: BoardItem[] = [{ i: "orbit", x: 0, y: 0, w: 8, h: 15 }];
		expect(nudge(tall, "orbit", "down", "resize", "lg")).toEqual([{ i: "orbit", x: 0, y: 0, w: 8, h: 16 }]);
	});

	test("never mutates the layout it is given", () => {
		const before = structuredClone(row);
		nudge(row, "volume", "right", "move", "lg");
		nudge(row, "volume", "down", "resize", "lg");
		expect(row).toEqual(before);
	});
});

test("readingOrder: top to bottom, then left to right", () => {
	expect(
		readingOrder([
			{ i: "orbit", x: 0, y: 8, w: 8, h: 15 },
			{ i: "streak", x: 10, y: 0, w: 2, h: 8 },
			{ i: "volume", x: 0, y: 0, w: 4, h: 8 },
		]),
	).toEqual(["volume", "streak", "orbit"]);
});
