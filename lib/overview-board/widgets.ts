import type { Breakpoint } from "./types";

/*
 * The cards that can sit on the Overview board. Pure data: the grid rules, the
 * sync code and the tour read it, and the components that draw each card are
 * matched to these ids in components/overview/board.tsx.
 *
 * Sizes are in grid cells, per board width (see lib/overview-board/layout.ts
 * for the cell size). `w` and `h` are the size a card starts at and the size it
 * comes back at when re-added; the minimums are the smallest tile the card
 * still reads well in.
 */

export interface WidgetSize {
	w: number;
	h: number;
	minW: number;
	minH: number;
	maxW?: number;
}

export interface WidgetDef {
	/** Stored in saved boards, so never rename one. */
	id: string;
	title: string;
	/** One line for the "Add card" menu. */
	blurb: string;
	size: Record<Breakpoint, WidgetSize>;
}

export const WIDGETS = [
	{
		id: "needs-reply",
		title: "Needs reply",
		blurb: "Who is waiting on you, and who you are waiting on",
		size: {
			lg: { w: 4, h: 8, minW: 4, minH: 7 },
			md: { w: 4, h: 8, minW: 4, minH: 7 },
			sm: { w: 2, h: 8, minW: 2, minH: 7 },
		},
	},
	{
		id: "volume",
		title: "Volume",
		blurb: "Mail you got and mail you sent",
		size: {
			lg: { w: 4, h: 8, minW: 3, minH: 8 },
			md: { w: 4, h: 8, minW: 4, minH: 8 },
			sm: { w: 2, h: 8, minW: 2, minH: 8 },
		},
	},
	{
		id: "inbox-weather",
		title: "Inbox weather",
		blurb: "How calm or stormy your inbox is today",
		size: {
			lg: { w: 2, h: 8, minW: 2, minH: 7 },
			md: { w: 2, h: 10, minW: 2, minH: 8 },
			sm: { w: 2, h: 7, minW: 1, minH: 7 },
		},
	},
	{
		id: "streak",
		title: "Reply-zero streak",
		blurb: "Days in a row with nobody left waiting",
		size: {
			lg: { w: 2, h: 8, minW: 2, minH: 5, maxW: 4 },
			md: { w: 2, h: 10, minW: 2, minH: 6, maxW: 4 },
			sm: { w: 2, h: 6, minW: 1, minH: 5 },
		},
	},
	{
		id: "mail-mix",
		title: "Mail mix",
		blurb: "People, notifications, newsletters and receipts",
		size: {
			lg: { w: 3, h: 14, minW: 3, minH: 8 },
			md: { w: 4, h: 10, minW: 3, minH: 8 },
			sm: { w: 2, h: 10, minW: 2, minH: 8 },
		},
	},
	{
		id: "threads-radar",
		title: "Threads radar",
		blurb: "Busy threads, and noise you can quiet",
		size: {
			lg: { w: 6, h: 14, minW: 4, minH: 9 },
			md: { w: 8, h: 12, minW: 4, minH: 9 },
			sm: { w: 2, h: 23, minW: 2, minH: 9 },
		},
	},
	{
		id: "daily-brief",
		title: "Daily brief",
		blurb: "The few things worth your time today",
		size: {
			lg: { w: 3, h: 8, minW: 3, minH: 6 },
			md: { w: 4, h: 8, minW: 4, minH: 6 },
			sm: { w: 2, h: 8, minW: 2, minH: 7 },
		},
	},
	{
		id: "rhythm-spark",
		title: "Rhythm",
		blurb: "How your mail arrives over 30 days",
		size: {
			lg: { w: 3, h: 6, minW: 2, minH: 5 },
			md: { w: 4, h: 5, minW: 3, minH: 5 },
			sm: { w: 2, h: 5, minW: 2, minH: 5 },
		},
	},
	{
		id: "orbit",
		title: "Your orbit",
		blurb: "A map of who writes to you",
		size: {
			lg: { w: 8, h: 15, minW: 4, minH: 12 },
			md: { w: 8, h: 15, minW: 4, minH: 12 },
			sm: { w: 2, h: 15, minW: 2, minH: 9 },
		},
	},
	{
		id: "reply-debt",
		title: "Reply debt",
		blurb: "Hours of replies you owe, and who went quiet",
		size: {
			lg: { w: 4, h: 15, minW: 3, minH: 7 },
			md: { w: 4, h: 13, minW: 4, minH: 7 },
			sm: { w: 2, h: 13, minW: 2, minH: 7 },
		},
	},
] as const satisfies readonly WidgetDef[];

export type WidgetId = (typeof WIDGETS)[number]["id"];

/** Every card, in the order the "Add card" menu lists them. */
export const WIDGET_IDS: readonly WidgetId[] = WIDGETS.map((w) => w.id);

const DEFS: ReadonlyMap<string, WidgetDef> = new Map(WIDGETS.map((w) => [w.id, w]));

export function isWidgetId(id: string): id is WidgetId {
	return DEFS.has(id);
}

export function widgetDef(id: WidgetId): WidgetDef {
	const def = DEFS.get(id);
	if (!def) throw new Error(`Unknown widget: ${id}`);
	return def;
}
