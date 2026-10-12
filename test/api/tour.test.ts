import { describe, expect, test } from "bun:test";
import { GET, PUT } from "@/app/api/tour/route";
import { DEFAULT_TOUR_STATE, type TourResponse } from "@/lib/tour/types";
import { call, readJson, req } from "../helpers/request";

// DATABASE_URL is scrubbed in test/setup.ts, so these cover the local-only
// path: a missing database is a normal answer, never an error.

const state = { ...DEFAULT_TOUR_STATE, lastStep: 3, voice: "gb" as const, updatedAt: "2026-09-29T10:00:00.000Z" };

function put(json: unknown, opts: Parameters<typeof req>[1] = {}) {
	return call(PUT, req("/api/tour", { method: "PUT", json, ...opts }));
}

describe("GET /api/tour", () => {
	test("401 without a session", async () => {
		const res = await call(GET, req("/api/tour", { session: null }));
		expect(res.status).toBe(401);
	});

	test("no database: 200 with db false and no state", async () => {
		const res = await call(GET, req("/api/tour"));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		expect(await readJson<TourResponse>(res)).toEqual({ ok: true, data: null, db: false });
	});
});

describe("PUT /api/tour", () => {
	test("no database: accepted as local-only", async () => {
		const res = await put(state);
		expect(res.status).toBe(200);
		expect(await readJson<TourResponse>(res)).toEqual({ ok: true, data: null, db: false });
	});

	test("401 without a session", async () => {
		expect((await put(state, { session: null })).status).toBe(401);
	});

	test("403 cross-origin", async () => {
		expect((await put(state, { origin: "https://evil.example" })).status).toBe(403);
	});

	test("400 on an unknown accent", async () => {
		expect((await put({ ...state, voice: "fr" })).status).toBe(400);
	});

	test("400 on unknown fields", async () => {
		expect((await put({ ...state, extra: true })).status).toBe(400);
	});

	test("400 without a change time", async () => {
		const res = await put({ ...state, updatedAt: null });
		expect(res.status).toBe(400);
		expect((await readJson(res)).code).toBe("bad_request");
	});
});
