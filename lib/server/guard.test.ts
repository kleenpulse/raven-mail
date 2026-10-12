import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { assertSameOrigin, HttpError, json, parseWith, readJson, requireApiSession, route } from "@/lib/server/guard";
import { encryptSession, SESSION_COOKIE } from "@/lib/session";
import { makeSession } from "@/test/helpers/session";
import { cookieState } from "@/test/state";

const URL_ = "http://localhost:3000/api/x";

function request(method: string, headers: Record<string, string> = {}, body?: string): Request {
	return new Request(URL_, { method, headers, body });
}

function httpError(fn: () => unknown): HttpError {
	try {
		fn();
	} catch (err) {
		if (err instanceof HttpError) return err;
		throw err;
	}
	throw new Error("expected an HttpError");
}

async function httpErrorAsync(p: Promise<unknown>): Promise<HttpError> {
	try {
		await p;
	} catch (err) {
		if (err instanceof HttpError) return err;
		throw err;
	}
	throw new Error("expected an HttpError");
}

describe("HttpError", () => {
	test("carries status, message and code (default 'error')", () => {
		const err = new HttpError(418, "teapot");
		expect(err).toBeInstanceOf(Error);
		expect([err.status, err.message, err.code]).toEqual([418, "teapot", "error"]);
		expect(new HttpError(400, "x", "bad_request").code).toBe("bad_request");
	});
});

describe("assertSameOrigin", () => {
	test("no Origin header passes (same-origin navigations, non-browser clients)", () => {
		expect(() => assertSameOrigin(request("POST", { host: "localhost:3000" }))).not.toThrow();
	});

	test("matching origin passes", () => {
		expect(() => assertSameOrigin(request("POST", { host: "localhost:3000", origin: "http://localhost:3000" }))).not.toThrow();
	});

	test("scheme doesn't matter, only host:port", () => {
		expect(() => assertSameOrigin(request("POST", { host: "app.example", origin: "https://app.example" }))).not.toThrow();
	});

	test.each([
		["other host", "https://evil.example"],
		["other port", "http://localhost:4000"],
		["subdomain", "http://evil.localhost:3000"],
		["suffix trick", "http://localhost:3000.evil.example"],
		["null origin", "null"],
	])("mismatch (%s) → 403", (_, origin) => {
		const err = httpError(() => assertSameOrigin(request("POST", { host: "localhost:3000", origin })));
		expect(err.status).toBe(403);
		expect(err.code).toBe("forbidden");
	});

	test("malformed origin → 403 Bad origin", () => {
		const err = httpError(() => assertSameOrigin(request("POST", { host: "localhost:3000", origin: "::::" })));
		expect([err.status, err.message, err.code]).toEqual([403, "Bad origin.", "forbidden"]);
	});

	test("x-forwarded-host takes precedence over host", () => {
		const headers = { host: "internal:3000", "x-forwarded-host": "app.example", origin: "https://app.example" };
		expect(() => assertSameOrigin(request("POST", headers))).not.toThrow();
		const err = httpError(() =>
			assertSameOrigin(request("POST", { ...headers, origin: "http://internal:3000" })),
		);
		expect(err.status).toBe(403);
	});
});

describe("readJson", () => {
	const schema = z.object({ name: z.string().min(1, "Name is required.") });

	test.each([
		["missing", undefined],
		["text/plain", "text/plain"],
		["form", "application/x-www-form-urlencoded"],
	])("content-type %s → 415", async (_, type) => {
		const headers: Record<string, string> = type ? { "content-type": type } : {};
		const err = await httpErrorAsync(readJson(request("POST", headers, `{"name":"a"}`), schema));
		expect([err.status, err.code]).toEqual([415, "unsupported_media_type"]);
	});

	test("content-type match is case-insensitive and allows charset", async () => {
		const r = request("POST", { "content-type": "Application/JSON; charset=utf-8" }, `{"name":"a"}`);
		expect(await readJson(r, schema)).toEqual({ name: "a" });
	});

	test.each(["{", "", "nope", `{"name":}`])("malformed body %p → 400", async (body) => {
		const err = await httpErrorAsync(readJson(request("POST", { "content-type": "application/json" }, body), schema));
		expect([err.status, err.message, err.code]).toEqual([400, "Malformed JSON.", "bad_request"]);
	});

	test("schema failure → 400 with the first zod message", async () => {
		const err = await httpErrorAsync(readJson(request("POST", { "content-type": "application/json" }, `{"name":""}`), schema));
		expect([err.status, err.message, err.code]).toEqual([400, "Name is required.", "bad_request"]);
	});

	test("strips unknown keys per schema", async () => {
		const r = request("POST", { "content-type": "application/json" }, `{"name":"a","admin":true}`);
		expect(await readJson(r, schema)).toEqual({ name: "a" });
	});
});

describe("parseWith", () => {
	const schema = z.object({ n: z.number({ error: "n must be a number." }) });

	test("returns parsed data", () => {
		expect(parseWith(schema, { n: 1 })).toEqual({ n: 1 });
	});

	test("throws 400 with the first issue's message", () => {
		const err = httpError(() => parseWith(schema, { n: "1" }));
		expect([err.status, err.message, err.code]).toEqual([400, "n must be a number.", "bad_request"]);
	});

	test("non-object input", () => {
		expect(httpError(() => parseWith(schema, null)).status).toBe(400);
	});
});

describe("json", () => {
	test("sets private, no-store and keeps status and other headers", async () => {
		const res = json({ ok: true }, { status: 201, headers: { "x-a": "1", "cache-control": "public, max-age=60" } });
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(res.headers.get("x-a")).toBe("1");
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ ok: true });
	});

	test("defaults to 200", () => {
		expect(json(null).status).toBe(200);
	});
});

describe("requireApiSession", () => {
	test("401 without a session", async () => {
		const err = await httpErrorAsync(requireApiSession());
		expect([err.status, err.code]).toEqual([401, "unauthorized"]);
	});

	test("returns the cookie's session", async () => {
		const session = makeSession();
		cookieState.set(SESSION_COOKIE, encryptSession(session));
		expect(await requireApiSession()).toEqual(session);
	});
});

describe("route", () => {
	const ok = route(async () => json({ ok: true }));
	const same = { host: "localhost:3000", origin: "http://localhost:3000" };
	const cross = { host: "localhost:3000", origin: "https://evil.example" };

	test("passes through the handler's response", async () => {
		const res = await ok(request("POST", same));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test.each(["POST", "PUT", "PATCH", "DELETE"])("cross-origin %s → 403, handler not run", async (method) => {
		let ran = false;
		const handler = route(async () => ((ran = true), json({ ok: true })));
		const res = await handler(request(method, cross));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ ok: false, error: "Cross-origin request blocked.", code: "forbidden" });
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(ran).toBe(false);
	});

	test.each(["GET", "HEAD"])("%s skips the CSRF check", async (method) => {
		expect((await ok(request(method, cross))).status).toBe(200);
	});

	test("maps HttpError to its status, message and code", async () => {
		const handler = route(async () => {
			throw new HttpError(429, "Slow down.", "rate_limited");
		});
		const res = await handler(request("POST", same));
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ ok: false, error: "Slow down.", code: "rate_limited" });
	});

	test("unknown errors → 500 with the fallback, never the internal message", async () => {
		const spy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const handler = route(async () => {
				throw new Error("ECONNREFUSED 10.0.0.5:993 password=hunter2");
			});
			const res = await handler(request("POST", same));
			expect(res.status).toBe(500);
			const body = await res.json();
			expect(body).toEqual({ ok: false, error: "Something went wrong talking to the mail server.", code: "internal" });
			expect(JSON.stringify(body)).not.toContain("hunter2");
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});

	test("custom fallback message; non-Error throws too", async () => {
		const spy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const handler = route(
				async () => {
					throw "a string";
				},
				{ fallback: "Export failed." },
			);
			const res = await handler(request("GET"));
			expect(res.status).toBe(500);
			expect((await res.json()).error).toBe("Export failed.");
		} finally {
			spy.mockRestore();
		}
	});

	test("errors thrown from readJson inside a handler map to 4xx", async () => {
		const handler = route(async (r) => json(await readJson(r, z.object({ a: z.string() }))));
		const res = await handler(request("POST", { ...same, "content-type": "text/plain" }, "{}"));
		expect(res.status).toBe(415);
	});
});
