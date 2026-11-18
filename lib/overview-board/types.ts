import { z } from "zod";

/*
 * The Overview board's durable record: where each card sits at each board
 * width, and which cards are on the board. One shape on the wire and in
 * localStorage; the `overview_board` rows hold the same parts with the stamp
 * in its own column.
 *
 * zod only. The API route imports this, so nothing here may pull in the grid
 * library or the card registry: the server checks shape, never which cards
 * exist. A tab from an older release shares these rows with a newer one, and
 * neither may drop a card just because it has never heard of it.
 */

export const BREAKPOINT_NAMES = ["lg", "md", "sm"] as const;
export type Breakpoint = (typeof BREAKPOINT_NAMES)[number];

/** The record syncs in four independent parts: one layout per board width, plus which cards are on. */
export const BOARD_PARTS = ["lg", "md", "sm", "widgets"] as const;
export type BoardPart = (typeof BOARD_PARTS)[number];

const MAX_ITEMS = 64;
const widgetId = z.string().min(1).max(64);
const stamp = z.iso.datetime();

export const rawItemSchema = z
	.object({
		i: widgetId,
		x: z.number().int().min(0).max(99),
		y: z.number().int().min(0).max(9999),
		w: z.number().int().min(1).max(99),
		h: z.number().int().min(1).max(999),
	})
	.strict();
export type RawItem = z.infer<typeof rawItemSchema>;

const items = z.array(rawItemSchema).max(MAX_ITEMS).nullable();
const on = z.array(widgetId).max(MAX_ITEMS).nullable();
const known = z.array(widgetId).max(MAX_ITEMS * 2);

/** What a row's `data` column holds. `items: null` is the default layout. */
export const layoutDataSchema = z.object({ items }).strict();
/** `on: null` is every card. `known` is every card id some client had heard of when it last wrote. */
export const widgetsDataSchema = z.object({ on, known }).strict();

export type LayoutData = z.infer<typeof layoutDataSchema>;
export type WidgetsData = z.infer<typeof widgetsDataSchema>;

export const layoutPartSchema = z.object({ items, updatedAt: stamp }).strict();
export const widgetsPartSchema = z.object({ on, known, updatedAt: stamp }).strict();

export const boardDocSchema = z
	.object({
		lg: layoutPartSchema.optional(),
		md: layoutPartSchema.optional(),
		sm: layoutPartSchema.optional(),
		widgets: widgetsPartSchema.optional(),
	})
	.strict();

export type LayoutPart = z.infer<typeof layoutPartSchema>;
export type WidgetsPart = z.infer<typeof widgetsPartSchema>;
/** A part that was never written is absent, and reads as its default. */
export type BoardDoc = z.infer<typeof boardDocSchema>;

/** GET and PUT /api/overview/board. `db: false` = no database configured; the device copy is the only copy. */
export type BoardResponse = { ok: true; data: BoardDoc | null; db: boolean };
