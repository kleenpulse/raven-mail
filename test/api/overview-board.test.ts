import { describe, expect, test } from "bun:test";
import { GET, PUT } from "@/app/api/overview/board/route";
import type { BoardDoc, BoardResponse } from "@/lib/overview-board/types";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";

// DATABASE_URL is scrubbed in test/setup.ts, so these cover the device-only
// path: a missing database is a normal answer, never an error.

const AT = "2026-11-18T10:00:00.000Z";
const layout = { items: [{ i: "orbit", x: 0, y: 0, w: 8, h: 15 }], updatedAt: AT };
const doc: BoardDoc = { lg: layout, widgets: { on: ["orbit"], known: ["orbit", "volume"], updatedAt: AT } };

function put(json: unknown, opts: Parameters<typeof req>[1] = {}) {
	return call(PUT, req("/api/overview/board", { method: "PUT", json, ...opts }));
}

describe("GET /api/overview/board", () => {
	test("401 without a session", async () => {
		const res = await call(GET, req("/api/overview/board", { session: null }));
		expect(res.status).toBe(401);
	});

	test("no database: 200 with db false and no board", async () => {
		const res = await call(GET, req("/api/overview/board"));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		expect(await readJson<BoardResponse>(res)).toEqual({ ok: true, data: null, db: false });
	});
});

describe("PUT /api/overview/board", () => {
	test("no database: accepted as device-only", async () => {
		const res = await put(doc);
		expect(res.status).toBe(200);
		expect(await readJson<BoardResponse>(res)).toEqual({ ok: true, data: null, db: false });
	});

	test("401 without a session", async () => {
		expect((await put(doc, { session: null })).status).toBe(401);
	});

	test("403 cross-origin", async () => {
		expect((await put(doc, { origin: "https://evil.example" })).status).toBe(403);
	});

	test("a card id this release has never heard of is accepted", async () => {
		const res = await put({
			lg: { items: [{ i: "card-from-a-later-release", x: 0, y: 0, w: 2, h: 2 }], updatedAt: AT },
			widgets: { on: ["card-from-a-later-release"], known: ["card-from-a-later-release"], updatedAt: AT },
		});
		expect(res.status).toBe(200);
	});

	test("the default board (null parts) is accepted", async () => {
		const res = await put({ sm: { items: null, updatedAt: AT }, widgets: { on: null, known: [], updatedAt: AT } });
		expect(res.status).toBe(200);
	});

	test("400 with nothing to save", async () => {
		const res = await put({});
		expect(res.status).toBe(400);
		expect((await readJson(res)).code).toBe("bad_request");
	});

	test("400 on an unknown part", async () => {
		expect((await put({ ...doc, xl: layout })).status).toBe(400);
	});

	test("400 on unknown fields inside a part", async () => {
		expect((await put({ lg: { ...layout, extra: true } })).status).toBe(400);
		expect((await put({ lg: { items: [{ i: "orbit", x: 0, y: 0, w: 8, h: 15, static: true }], updatedAt: AT } })).status).toBe(400);
	});

	test("400 on a part without a change time", async () => {
		expect((await put({ lg: { items: null } })).status).toBe(400);
		expect((await put({ lg: { items: null, updatedAt: "yesterday" } })).status).toBe(400);
	});

	test("400 on a cell outside any grid", async () => {
		const at = (over: object) => put({ lg: { items: [{ i: "orbit", x: 0, y: 0, w: 8, h: 15, ...over }], updatedAt: AT } });
		expect((await at({ x: -1 })).status).toBe(400);
		expect((await at({ w: 0 })).status).toBe(400);
		expect((await at({ h: 1.5 })).status).toBe(400);
		expect((await at({ i: "x".repeat(65) })).status).toBe(400);
	});

	test("400 on more cards than a board can hold", async () => {
		const items = Array.from({ length: 65 }, (_, n) => ({ i: `card-${String(n)}`, x: 0, y: n, w: 1, h: 1 }));
		expect((await put({ lg: { items, updatedAt: AT } })).status).toBe(400);
	});

	test("429 after 60 saves in a minute, per mailbox", async () => {
		const session = makeSession();
		for (let n = 0; n < 60; n++) expect((await put(doc, { session })).status).toBe(200);
		const res = await put(doc, { session });
		expect(res.status).toBe(429);
		expect((await readJson(res)).code).toBe("rate_limited");
		// Another mailbox is not held back by this one.
		expect((await put(doc)).status).toBe(200);
	});
});
