import { describe as group, expect, test } from "bun:test";
import {
	describe,
	ERROR_COPY,
	IntegrationError,
	isErrorCode,
	toIntegrationError,
	type IntegrationErrorCode,
} from "@/lib/integrations/errors";

const codes = Object.keys(ERROR_COPY) as IntegrationErrorCode[];

group("ERROR_COPY", () => {
	test.each(codes)("%s has a title and hint in plain sentences", (code) => {
		const { title, hint } = ERROR_COPY[code];
		expect(title.length).toBeGreaterThan(0);
		expect(hint.length).toBeGreaterThan(0);
		expect(title).toMatch(/[.!?]$/);
		expect(hint).toMatch(/[.!?)]$/);
	});
});

group("isErrorCode", () => {
	test("known codes", () => {
		for (const code of codes) expect(isErrorCode(code)).toBe(true);
	});

	test.each(["nope", "", "toString", "constructor", "__proto__", "hasOwnProperty"])("rejects %p", (code) => {
		expect(isErrorCode(code)).toBe(false);
	});
});

group("IntegrationError", () => {
	test("defaults from the catalog", () => {
		const err = new IntegrationError("timeout");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("IntegrationError");
		expect(err.code).toBe("timeout");
		expect(err.message).toBe(ERROR_COPY.timeout.title);
		expect(err.hint).toBe(ERROR_COPY.timeout.hint);
		expect(err.retryable).toBe(true);
		expect(err.attention).toBe(false);
		expect(err.retryAfterMs).toBeUndefined();
	});

	test("options override message, hint, status and carry cause/retryAfter", () => {
		const cause = new Error("boom");
		const err = new IntegrationError("rate_limited", { message: "m", hint: "h", status: 418, retryAfterMs: 1500, cause });
		expect([err.message, err.hint, err.status, err.retryAfterMs]).toEqual(["m", "h", 418, 1500]);
		expect(err.cause).toBe(cause);
	});

	test.each([
		["invalid_request", 400],
		["invalid_url", 400],
		["insecure_url", 400],
		["wrong_provider_url", 400],
		["private_address", 400],
		["not_found", 404],
		["folder_missing", 404],
		["duplicate", 409],
		["limit_reached", 409],
		["paused", 409],
		["export_running", 409],
		["export_changed", 409],
		["jev_no_key", 409],
		["export_too_large", 413],
		["too_many_requests", 429],
		["db_not_configured", 503],
		["db_not_migrated", 503],
		["db_unavailable", 503],
		["internal", 500],
		["timeout", 502],
		["revoked", 502],
		["imap_auth_failed", 502],
		["secret_unreadable", 502],
	] as [IntegrationErrorCode, number][])("%s → %d", (code, status) => {
		expect(new IntegrationError(code).status).toBe(status);
	});

	test.each([
		["revoked", false, true],
		["secret_unreadable", false, true],
		["redirect_blocked", false, true],
		["rate_limited", true, false],
		["upstream_error", true, false],
		["payload_rejected", false, false],
		["internal", false, false],
	] as [IntegrationErrorCode, boolean, boolean][])("%s: retryable=%p attention=%p", (code, retryable, attention) => {
		const err = new IntegrationError(code);
		expect(err.retryable).toBe(retryable);
		expect(err.attention).toBe(attention);
	});
});

group("toIntegrationError", () => {
	test("passes IntegrationErrors through", () => {
		const err = new IntegrationError("dns_failed");
		expect(toIntegrationError(err)).toBe(err);
	});

	test.each([new Error("secret stack detail"), "string", null, { code: "timeout" }])("wraps %p as internal", (thrown) => {
		const err = toIntegrationError(thrown);
		expect(err.code).toBe("internal");
		expect(err.status).toBe(500);
		expect(err.message).toBe(ERROR_COPY.internal.title);
		expect(err.cause).toBe(thrown);
	});
});

group("describe", () => {
	test("wire shape, without retryAfterMs when unset", () => {
		const out = describe(new IntegrationError("upstream_error"));
		expect(out).toEqual({
			code: "upstream_error",
			message: ERROR_COPY.upstream_error.title,
			hint: ERROR_COPY.upstream_error.hint,
			retryable: true,
		});
		expect("retryAfterMs" in out).toBe(false);
	});

	test("includes retryAfterMs (even 0) and never the cause", () => {
		const out = describe(new IntegrationError("rate_limited", { retryAfterMs: 0, cause: new Error("internal detail") }));
		expect(out.retryAfterMs).toBe(0);
		expect(JSON.stringify(out)).not.toContain("internal detail");
	});
});
