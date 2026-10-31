import { describe, expect, test } from "bun:test";
import { HttpError } from "@/lib/server/guard";
import { isUnreachable, mailError } from "./mail-read";

const withCode = (code: string, message = "boom") => Object.assign(new Error(message), { code });

function codeOf(err: unknown): string {
	try {
		mailError(err);
	} catch (thrown) {
		return thrown instanceof HttpError ? `${thrown.status} ${thrown.code}` : "not an HttpError";
	}
	return "didn't throw";
}

describe("isUnreachable", () => {
	test("network failures, also when wrapped", () => {
		expect(isUnreachable(withCode("ENOTFOUND"))).toBe(true);
		expect(isUnreachable(withCode("ECONNREFUSED"))).toBe(true);
		expect(isUnreachable(withCode("ENETUNREACH"))).toBe(true);
		expect(isUnreachable(new Error("wrapped", { cause: withCode("EHOSTUNREACH") }))).toBe(true);
	});

	test("ImapFlow's connect timeouts", () => {
		expect(isUnreachable(withCode("CONNECT_TIMEOUT"))).toBe(true);
		expect(isUnreachable(withCode("GREETING_TIMEOUT"))).toBe(true);
		expect(isUnreachable(withCode("NoConnection"))).toBe(true);
	});

	test("answers from the server don't count", () => {
		expect(isUnreachable(withCode("CERT_HAS_EXPIRED"))).toBe(false);
		expect(isUnreachable(withCode("ERR_SSL_WRONG_VERSION_NUMBER"))).toBe(false);
		expect(isUnreachable(Object.assign(new Error("Invalid credentials"), { authenticationFailed: true }))).toBe(false);
		expect(isUnreachable(new Error("Command failed"))).toBe(false);
		expect(isUnreachable(null)).toBe(false);
	});
});

describe("mailError", () => {
	test("sorts failures into codes", () => {
		expect(codeOf(withCode("ENOTFOUND"))).toBe("502 mail_unreachable");
		expect(codeOf(new Error("Mailbox not found"))).toBe("404 not_found");
		expect(codeOf(new Error("Command failed"))).toBe("502 mail_server");
		expect(codeOf(new HttpError(401, "Not signed in.", "unauthorized"))).toBe("401 unauthorized");
	});
});
