import { isNewer } from "@/lib/sync/is-newer";
import type { BoardItem } from "./layout";
import {
	BOARD_PARTS,
	BREAKPOINT_NAMES,
	layoutPartSchema,
	widgetsPartSchema,
	type BoardDoc,
	type BoardPart,
	type Breakpoint,
	type RawItem,
} from "./types";
import { WIDGET_IDS, isWidgetId, type WidgetId } from "./widgets";

/*
 * Pure halves of the board sync, kept apart from the store so they test
 * without a DOM. The device copy is the source of truth; the database rows are
 * a replica, reconciled one part at a time by last-write-wins on `updatedAt`.
 *
 * Only a user's own action may stamp a part (see the write* functions). The
 * grid re-packing itself on load, or this code repairing a layout, is not an
 * edit: if those were stamped, a device that only looked at the board would
 * beat a real change made somewhere else.
 */

/** One blob per mailbox. Without a database it is the only copy, so two mailboxes on one browser must never share it. */
export function boardStorageKey(owner: string): string {
	return `raven-board:v1:${owner}`;
}

/** Reads a record one part at a time: a part that fails its schema is dropped, the rest stand. */
export function parseDoc(raw: unknown): BoardDoc {
	const doc: BoardDoc = {};
	if (typeof raw !== "object" || raw === null) return doc;
	const source = raw as Record<string, unknown>;
	for (const bp of BREAKPOINT_NAMES) {
		const parsed = layoutPartSchema.safeParse(source[bp]);
		if (parsed.success) doc[bp] = parsed.data;
	}
	const widgets = widgetsPartSchema.safeParse(source.widgets);
	if (widgets.success) doc.widgets = widgets.data;
	return doc;
}

/**
 * The device copy. Null means there is none yet, which is different from an
 * empty record: an empty one says the first sync has settled on this device
 * and the board really is the default.
 */
export function parseBlob(raw: string | null): BoardDoc | null {
	if (raw === null) return null;
	try {
		return parseDoc(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function serializeBlob(doc: BoardDoc): string {
	return JSON.stringify(doc);
}

export type Reconcile = {
	/** Parts the other side holds a newer copy of. */
	adopt: BoardDoc;
	/** Parts this side holds a newer copy of. */
	push: BoardPart[];
};

/** What to do after reading the other copy, part by part: take its newer parts, send up ours. */
export function reconcile(local: BoardDoc, remote: BoardDoc | null): Reconcile {
	const adopt: BoardDoc = {};
	const push: BoardPart[] = [];
	for (const part of BOARD_PARTS) {
		const mine = local[part]?.updatedAt ?? null;
		const theirs = remote?.[part]?.updatedAt ?? null;
		if (isNewer(theirs, mine)) Object.assign(adopt, { [part]: remote?.[part] });
		else if (isNewer(mine, theirs)) push.push(part);
	}
	return { adopt, push };
}

/** Both copies, keeping the newer of each part. */
export function mergeNewer(a: BoardDoc, b: BoardDoc): BoardDoc {
	return { ...a, ...reconcile(a, b).adopt };
}

/**
 * The record after a save came back with what the database now holds. Each
 * part keeps the newer copy, as always, with one more rule: a part that was
 * sent and not edited since takes the stored copy even when its stamp is
 * older. That happens only when the server pinned a stamp from a clock running
 * ahead. The content is still ours, but without the stored stamp this device
 * would go on believing it holds something newer, and would later push it over
 * a real edit made on another device.
 */
export function afterSave(local: BoardDoc, sent: BoardDoc, stored: BoardDoc): BoardDoc {
	const next = mergeNewer(local, stored);
	for (const part of BOARD_PARTS) {
		const ours = sent[part];
		const theirs = stored[part];
		if (ours && theirs && local[part]?.updatedAt === ours.updatedAt && theirs.updatedAt !== ours.updatedAt) {
			Object.assign(next, { [part]: theirs });
		}
	}
	return next;
}

/** Only the named parts of a record: the body of a save. */
export function pickParts(doc: BoardDoc, parts: Iterable<BoardPart>): BoardDoc {
	const out: BoardDoc = {};
	for (const part of parts) {
		if (doc[part]) Object.assign(out, { [part]: doc[part] });
	}
	return out;
}

/**
 * A stamp for an edit made now. Never older than the newest stamp this device
 * has seen for the part: on a device whose clock runs behind, plain "now"
 * would lose every save, and the card would snap back a moment after each drop.
 */
export function nextStamp(seen: string | undefined, now = Date.now()): string {
	const floor = seen ? Date.parse(seen) + 1 : 0;
	return new Date(Math.max(now, Number.isNaN(floor) ? 0 : floor)).toISOString();
}

function unique<T>(list: readonly T[]): T[] {
	return [...new Set(list)];
}

/** A user moved, resized or re-packed the cards at one board width. */
export function writeLayout(doc: BoardDoc, bp: Breakpoint, items: readonly BoardItem[], now?: number): BoardDoc {
	// Cards this release does not know keep their saved place; a newer tab put them there.
	const unknown: RawItem[] = (doc[bp]?.items ?? []).filter((item) => !isWidgetId(item.i));
	return { ...doc, [bp]: { items: [...items, ...unknown], updatedAt: nextStamp(doc[bp]?.updatedAt, now) } };
}

/** A user added or removed a card. */
export function writeWidgets(doc: BoardDoc, on: readonly WidgetId[], now?: number): BoardDoc {
	const stored = doc.widgets;
	// `on: null` means every card, so every card the record has heard of is on, known to this release or not.
	const storedOn = stored ? (stored.on ?? stored.known) : [];
	const unknownOn = storedOn.filter((id) => !isWidgetId(id));
	return {
		...doc,
		widgets: {
			on: unique([...on, ...unknownOn]),
			known: unique([...(stored?.known ?? []), ...WIDGET_IDS]),
			updatedAt: nextStamp(stored?.updatedAt, now),
		},
	};
}

/** A user reset the board: every part goes back to its default, and keeps following the default from here on. */
export function writeReset(doc: BoardDoc, now?: number): BoardDoc {
	const next: BoardDoc = {};
	for (const bp of BREAKPOINT_NAMES) next[bp] = { items: null, updatedAt: nextStamp(doc[bp]?.updatedAt, now) };
	next.widgets = {
		on: null,
		known: unique([...(doc.widgets?.known ?? []), ...WIDGET_IDS]),
		updatedAt: nextStamp(doc.widgets?.updatedAt, now),
	};
	return next;
}

/** Puts back an earlier record (Undo), stamped as a new edit so it wins everywhere. */
export function writeRestore(doc: BoardDoc, earlier: BoardDoc, now?: number): BoardDoc {
	const next: BoardDoc = {};
	for (const bp of BREAKPOINT_NAMES) {
		next[bp] = { items: earlier[bp]?.items ?? null, updatedAt: nextStamp(doc[bp]?.updatedAt, now) };
	}
	next.widgets = {
		on: earlier.widgets?.on ?? null,
		known: unique([...(doc.widgets?.known ?? []), ...(earlier.widgets?.known ?? []), ...WIDGET_IDS]),
		updatedAt: nextStamp(doc.widgets?.updatedAt, now),
	};
	return next;
}
