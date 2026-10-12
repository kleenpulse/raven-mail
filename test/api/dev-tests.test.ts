import { afterEach, describe, expect, test } from "bun:test";
import { POST } from "@/app/api/dev/tests/run/route";
import { call, readJson, req } from "../helpers/request";

// Only the gates are exercised here; a real run would spawn the suite inside the suite.
const env = process.env as Record<string, string | undefined>;
const NODE_ENV = env.NODE_ENV;

afterEach(() => {
	env.NODE_ENV = NODE_ENV;
	delete (globalThis as Record<string, unknown>).__emDevTestRun;
});

describe("POST /api/dev/tests/run", () => {
	test("404 in production, before anything else", async () => {
		env.NODE_ENV = "production";
		const res = await call(POST, req("/api/dev/tests/run", { json: {}, session: null }));
		expect(res.status).toBe(404);
		expect(await readJson(res)).toMatchObject({ ok: false, code: "not_found" });
	});

	test("401 without a session", async () => {
		const res = await call(POST, req("/api/dev/tests/run", { json: {}, session: null }));
		expect(res.status).toBe(401);
	});

	test("403 cross-origin", async () => {
		const res = await call(POST, req("/api/dev/tests/run", { json: {}, origin: "https://evil.example" }));
		expect(res.status).toBe(403);
	});

	test("415 without JSON", async () => {
		const res = await call(POST, req("/api/dev/tests/run", { body: "coverage=1", headers: { "content-type": "text/plain" } }));
		expect(res.status).toBe(415);
	});

	test.each([[{ coverage: "yes" }], [{ coverage: true, args: ["--preload", "x"] }], [{ filter: "lib" }]])(
		"400 on anything but a boolean: %j",
		async (body) => {
			const res = await call(POST, req("/api/dev/tests/run", { json: body }));
			expect(res.status).toBe(400);
		},
	);

	test("409 while a run holds the lock", async () => {
		(globalThis as Record<string, unknown>).__emDevTestRun = true;
		const res = await call(POST, req("/api/dev/tests/run", { json: { coverage: false } }));
		expect(res.status).toBe(409);
		expect(await readJson(res)).toMatchObject({ code: "busy" });
	});
});
