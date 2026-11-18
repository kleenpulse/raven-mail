"use client";

import * as React from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { resolveBoard, type Board, type BoardItem } from "./layout";
import {
	afterSave,
	boardStorageKey,
	mergeNewer,
	parseBlob,
	pickParts,
	reconcile,
	serializeBlob,
	writeLayout,
	writeReset,
	writeRestore,
	writeWidgets,
} from "./sync";
import { BOARD_PARTS, type BoardDoc, type BoardPart, type BoardResponse, type Breakpoint } from "./types";
import type { WidgetId } from "./widgets";

/*
 * The Overview board's saved record: instant in memory and in localStorage
 * (one blob per mailbox), mirrored to the account through /api/overview/board.
 * Edits go up as a debounced PUT of the parts that changed; the record is
 * reconciled part by part, last write wins, on mount, on focus, on reconnect
 * and after every save. Nothing here runs until `initBoardState(owner)` names
 * the mailbox.
 *
 * Only the user's own actions write (moveCards, setCardsOn, resetBoard,
 * restoreBoard). The grid re-packing itself is kept in the component and never
 * comes through here, so looking at the board never counts as editing it.
 */

/**
 * What the status line may say about the last edit.
 * `device`: there is no account database, so this device holds the only copy.
 * `waiting`: the account could not be reached; the edit is on this device and will be sent again.
 */
export type BoardSave = "idle" | "saving" | "saved" | "device" | "waiting";

type Store = {
	/** The record as saved. It may hold cards this release does not know; resolveBoard leaves those out when drawing. */
	doc: BoardDoc;
	/** The board may be drawn. */
	ready: boolean;
	save: BoardSave;
};

export const useBoardStore = create<Store>(() => ({ doc: {}, ready: false, save: "idle" }));

const ENDPOINT = "/api/overview/board";

/** Waits, in ms. An object so tests can shorten them. */
export const boardTiming = {
	/** Quiet time after an edit before it is sent: a run of key presses is one save. */
	push: 800,
	/** How long a device with no copy of its own waits for the account's board before drawing the default. */
	gate: 1000,
	/** First wait after a failed save. It doubles each time, up to `retryMax`. */
	retry: 2000,
	retryMax: 60_000,
	/** Wait after the server says there were too many saves. */
	rateLimited: 10_000,
};

type Timer = ReturnType<typeof setTimeout> | null;

let owner: string | null = null;
/** Goes up when the mailbox changes: an answer that comes back for the old one is dropped. */
let epoch = 0;
/** A drag or resize is in flight: a newer copy from elsewhere waits until it ends, so the grid never changes under the pointer. */
let busy = false;
let held: BoardDoc | null = null;
/** Parts edited here that the account has not confirmed. */
const unsent = new Set<BoardPart>();
/** Whether there is an account database. Null until the first answer. */
let hasDb: boolean | null = null;
/** The user edited the board in this session. */
let touched = false;
let failing = false;
let warned = false;
let retryMs = 0;
let sending = 0;
let pushTimer: Timer = null;
let retryTimer: Timer = null;
let gateTimer: Timer = null;

const current = () => useBoardStore.getState().doc;

const differs = (a: BoardDoc, b: BoardDoc) => BOARD_PARTS.some((part) => a[part] !== b[part]);

function stop(timer: Timer): null {
	if (timer) clearTimeout(timer);
	return null;
}

function readLocal(): BoardDoc | null {
	if (!owner) return null;
	try {
		return parseBlob(localStorage.getItem(boardStorageKey(owner)));
	} catch {
		return null;
	}
}

function storeLocal(doc: BoardDoc) {
	if (!owner) return;
	try {
		localStorage.setItem(boardStorageKey(owner), serializeBlob(doc));
	} catch {
		/* storage blocked — this session only */
	}
}

/** Another tab may have saved parts this one has not seen: keep the newer of each, never the whole of ours. */
function writeLocal(doc: BoardDoc) {
	storeLocal(mergeNewer(readLocal() ?? {}, doc));
}

/** The status line follows from what is unsent and why. */
function show() {
	let save: BoardSave;
	if (!touched) save = "idle";
	else if (hasDb === false) save = "device";
	else if (unsent.size === 0) save = "saved";
	else save = failing ? "waiting" : "saving";
	if (useBoardStore.getState().save !== save) useBoardStore.setState({ save });
}

/** The board may be drawn. */
function open() {
	gateTimer = stop(gateTimer);
	if (!useBoardStore.getState().ready) useBoardStore.setState({ ready: true });
}

/** A copy from elsewhere (another tab, the account): take the parts it holds newer. */
function adopt(theirs: BoardDoc) {
	if (busy) {
		held = mergeNewer(held ?? {}, theirs);
		return;
	}
	const mine = current();
	const merged = mergeNewer(mine, theirs);
	if (differs(merged, mine)) useBoardStore.setState({ doc: merged });
}

/** The grid calls this around a drag or resize. */
export function setBoardBusy(on: boolean) {
	busy = on;
	if (!on && held) {
		const waiting = held;
		held = null;
		adopt(waiting);
	}
}

function schedulePush(ms: number) {
	pushTimer = stop(pushTimer);
	retryTimer = stop(retryTimer);
	pushTimer = setTimeout(() => {
		pushTimer = null;
		void push();
	}, ms);
}

function retryIn(ms: number) {
	retryTimer = stop(retryTimer);
	retryTimer = setTimeout(() => {
		retryTimer = null;
		void push();
	}, ms);
}

/** A save did not land. The edit is safe on this device; say so once, and try again when that can help. */
function failed(retry: boolean) {
	failing = true;
	if (retry) {
		retryMs = Math.min(retryMs ? retryMs * 2 : boardTiming.retry, boardTiming.retryMax);
		retryIn(retryMs);
	}
	// Only for an edit made now: a board from an earlier visit failing to send again is not news.
	if (touched && !warned) {
		warned = true;
		toast.message("Your board is saved on this device", { description: "Raven will sync it to your account when it can reach it." });
	}
	show();
}

/** Sends every unsent part. Saves may overlap: each answer is judged against what that save sent. */
async function push(): Promise<void> {
	if (!owner || unsent.size === 0 || hasDb === false) return;
	const at = epoch;
	const sent = pickParts(current(), unsent);
	let res: Response;
	sending++;
	try {
		res = await fetch(ENDPOINT, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(sent),
			// Outlives the page: an edit made just before the tab closes still lands.
			keepalive: true,
		});
	} catch {
		if (at === epoch) failed(true);
		return;
	} finally {
		sending--;
	}
	if (at !== epoch) return;
	if (res.status === 429) {
		// Too many saves in a minute. Nothing is wrong and nothing is lost: wait, then send the latest.
		retryIn(boardTiming.rateLimited);
		return;
	}
	if (!res.ok) {
		// A server fault may pass. A refusal (signed out, a body it will not take) will not, until something changes.
		failed(res.status >= 500 || res.status === 408);
		return;
	}
	let body: BoardResponse;
	try {
		body = (await res.json()) as BoardResponse;
	} catch {
		failed(true);
		return;
	}
	if (at !== epoch) return;

	failing = false;
	warned = false;
	retryMs = 0;
	hasDb = body.db;
	const mine = current();
	// A part edited again while this save was in the air stays unsent.
	for (const part of BOARD_PARTS) {
		if (sent[part] && mine[part]?.updatedAt === sent[part].updatedAt) unsent.delete(part);
	}
	if (!body.db) {
		unsent.clear();
	} else if (body.data) {
		const stored = body.data;
		if (busy) {
			held = mergeNewer(held ?? {}, stored);
		} else {
			const next = afterSave(mine, sent, stored);
			if (differs(next, mine)) useBoardStore.setState({ doc: next });
		}
		storeLocal(afterSave(readLocal() ?? {}, sent, stored));
	}
	if (unsent.size > 0 && !pushTimer && sending === 0) schedulePush(boardTiming.push);
	show();
}

/** Reads the account's copy and settles the two, part by part. */
export async function syncBoard(): Promise<void> {
	if (!owner) return;
	const at = epoch;
	let remote: BoardResponse;
	try {
		const res = await fetch(ENDPOINT, { cache: "no-store" });
		if (!res.ok) throw new Error(`board ${String(res.status)}`);
		remote = (await res.json()) as BoardResponse;
	} catch {
		// Unreachable. Draw what this device has now (the default, on a new one) instead of waiting it out.
		// No device copy is written, so a new device asks again next time before it settles on the default.
		if (at === epoch) open();
		return;
	}
	if (at !== epoch) return;
	hasDb = remote.db;
	if (remote.db) {
		const decision = reconcile(current(), remote.data);
		adopt(decision.adopt);
		// Also when nothing was adopted: a device copy, even an empty one, says the first sync is done here.
		writeLocal(mergeNewer(current(), decision.adopt));
		for (const part of decision.push) unsent.add(part);
		if (unsent.size > 0 && !pushTimer && sending === 0) schedulePush(0);
	} else {
		// No database: this device holds the only copy, and there is nothing to send.
		unsent.clear();
		pushTimer = stop(pushTimer);
		retryTimer = stop(retryTimer);
		writeLocal(current());
	}
	open();
	show();
}

/** The page is going away or into the background: send what is waiting now, not after the debounce. */
function flush() {
	if (!pushTimer && !retryTimer) return;
	pushTimer = stop(pushTimer);
	retryTimer = stop(retryTimer);
	void push();
}

let listening = false;

/** Called by the Overview with the signed-in mailbox's opaque id. */
export function initBoardState(nextOwner: string) {
	if (owner !== nextOwner) {
		owner = nextOwner;
		epoch++;
		busy = false;
		held = null;
		unsent.clear();
		hasDb = null;
		touched = false;
		failing = false;
		warned = false;
		retryMs = 0;
		pushTimer = stop(pushTimer);
		retryTimer = stop(retryTimer);
		gateTimer = stop(gateTimer);
		const mine = readLocal();
		useBoardStore.setState({ doc: mine ?? {}, ready: mine !== null, save: "idle" });
		// A device with no copy of its own waits a moment for the account's board, so a returning user
		// does not watch the default board rearrange itself. Not for long: the cards matter more than
		// where they sit.
		if (mine === null) gateTimer = setTimeout(open, boardTiming.gate);
	}
	if (!listening) {
		listening = true;
		window.addEventListener("storage", (e) => {
			if (!owner || e.key !== boardStorageKey(owner)) return;
			adopt(parseBlob(e.newValue) ?? {});
		});
		window.addEventListener("focus", () => void syncBoard());
		window.addEventListener("online", () => void syncBoard());
		window.addEventListener("pagehide", flush);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") flush();
		});
	}
	void syncBoard();
}

/** A user's edit: in memory and on the device at once, then on its way to the account. */
function edit(next: BoardDoc) {
	const before = current();
	useBoardStore.setState({ doc: next });
	writeLocal(next);
	for (const part of BOARD_PARTS) {
		if (next[part] !== before[part]) unsent.add(part);
	}
	touched = true;
	if (hasDb !== false) schedulePush(boardTiming.push);
	show();
}

/** The user moved or resized cards at one board width. */
export function moveCards(bp: Breakpoint, items: readonly BoardItem[]) {
	edit(writeLayout(current(), bp, items));
}

/** The user added or removed a card. Layouts are left alone: resolveBoard places an added card and drops a removed one. */
export function setCardsOn(on: readonly WidgetId[]) {
	edit(writeWidgets(current(), on));
}

/** Back to the default board. Returns the record as it was, for Undo. */
export function resetBoard(): BoardDoc {
	const before = current();
	edit(writeReset(before));
	return before;
}

export function restoreBoard(earlier: BoardDoc) {
	edit(writeRestore(current(), earlier));
}

export function getBoard(): Board {
	return resolveBoard(current());
}

/** The board to draw, whether it may be drawn yet, and what became of the last edit. */
export function useBoard(): { board: Board; doc: BoardDoc; ready: boolean; save: BoardSave } {
	const doc = useBoardStore((s) => s.doc);
	const ready = useBoardStore((s) => s.ready);
	const save = useBoardStore((s) => s.save);
	const board = React.useMemo(() => resolveBoard(doc), [doc]);
	return { board, doc, ready, save };
}
