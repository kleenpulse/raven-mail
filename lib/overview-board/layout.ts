import { bottom, moveElement, verticalCompactor, type LayoutItem } from "react-grid-layout/core";
import { BREAKPOINT_NAMES, type BoardDoc, type Breakpoint, type RawItem, type WidgetsPart } from "./types";
import { WIDGET_IDS, isWidgetId, widgetDef, type WidgetId } from "./widgets";

/*
 * The Overview board's layout rules, pure and clock-free. The grid, the store
 * and the tests all pass through here, so a layout from another device, from
 * localStorage or from a drag is cleaned the same way.
 *
 * Nothing here decides what gets saved. Cleaning drops cards this release does
 * not know, which is right for drawing and wrong for storage; the write path
 * (lib/overview-board/sync.ts) puts them back.
 */

/** Board breakpoints, by the board's own width (not the viewport: the nav rail eats into it). */
export const BREAKPOINTS = { lg: 1100, md: 600, sm: 0 } as const satisfies Record<Breakpoint, number>;
/** Two columns on a phone so the two small cards can sit side by side; every other card is full width there. */
export const COLS: Readonly<Record<Breakpoint, number>> = { lg: 12, md: 8, sm: 2 };

/** A tile of height `h` is `h * (ROW_HEIGHT + GAP) - GAP` pixels tall. */
export const ROW_HEIGHT = 32;
export const GAP = 16;
/** 40 rows is 1904px. Every starting height must fit under this, or cleaning would cut it. */
const MAX_H = 40;
const MAX_Y = 400;

export interface BoardItem {
	i: WidgetId;
	x: number;
	y: number;
	w: number;
	h: number;
}

export type BoardLayouts = Record<Breakpoint, BoardItem[]>;

/** What the grid draws: the cards on the board, and where each sits at each width. */
export interface Board {
	on: WidgetId[];
	layouts: BoardLayouts;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

/** A card's size limits at one board width. */
export function sizeLimits(id: WidgetId, bp: Breakpoint) {
	const size = widgetDef(id).size[bp];
	const cols = COLS[bp];
	const maxW = Math.min(size.maxW ?? cols, cols);
	const minW = Math.min(size.minW, maxW);
	return {
		w: clamp(size.w, minW, maxW),
		h: clamp(size.h, size.minH, MAX_H),
		minW,
		maxW,
		minH: size.minH,
		maxH: MAX_H,
	};
}

function pick(item: Pick<LayoutItem, "i" | "x" | "y" | "w" | "h">): BoardItem {
	return { i: item.i as WidgetId, x: item.x, y: item.y, w: item.w, h: item.h };
}

/** Stacks items upwards and pushes overlaps down, as the grid itself does. */
function compact(items: readonly BoardItem[], cols: number): BoardItem[] {
	return verticalCompactor.compact(items, cols).map(pick);
}

/**
 * Cleans a layout for drawing: unknown and duplicate cards dropped, sizes
 * clamped to the card's limits and the column count, positions kept on the
 * board, overlaps resolved. Idempotent, and stable for a layout that is
 * already clean.
 */
export function sanitizeLayout(raw: readonly RawItem[], bp: Breakpoint): BoardItem[] {
	const cols = COLS[bp];
	const seen = new Set<string>();
	const items: BoardItem[] = [];
	for (const r of raw) {
		if (!isWidgetId(r.i) || seen.has(r.i)) continue;
		seen.add(r.i);
		const lim = sizeLimits(r.i, bp);
		const w = clamp(Math.round(r.w), lim.minW, lim.maxW);
		const h = clamp(Math.round(r.h), lim.minH, lim.maxH);
		items.push({
			i: r.i,
			x: clamp(Math.round(r.x), 0, cols - w),
			y: clamp(Math.round(r.y), 0, MAX_Y),
			w,
			h,
		});
	}
	return compact(items, cols);
}

/** Adds a card at its starting size, at the bottom left of one layout. */
function placeBelow(layout: readonly BoardItem[], id: WidgetId, bp: Breakpoint): BoardItem[] {
	const lim = sizeLimits(id, bp);
	return [...layout, { i: id, x: 0, y: bottom(layout), w: lim.w, h: lim.h }];
}

/*
 * The starting board, which is the Overview as it was before it could be
 * rearranged. Each entry is a card, its column, and the band it sits in;
 * sizes come from the registry and compaction works out the rows. So tuning a
 * card's starting height is one number in widgets.ts, with nothing to
 * re-add here.
 */
type Slot = readonly [id: WidgetId, x: number, band: number];

const SEED: Record<Breakpoint, readonly Slot[]> = {
	lg: [
		["needs-reply", 0, 0],
		["volume", 4, 0],
		["inbox-weather", 8, 0],
		["streak", 10, 0],
		["mail-mix", 0, 1],
		["threads-radar", 3, 1],
		["daily-brief", 9, 1],
		["rhythm-spark", 9, 2],
		["orbit", 0, 3],
		["reply-debt", 8, 3],
	],
	md: [
		["daily-brief", 0, 0],
		["reply-debt", 4, 0],
		["rhythm-spark", 0, 1],
		["needs-reply", 0, 2],
		["volume", 4, 2],
		["mail-mix", 0, 3],
		["inbox-weather", 4, 3],
		["streak", 6, 3],
		["threads-radar", 0, 4],
		["orbit", 0, 5],
	],
	sm: [
		["daily-brief", 0, 0],
		["rhythm-spark", 0, 1],
		["needs-reply", 0, 2],
		["reply-debt", 0, 3],
		["volume", 0, 4],
		["inbox-weather", 0, 5],
		["streak", 0, 6],
		["mail-mix", 0, 7],
		["threads-radar", 0, 8],
		["orbit", 0, 9],
	],
};

function seedOf(bp: Breakpoint): BoardItem[] {
	const raw = SEED[bp].map(([id, x, band]) => {
		const { w, h } = sizeLimits(id, bp);
		return { i: id, x, y: band, w, h };
	});
	return sanitizeLayout(raw, bp);
}

let seed: BoardLayouts | undefined;

/** The starting board. Callers get their own arrays; the items are shared and never mutated. */
export function seedLayouts(): BoardLayouts {
	seed ??= { lg: seedOf("lg"), md: seedOf("md"), sm: seedOf("sm") };
	return { lg: [...seed.lg], md: [...seed.md], sm: [...seed.sm] };
}

/**
 * The cards on the board, in menu order. No part, or `on: null`, is every
 * card. A card this record has never heard of (`known` lacks it) is on too:
 * that is how a card added in a later release reaches a saved board, while a
 * card the user removed stays removed.
 */
export function widgetsOn(part: Pick<WidgetsPart, "on" | "known"> | undefined): WidgetId[] {
	if (!part || part.on === null) return [...WIDGET_IDS];
	const on = new Set(part.on);
	const known = new Set(part.known);
	return WIDGET_IDS.filter((id) => on.has(id) || !known.has(id));
}

/** Makes a layout hold exactly the cards on the board: others dropped, missing ones placed at the bottom. */
function fit(layout: readonly BoardItem[], on: readonly WidgetId[], bp: Breakpoint): BoardItem[] {
	let next = layout.filter((item) => on.includes(item.i));
	for (const id of on) {
		if (!next.some((item) => item.i === id)) next = placeBelow(next, id, bp);
	}
	return sanitizeLayout(next, bp);
}

/**
 * Builds the board from the saved record. The `widgets` part decides which
 * cards are on; a layout part that disagrees with it (two devices edited at
 * once) is repaired here, in memory, and never written back for it.
 */
export function resolveBoard(doc: BoardDoc | null): Board {
	const on = widgetsOn(doc?.widgets);
	const seeds = seedLayouts();
	const layouts = {} as BoardLayouts;
	for (const bp of BREAKPOINT_NAMES) {
		const items = doc?.[bp]?.items;
		layouts[bp] = fit(items ? sanitizeLayout(items, bp) : seeds[bp], on, bp);
	}
	return { on, layouts };
}

/** Adds a card to every layout (a no-op where it is already there). */
export function addWidget(layouts: BoardLayouts, id: WidgetId): BoardLayouts {
	const out = {} as BoardLayouts;
	for (const bp of BREAKPOINT_NAMES) {
		const layout = layouts[bp];
		out[bp] = layout.some((item) => item.i === id) ? layout : sanitizeLayout(placeBelow(layout, id, bp), bp);
	}
	return out;
}

/** Removes a card from every layout and closes the gap. */
export function removeWidget(layouts: BoardLayouts, id: WidgetId): BoardLayouts {
	const out = {} as BoardLayouts;
	for (const bp of BREAKPOINT_NAMES) {
		out[bp] = compact(
			layouts[bp].filter((item) => item.i !== id),
			COLS[bp],
		);
	}
	return out;
}

export function sameLayout(a: readonly BoardItem[], b: readonly BoardItem[]): boolean {
	return (
		a.length === b.length &&
		a.every((item, n) => {
			const o = b[n];
			return o?.i === item.i && o.x === item.x && o.y === item.y && o.w === item.w && o.h === item.h;
		})
	);
}

function samePlaces(a: readonly BoardItem[], b: readonly BoardItem[]): boolean {
	return a.every((item) => {
		const other = b.find((o) => o.i === item.i);
		return other?.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
	});
}

/** Reading order: top to bottom, then left to right. The grid's DOM order outside edit mode. */
export function readingOrder(layout: readonly BoardItem[]): WidgetId[] {
	return [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.i);
}

export type KeyAction = "left" | "right" | "up" | "down";

/**
 * Keyboard move and resize for one card (drag has no keyboard path). A move
 * keeps stepping until the compacted board actually changes, so Down jumps
 * past the card below instead of floating straight back. Null: no change.
 */
export function nudge(
	layout: readonly BoardItem[],
	id: WidgetId,
	action: KeyAction,
	mode: "move" | "resize",
	bp: Breakpoint,
): BoardItem[] | null {
	const cols = COLS[bp];
	const item = layout.find((l) => l.i === id);
	if (!item) return null;
	const dx = action === "left" ? -1 : action === "right" ? 1 : 0;
	const dy = action === "up" ? -1 : action === "down" ? 1 : 0;

	if (mode === "resize") {
		const lim = sizeLimits(id, bp);
		const w = clamp(item.w + dx, lim.minW, Math.min(lim.maxW, cols - item.x));
		const h = clamp(item.h + dy, lim.minH, lim.maxH);
		if (w === item.w && h === item.h) return null;
		// The resized card goes first, so its neighbours are the ones pushed down.
		const resized = { ...item, w, h };
		const next = compact([resized, ...layout.filter((l) => l.i !== id)], cols);
		return samePlaces(next, layout) ? null : next;
	}

	const maxSteps = dy > 0 ? bottom(layout) + 1 : Math.max(cols, item.y + 1);
	for (let step = 1; step <= maxSteps; step++) {
		const x = item.x + dx * step;
		const y = item.y + dy * step;
		if (x < 0 || x + item.w > cols || y < 0) return null;
		// moveElement mutates the items it moves and pushes: work on a copy.
		const copy = layout.map((l) => ({ ...l }));
		const target = copy.find((l) => l.i === id) ?? { ...item };
		const moved = moveElement(copy, target, x, y, true, false, "vertical", cols);
		const next = compact(moved.map(pick), cols);
		if (!samePlaces(next, layout)) return next;
	}
	return null;
}
