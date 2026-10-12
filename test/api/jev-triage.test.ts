import { describe, expect, test } from "bun:test";
import { POST } from "@/app/api/jev/triage/route";
import { call, readJson, req } from "../helpers/request";
import { fakeJev } from "../helpers/jev";
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
		expect(body.error).toContain("TYPESAFE_API_KEY");
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("409 does not spend the rate limit", async () => {
		// Limit is 3/min; a disabled Jev must answer 409 every time, never 429.
		const session = makeSession();
		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) statuses.push((await call(POST, req("/api/jev/triage", { method: "POST", session }))).status);
		expect(statuses).toEqual([409, 409, 409, 409, 409]);
	});
});
