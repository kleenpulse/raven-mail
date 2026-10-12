import { describe, expect, test } from "bun:test";
import { GET } from "@/app/api/overview/route";
import type { Overview } from "@/lib/insights/types";
import { call, readJson, req } from "../helpers/request";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code: string };

async function overview(query = ""): Promise<Response> {
	return call(GET, req(`/api/overview${query}`));
}

describe("GET /api/overview", () => {
	test("401 without a session", async () => {
		const res = await call(GET, req("/api/overview", { session: null }));
		expect(res.status).toBe(401);
	});

	test.each(["7", "30"])("days=%s → 200 with overview shape", async (days) => {
		const res = await overview(`?days=${days}&tz=UTC`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const { ok, data } = await readJson<Ok<Overview>>(res);
		expect(ok).toBe(true);
		expect(data.v).toBe(1);
		expect(data.days).toBe(Number(days));
		expect(data.tz).toBe("UTC");
		expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
		for (const k of ["unread", "needsReply", "waitingOn", "urgentToday", "receivedToday"] as const) {
			expect(typeof data.kpis[k]).toBe("number");
			expect(data.kpis[k]).toBeGreaterThanOrEqual(0);
		}
		expect(Array.isArray(data.obligations.needsReply)).toBe(true);
		expect(Array.isArray(data.obligations.waitingOn)).toBe(true);
		expect(data.volume.days).toHaveLength(Number(days));
		for (const d of data.volume.days) {
			expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(d.received).toBeGreaterThanOrEqual(0);
			expect(d.sent).toBeGreaterThanOrEqual(0);
		}
	});

	test("defaults to 30 days, UTC", async () => {
		const res = await overview();
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<Overview>>(res);
		expect(data.days).toBe(30);
		expect(data.tz).toBe("UTC");
	});

	test("a real IANA zone is echoed back", async () => {
		const res = await overview("?days=7&tz=America/New_York");
		expect(res.status).toBe(200);
		expect((await readJson<Ok<Overview>>(res)).data.tz).toBe("America/New_York");
	});

	test("unknown tz → 400", async () => {
		const res = await overview("?tz=Mars/Olympus_Mons");
		expect(res.status).toBe(400);
		expect(await readJson(res)).toEqual({ ok: false, error: "Unknown time zone.", code: "bad_request" });
	});

	test("tz over 64 chars → 400", async () => {
		const res = await overview(`?tz=${"A".repeat(65)}`);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});

	test.each(["14", "0", "abc", "7.0"])("days=%s → 400", async (days) => {
		const res = await overview(`?days=${days}`);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});
});
