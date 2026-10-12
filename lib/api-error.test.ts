import { describe, expect, test } from "bun:test";
import { ApiError, readApiError, toApiError } from "@/lib/api-error";

describe("ApiError", () => {
	test("defaults", () => {
		const err = new ApiError("nope", { status: 400 });
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("ApiError");
		expect([err.message, err.status, err.code, err.hint, err.retryable, err.retryAfterMs]).toEqual([
			"nope",
			400,
			"error",
			undefined,
			false,
			undefined,
		]);
	});
});

describe("readApiError", () => {
	test("reads the catalog fields from an { ok: false } body", async () => {
		const res = Response.json(
			{ ok: false, error: "Slow down.", code: "too_many_requests", hint: "Wait.", retryable: true, retryAfterMs: 2000 },
			{ status: 429 },
		);
		const err = await readApiError(res);
		expect([err.message, err.status, err.code, err.hint, err.retryable, err.retryAfterMs]).toEqual([
			"Slow down.",
			429,
			"too_many_requests",
			"Wait.",
			true,
			2000,
		]);
	});

	test.each([
		[500, true],
		[503, true],
		[400, false],
		[404, false],
	])("status %p without a retryable field → retryable %p", async (status, retryable) => {
		const err = await readApiError(Response.json({ ok: false, error: "x" }, { status }));
		expect(err.retryable).toBe(retryable);
	});

	test("explicit retryable=false wins over a 5xx", async () => {
		expect((await readApiError(Response.json({ ok: false, error: "x", retryable: false }, { status: 502 }))).retryable).toBe(false);
	});

	test("non-JSON body falls back to a generic message", async () => {
		const err = await readApiError(new Response("<html>Bad Gateway</html>", { status: 502 }));
		expect(err.message).toBe("Request failed (502)");
		expect(err.code).toBe("error");
		expect(err.retryable).toBe(true);
	});

	test("JSON without an error string", async () => {
		expect((await readApiError(Response.json({ ok: false }, { status: 401 }))).message).toBe("Request failed (401)");
	});

	test("empty body", async () => {
		expect((await readApiError(new Response(null, { status: 404 }))).message).toBe("Request failed (404)");
	});
});

describe("toApiError", () => {
	test("passes ApiErrors through", () => {
		const err = new ApiError("x", { status: 400 });
		expect(toApiError(err)).toBe(err);
	});

	test("TypeError (fetch network failure) → retryable network error", () => {
		const err = toApiError(new TypeError("Failed to fetch"));
		expect([err.status, err.code, err.retryable, err.message]).toEqual([0, "network", true, "Couldn't reach Raven."]);
		expect(err.hint).toBeTruthy();
	});

	test("other Errors keep their message as internal", () => {
		const err = toApiError(new Error("boom"));
		expect([err.message, err.status, err.code, err.retryable]).toEqual(["boom", 0, "internal", false]);
	});

	test.each(["string", null, undefined, 42])("non-Error %p → generic internal", (thrown) => {
		expect(toApiError(thrown).message).toBe("Something went wrong.");
	});
});
