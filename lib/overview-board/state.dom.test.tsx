import { jsonResponse } from "@/test/dom";
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { BoardDoc, BoardPart, BoardResponse, LayoutPart } from "./types";

const { toast } = await import("sonner");
const { boardTiming, initBoardState, moveCards, resetBoard, setBoardBusy, setCardsOn, syncBoard, useBoardStore } = await import("./state");
const { boardStorageKey } = await import("./sync");
const { seedLayouts } = await import("./layout");
const { BOARD_PARTS } = await import("./types");

// The store against a stand-in account: a fetch that keeps one record and
// applies the same last-write-wins rule as the real route.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const realTiming = { ...boardTiming };
Object.assign(boardTiming, { push: 20, gate: 80, retry: 30, retryMax: 120, rateLimited: 40 });

const PAST = "2026-11-01T10:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const layout = (updatedAt: string, x = 0): LayoutPart => ({ items: [{ i: "volume", x, y: 0, w: 4, h: 8 }], updatedAt });

type Call = { method: string; body: BoardDoc | null; keepalive: boolean };

let calls: Call[];
let server: BoardDoc;
/** Overrides the stand-in for one test. Return undefined to fall through to it. */
let respond: (call: Call) => Response | Promise<Response> | undefined;
let run = 0;
let owner = "";

const answer = (data: BoardDoc | null, db = true) => jsonResponse({ ok: true, data, db } satisfies BoardResponse);

function serve(call: Call): Response {
	if (call.method === "PUT" && call.body) {
		for (const part of BOARD_PARTS) {
			const value = call.body[part];
			const have = server[part];
			if (value && (!have || have.updatedAt <= value.updatedAt)) Object.assign(server, { [part]: value });
		}
	}
	return answer({ ...server });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
	const call: Call = {
		method: init?.method ?? "GET",
		body: typeof init?.body === "string" ? (JSON.parse(init.body) as BoardDoc) : null,
		keepalive: init?.keepalive === true,
	};
	calls.push(call);
	return (await respond(call)) ?? serve(call);
}) as unknown as typeof fetch;

const warn = spyOn(toast, "message").mockImplementation(() => "");

afterAll(() => {
	globalThis.fetch = realFetch;
	Object.assign(boardTiming, realTiming);
	warn.mockRestore();
});

beforeEach(() => {
	// A new mailbox each test: the store resets itself when the mailbox changes.
	owner = `mailbox-${String(++run)}`;
	localStorage.clear();
	calls = [];
	server = {};
	respond = () => undefined;
	warn.mockClear();
});

const puts = () => calls.filter((c) => c.method === "PUT");
const state = () => useBoardStore.getState();
const mirror = () => localStorage.getItem(boardStorageKey(owner));
const stamps = (doc: BoardDoc) => Object.fromEntries(BOARD_PARTS.map((part) => [part, doc[part]?.updatedAt]));
const moved = (x: number) => seedLayouts().lg.map((item) => (item.i === "orbit" ? { ...item, x } : item));

/** Opens the board and lets the first read settle. */
async function start() {
	initBoardState(owner);
	await sleep(10);
}

describe("first paint", () => {
	test("a device with its own copy draws it at once, before the account answers", () => {
		localStorage.setItem(boardStorageKey(owner), JSON.stringify({ lg: layout(PAST, 2) }));
		respond = () => new Promise<Response>(() => {});
		initBoardState(owner);
		expect(state().ready).toBe(true);
		expect(state().doc).toEqual({ lg: layout(PAST, 2) });
	});

	test("a new device waits for the account's board and draws that", async () => {
		server = { lg: layout(PAST, 3) };
		respond = async (call) => {
			await sleep(20);
			return serve(call);
		};
		initBoardState(owner);
		expect(state().ready).toBe(false);
		await sleep(40);
		expect(state().ready).toBe(true);
		expect(state().doc).toEqual({ lg: layout(PAST, 3) });
		expect(JSON.parse(mirror() ?? "null")).toEqual({ lg: layout(PAST, 3) });
	});

	test("the wait is short: a slow answer gets the default board first, and is still adopted when it lands", async () => {
		server = { lg: layout(PAST, 3) };
		respond = async (call) => {
			await sleep(boardTiming.gate + 60);
			return serve(call);
		};
		initBoardState(owner);
		await sleep(boardTiming.gate + 20);
		expect(state().ready).toBe(true);
		expect(state().doc).toEqual({});
		await sleep(80);
		expect(state().doc).toEqual({ lg: layout(PAST, 3) });
	});

	test("an account that cannot be reached draws the default at once, and the device asks again next time", async () => {
		respond = () => jsonResponse({ ok: false, error: "down", code: "db_unavailable" }, 503);
		await start();
		expect(state().ready).toBe(true);
		expect(state().doc).toEqual({});
		// No device copy: a copy would say the first sync is done, and the next visit would not wait for the account.
		expect(mirror()).toBeNull();
	});

	test("the first settled read leaves a device copy even when nothing is saved, so the wait happens once", async () => {
		await start();
		expect(state().ready).toBe(true);
		expect(mirror()).toBe("{}");
	});

	test("an answer for the mailbox that was open before is dropped", async () => {
		let release: (res: Response) => void = () => {};
		respond = () =>
			new Promise<Response>((resolve) => {
				release = resolve;
			});
		initBoardState(owner);
		const first = release;
		respond = () => undefined;
		const other = `${owner}-other`;
		initBoardState(other);
		await sleep(10);
		first(answer({ lg: layout(PAST, 7) }));
		await sleep(10);
		expect(state().doc).toEqual({});
		expect(localStorage.getItem(boardStorageKey(owner))).toBeNull();
	});
});

describe("reading the account's board", () => {
	test("adopts it without stamping or sending anything: looking is not editing", async () => {
		server = { lg: layout(PAST, 3), widgets: { on: ["volume"], known: ["volume"], updatedAt: PAST } };
		await start();
		await sleep(boardTiming.push + 30);
		expect(stamps(state().doc)).toEqual(stamps(server));
		expect(puts()).toHaveLength(0);
		expect(state().save).toBe("idle");
	});

	test("sends up the parts this device holds newer, and only those", async () => {
		server = { lg: layout(PAST, 3), md: layout(FUTURE, 4) };
		localStorage.setItem(boardStorageKey(owner), JSON.stringify({ lg: layout("2026-11-10T10:00:00.000Z", 1), md: layout(PAST, 2) }));
		await start();
		await sleep(20);
		expect(puts()).toHaveLength(1);
		expect(Object.keys(puts()[0]?.body ?? {})).toEqual(["lg"]);
		expect(state().doc.md).toEqual(layout(FUTURE, 4));
		// An old board going up again is not something the user did now.
		expect(state().save).toBe("idle");
	});

	test("holds a newer copy back while a card is being dragged, and applies it when the drag ends", async () => {
		await start();
		setBoardBusy(true);
		server = { lg: layout(FUTURE, 6) };
		await syncBoard();
		expect(state().doc).toEqual({});
		setBoardBusy(false);
		expect(state().doc).toEqual({ lg: layout(FUTURE, 6) });
	});

	test("the board is read again when the window gets focus", async () => {
		await start();
		server = { sm: layout(FUTURE, 1) };
		window.dispatchEvent(new Event("focus"));
		await sleep(10);
		expect(state().doc).toEqual({ sm: layout(FUTURE, 1) });
	});
});

describe("saving an edit", () => {
	test("a run of edits is one save, with only the part that changed", async () => {
		await start();
		moveCards("lg", moved(1));
		moveCards("lg", moved(2));
		moveCards("lg", moved(3));
		expect(state().save).toBe("saving");
		expect(puts()).toHaveLength(0);
		await sleep(boardTiming.push + 30);
		expect(puts()).toHaveLength(1);
		expect(Object.keys(puts()[0]?.body ?? {})).toEqual(["lg"]);
		expect(puts()[0]?.body?.lg?.items?.find((i) => i.i === "orbit")?.x).toBe(3);
		expect(server.lg?.updatedAt).toBe(state().doc.lg?.updatedAt);
		expect(state().save).toBe("saved");
	});

	test("removing a card sends only which cards are on; Reset sends every part", async () => {
		await start();
		setCardsOn(["volume", "orbit"]);
		await sleep(boardTiming.push + 30);
		expect(Object.keys(puts()[0]?.body ?? {})).toEqual(["widgets"]);

		resetBoard();
		await sleep(boardTiming.push + 30);
		expect(Object.keys(puts()[1]?.body ?? {}).sort()).toEqual([...BOARD_PARTS].sort());
		expect(server.widgets?.on).toBeNull();
	});

	test("a part edited again while its save is in the air is sent again", async () => {
		await start();
		let release: () => void = () => {};
		respond = (call) =>
			call.method === "PUT" && puts().length === 1
				? new Promise<Response>((resolve) => {
						release = () => {
							resolve(serve(call));
						};
					})
				: undefined;
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + 20);
		expect(puts()).toHaveLength(1);
		moveCards("lg", moved(4));
		release();
		await sleep(boardTiming.push + 40);
		expect(puts()).toHaveLength(2);
		expect(server.lg?.items?.find((i) => i.i === "orbit")?.x).toBe(4);
		expect(state().doc.lg?.items?.find((i) => i.i === "orbit")?.x).toBe(4);
		expect(state().save).toBe("saved");
	});

	test("losing to a newer edit made elsewhere adopts that edit", async () => {
		await start();
		respond = (call) => {
			// Another device saves just before this one's save lands.
			if (call.method === "PUT") server = { lg: layout(FUTURE, 9) };
			return undefined;
		};
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + 30);
		expect(state().doc.lg).toEqual(layout(FUTURE, 9));
		expect(JSON.parse(mirror() ?? "{}")).toEqual({ lg: layout(FUTURE, 9) });
		expect(puts()).toHaveLength(1);
	});

	test("a stamp from a fast clock is replaced by the one the account stored", async () => {
		await start();
		const pinned = "2026-11-18T10:00:00.000Z";
		respond = (call) => {
			if (call.method !== "PUT" || !call.body?.lg) return undefined;
			server = { lg: { ...call.body.lg, updatedAt: pinned } };
			return answer({ ...server });
		};
		moveCards("lg", moved(2));
		expect(state().doc.lg?.updatedAt).not.toBe(pinned);
		await sleep(boardTiming.push + 30);
		expect(state().doc.lg?.updatedAt).toBe(pinned);
		expect((JSON.parse(mirror() ?? "{}") as BoardDoc).lg?.updatedAt).toBe(pinned);
		// Settled: nothing more to send.
		await sleep(boardTiming.push + 30);
		expect(puts()).toHaveLength(1);
	});

	test("leaving the page sends what is waiting at once, in a request that outlives it", async () => {
		await start();
		moveCards("lg", moved(1));
		window.dispatchEvent(new Event("pagehide"));
		await sleep(5);
		expect(puts()).toHaveLength(1);
		expect(puts()[0]?.keepalive).toBe(true);
	});
});

describe("when a save cannot land", () => {
	test("it is tried again on its own, with one notice, until it lands", async () => {
		await start();
		let failures = 2;
		respond = (call) => (call.method === "PUT" && failures-- > 0 ? jsonResponse({ ok: false }, 503) : undefined);
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + 20);
		expect(state().save).toBe("waiting");
		// The edit is on the device whatever the account says.
		expect((JSON.parse(mirror() ?? "{}") as BoardDoc).lg?.items?.find((i) => i.i === "orbit")?.x).toBe(1);
		await sleep(boardTiming.retry * 3 + 60);
		expect(puts()).toHaveLength(3);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(state().save).toBe("saved");
		expect(server.lg?.items?.find((i) => i.i === "orbit")?.x).toBe(1);
	});

	test("a network failure is tried again too", async () => {
		await start();
		let failures = 1;
		respond = (call) => {
			if (call.method === "PUT" && failures-- > 0) throw new TypeError("offline");
			return undefined;
		};
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + boardTiming.retry + 50);
		expect(puts()).toHaveLength(2);
		expect(state().save).toBe("saved");
	});

	test("too many saves in a minute: it waits and sends again, without a notice", async () => {
		await start();
		let limited = 1;
		respond = (call) => (call.method === "PUT" && limited-- > 0 ? jsonResponse({ ok: false, code: "rate_limited" }, 429) : undefined);
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + 15);
		expect(puts()).toHaveLength(1);
		expect(state().save).toBe("saving");
		await sleep(boardTiming.rateLimited + 30);
		expect(puts()).toHaveLength(2);
		expect(warn).not.toHaveBeenCalled();
		expect(state().save).toBe("saved");
	});

	test("a refusal is not sent again and again", async () => {
		await start();
		respond = (call) => (call.method === "PUT" ? jsonResponse({ ok: false, code: "bad_request" }, 400) : undefined);
		moveCards("lg", moved(1));
		await sleep(boardTiming.push + boardTiming.retry * 3 + 40);
		expect(puts()).toHaveLength(1);
		expect(state().save).toBe("waiting");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("coming back online sends what is waiting", async () => {
		await start();
		let down = true;
		respond = () => (down ? jsonResponse({ ok: false }, 503) : undefined);
		Object.assign(boardTiming, { retry: 5000 });
		try {
			moveCards("lg", moved(5));
			await sleep(boardTiming.push + 20);
			expect(state().save).toBe("waiting");
			down = false;
			window.dispatchEvent(new Event("online"));
			await sleep(30);
			expect(server.lg?.items?.find((i) => i.i === "orbit")?.x).toBe(5);
			expect(state().save).toBe("saved");
		} finally {
			Object.assign(boardTiming, { retry: 30 });
		}
	});
});

describe("with no account database", () => {
	test("the device holds the only copy: edits stay here, nothing is sent, and the status says so", async () => {
		respond = () => answer(null, false);
		await start();
		expect(mirror()).toBe("{}");
		moveCards("lg", moved(1));
		setCardsOn(["volume"]);
		await sleep(boardTiming.push + 30);
		expect(puts()).toHaveLength(0);
		expect(state().save).toBe("device");
		expect(warn).not.toHaveBeenCalled();
		const kept = JSON.parse(mirror() ?? "{}") as BoardDoc;
		expect((Object.keys(kept) as BoardPart[]).sort()).toEqual(["lg", "widgets"]);
	});
});
