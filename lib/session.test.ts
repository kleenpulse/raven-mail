import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { clearSession, decryptSession, encryptSession, getSession, SESSION_COOKIE, setSession } from "@/lib/session";
import { makeSession } from "@/test/helpers/session";
import { cookieState } from "@/test/state";

const envVars = process.env as Record<string, string | undefined>;
const env = { secret: process.env.SESSION_SECRET, nodeEnv: envVars.NODE_ENV };

afterEach(() => {
	process.env.SESSION_SECRET = env.secret;
	if (env.nodeEnv === undefined) delete envVars.NODE_ENV;
	else envVars.NODE_ENV = env.nodeEnv;
});

/** Encrypt an arbitrary payload the way encryptSession does, with the current test secret. */
function sealRaw(payload: unknown): string {
	const key = createHash("sha256").update(process.env.SESSION_SECRET!.trim()).digest();
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

describe("encryptSession / decryptSession", () => {
	test("round-trips", () => {
		const session = makeSession({ password: "hunter2 ✓" });
		expect(decryptSession(encryptSession(session))).toEqual(session);
	});

	test("token is base64url and never carries the password in clear", () => {
		const token = encryptSession(makeSession({ password: "super-secret-pw" }));
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token).not.toContain("super-secret-pw");
		expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain("super-secret-pw");
	});

	test("random IV per encryption", () => {
		const session = makeSession();
		expect(encryptSession(session)).not.toBe(encryptSession(session));
	});

	test.each([0, 12, 28, -1])("a flipped byte at %p → null", (at) => {
		const raw = Buffer.from(encryptSession(makeSession()), "base64url");
		raw[at < 0 ? raw.length + at : at]! ^= 0x01;
		expect(decryptSession(raw.toString("base64url"))).toBeNull();
	});

	test.each([
		["empty", ""],
		["short", randomBytes(28).toString("base64url")],
		["garbage", "not a token at all !!"],
		["random bytes", randomBytes(200).toString("base64url")],
	])("%s → null", (_, token) => {
		expect(decryptSession(token)).toBeNull();
	});

	test("truncated token → null", () => {
		expect(decryptSession(encryptSession(makeSession()).slice(0, -6))).toBeNull();
	});

	test.each([
		["missing email", { ...makeSession(), email: "" }],
		["missing imap.host", { ...makeSession(), imap: { port: 993, secure: true } }],
		["missing imap", { ...makeSession(), imap: undefined }],
		["missing smtp.host", { ...makeSession(), smtp: { host: "", port: 465, secure: true } }],
		["not an object", "just a string"],
		["null", null],
	])("authentic but invalid payload (%s) → null", (_, payload) => {
		expect(decryptSession(sealRaw(payload))).toBeNull();
	});

	test("valid hand-sealed payload decrypts (sanity for the case above)", () => {
		const session = makeSession();
		expect(decryptSession(sealRaw(session))).toEqual(session);
	});

	test("a different SESSION_SECRET can't open the cookie", () => {
		const token = encryptSession(makeSession());
		process.env.SESSION_SECRET = "a-completely-different-secret-0123456789";
		expect(decryptSession(token)).toBeNull();
	});

	test("secret is trimmed", () => {
		const token = encryptSession(makeSession());
		process.env.SESSION_SECRET = `  ${env.secret}\n`;
		expect(decryptSession(token)).not.toBeNull();
	});

	test("outside production a missing or short secret falls back to the dev key", () => {
		delete process.env.SESSION_SECRET;
		const token = encryptSession(makeSession());
		process.env.SESSION_SECRET = "too-short";
		expect(decryptSession(token)).not.toBeNull();
		process.env.SESSION_SECRET = env.secret;
		expect(decryptSession(token)).toBeNull();
	});

	test.each([
		["missing", undefined],
		["short", "x".repeat(31)],
		["whitespace-padded short", `  ${"x".repeat(30)}  `],
	])("production with a %s secret refuses to encrypt", (_, secret) => {
		envVars.NODE_ENV = "production";
		if (secret === undefined) delete process.env.SESSION_SECRET;
		else process.env.SESSION_SECRET = secret;
		expect(() => encryptSession(makeSession())).toThrow("SESSION_SECRET must be set");
	});

	test("production with a missing secret won't open cookies either", () => {
		const token = encryptSession(makeSession());
		envVars.NODE_ENV = "production";
		delete process.env.SESSION_SECRET;
		expect(decryptSession(token)).toBeNull();
	});

	test("production with a real secret works", () => {
		envVars.NODE_ENV = "production";
		const session = makeSession();
		expect(decryptSession(encryptSession(session))).toEqual(session);
	});
});

describe("getSession", () => {
	test("no cookie → null", async () => {
		expect(await getSession()).toBeNull();
	});

	test("reads and decrypts the session cookie", async () => {
		const session = makeSession();
		cookieState.set(SESSION_COOKIE, encryptSession(session));
		expect(await getSession()).toEqual(session);
	});

	test("tampered cookie → null", async () => {
		const raw = Buffer.from(encryptSession(makeSession()), "base64url");
		raw[raw.length - 1]! ^= 0x01;
		cookieState.set(SESSION_COOKIE, raw.toString("base64url"));
		expect(await getSession()).toBeNull();
		cookieState.set(SESSION_COOKIE, "garbage");
		expect(await getSession()).toBeNull();
	});

	test("ignores other cookies", async () => {
		cookieState.set("other", encryptSession(makeSession()));
		expect(await getSession()).toBeNull();
	});
});

describe("setSession / clearSession", () => {
	test("set writes a cookie getSession can read; clear removes it", async () => {
		const session = makeSession();
		await setSession(session);
		expect(cookieState.has(SESSION_COOKIE)).toBe(true);
		expect(await getSession()).toEqual(session);
		await clearSession();
		expect(cookieState.has(SESSION_COOKIE)).toBe(false);
		expect(await getSession()).toBeNull();
	});
});
