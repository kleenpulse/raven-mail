import { describe, expect, test } from "bun:test";
import { POST } from "@/app/api/jev/triage/route";
import { call, readJson, req } from "../helpers/request";
import { answers, fakeJev } from "../helpers/jev";
import { makeSession } from "../helpers/session";

type Err = { ok: false; error: string; code: string };

describe("POST /api/jev/triage", () => {
	test("401 without a session (checked before Jev config)", async () => {
		const res = await call(POST, req("/api/jev/triage", { method: "POST", session: null }));
		expect(res.status).toBe(401);
		expect((await readJson<Err>(res)).code).toBe("unauthorized");
	});

	test("403 cross-origin, before auth", async () => {
		const res = await call(POST, req("/api/jev/triage", { method: "POST", session: null, origin: "https://evil.example" }));
		expect(res.status).toBe(403);
	});

	test("409 jev_disabled when Jev isn't configured", async () => {
		const res = await call(POST, req("/api/jev/triage", { method: "POST" }));
		expect(res.status).toBe(409);
		const body = await readJson<Err>(res);
		expect(body).toMatchObject({ ok: false, code: "jev_disabled" });
		expect(body.error).toContain("Settings → Account");
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("409 does not spend the rate limit", async () => {
		// Limit is 3/min; a disabled Jev must answer 409 every time, never 429.
		const session = makeSession();
		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) statuses.push((await call(POST, req("/api/jev/triage", { method: "POST", session }))).status);
		expect(statuses).toEqual([409, 409, 409, 409, 409]);
	});

	test("without any key, Kage runs Deep triage and labels its results", async () => {
		fakeJev.kage = true;
		const res = await call(POST, req("/api/jev/triage", { method: "POST" }));
		expect(res.status).toBe(200);
		const body = await readJson<{ ok: true; data: { items: { triage: { source: string } }[] } }>(res);
		expect(body.data.items.length).toBeGreaterThan(0);
		expect(body.data.items.every((i) => i.triage.source === "kage")).toBe(true);
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("a session with its own key runs Deep triage without a server key", async () => {
		fakeJev.systemOne.mockImplementation(async () => answers({}));
		const session = makeSession({ jevKey: "user-key-0123456789abcd" });
		const res = await call(POST, req("/api/jev/triage", { method: "POST", session }));
		expect(res.status).toBe(200);
		const body = await readJson<{ ok: true; data: { items: unknown[] } }>(res);
		expect(body.ok).toBe(true);
	});
});
