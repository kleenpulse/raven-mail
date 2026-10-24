import { describe, expect, test } from "bun:test";
import { AuthenticationError } from "@typesafe-ai/sdk";
import { removeJevKeyAction, saveJevKeyAction } from "@/lib/actions/jev-key";
import { decryptSession, encryptSession, SESSION_COOKIE, type MailSession } from "@/lib/session";
import { fakeJev } from "@/test/helpers/jev";
import { makeSession } from "@/test/helpers/session";
import { cookieState } from "@/test/state";

const KEY = "ts_live_0123456789abcdefWXYZ";

function signIn(over: Partial<MailSession> = {}): MailSession {
	const session = makeSession(over);
	cookieState.set(SESSION_COOKIE, encryptSession(session));
	return session;
}

const saved = () => decryptSession(cookieState.get(SESSION_COOKIE) ?? "");

describe("saveJevKeyAction", () => {
	test("without a session it asks you to sign in and checks nothing", async () => {
		const result = await saveJevKeyAction(KEY);
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Sign in again") });
		expect(fakeJev.verifyKey).not.toHaveBeenCalled();
	});

	test.each([
		["short", "too short"],
		[`${"k".repeat(20)} ${"k".repeat(20)}`, "no spaces"],
		["k".repeat(300), "too long"],
	])("rejects a malformed key (%#) before calling TypeSafe", async (raw, message) => {
		signIn();
		const result = await saveJevKeyAction(raw);
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining(message) });
		expect(fakeJev.verifyKey).not.toHaveBeenCalled();
		expect(saved()?.jevKey).toBeUndefined();
	});

	test("a key TypeSafe rejects is not saved", async () => {
		signIn();
		fakeJev.verifyKey.mockImplementation(async () => {
			throw new AuthenticationError(401, { message: "bad key" }, new Headers());
		});
		const result = await saveJevKeyAction(KEY);
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining("didn't accept that key") });
		expect(saved()?.jevKey).toBeUndefined();
	});

	test("an accepted key is trimmed, saved in the session, and only its last four characters come back", async () => {
		const session = signIn();
		const result = await saveJevKeyAction(`  ${KEY}\n`);
		expect(fakeJev.verifyKey).toHaveBeenCalledWith(KEY);
		expect(result).toEqual({ ok: true, data: { source: "user", hint: "WXYZ", kage: false, live: true } });
		expect(JSON.stringify(result)).not.toContain(KEY);
		expect(saved()).toMatchObject({ email: session.email, jevKey: KEY });
	});
});

describe("removeJevKeyAction", () => {
	test("drops the key and keeps the rest of the session", async () => {
		const session = signIn({ jevKey: KEY });
		const result = await removeJevKeyAction();
		expect(result).toEqual({ ok: true, data: { source: null, hint: null, kage: false, live: false } });
		expect(saved()).toMatchObject({ email: session.email });
		expect(saved()?.jevKey).toBeUndefined();
	});

	test("falls back to the server key when there is one", async () => {
		signIn({ jevKey: KEY });
		fakeJev.enabled = true;
		expect(await removeJevKeyAction()).toEqual({ ok: true, data: { source: "server", hint: null, kage: false, live: true } });
	});
});
