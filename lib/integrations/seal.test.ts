import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { hmac, sealWith, unsealWith } from "@/lib/integrations/seal";

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 8);
const value = { url: "https://hooks.slack.com/services/T/B/x", n: 1, nested: { ok: true } };

function flip(token: string, index: number): string {
	const raw = Buffer.from(token.slice(3), "base64url");
	raw[index]! ^= 0x01;
	return `v1.${raw.toString("base64url")}`;
}

describe("sealWith / unsealWith", () => {
	test.each([value, "text", 42, null, [1, "two"], { unicode: "héllo ✉" }] as unknown[])("round-trips %p", (v) => {
		expect(unsealWith<unknown>(key, sealWith(key, v, "acct|id"), "acct|id")).toEqual(v);
	});

	test("token is v1-prefixed base64url and hides the plaintext", () => {
		const token = sealWith(key, value, "a");
		expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
		expect(token).not.toContain("hooks.slack.com");
		// iv(12) + tag(16) + ciphertext(same length as the JSON)
		expect(Buffer.from(token.slice(3), "base64url").length).toBe(28 + JSON.stringify(value).length);
	});

	test("random IV: sealing the same value twice gives different tokens", () => {
		const a = sealWith(key, value, "a");
		const b = sealWith(key, value, "a");
		expect(a).not.toBe(b);
		const iv = (t: string) => Buffer.from(t.slice(3), "base64url").subarray(0, 12);
		expect(iv(a).equals(iv(b))).toBe(false);
	});

	test("wrong key throws", () => {
		expect(() => unsealWith(other, sealWith(key, value, "a"), "a")).toThrow();
	});

	test("wrong AAD throws (a copied ciphertext won't open under another row)", () => {
		const token = sealWith(key, value, "acct1|row1");
		expect(() => unsealWith(key, token, "acct1|row2")).toThrow();
		expect(() => unsealWith(key, token, "acct2|row1")).toThrow();
		expect(() => unsealWith(key, token, "")).toThrow();
	});

	test.each([
		["iv", 0],
		["tag", 12],
		["ciphertext", 28],
	])("a flipped %s byte throws", (_, index) => {
		expect(() => unsealWith(key, flip(sealWith(key, value, "a"), index), "a")).toThrow();
	});

	test.each([
		["v2 prefix", (t: string) => `v2.${t.slice(3)}`],
		["no prefix", (t: string) => t.slice(3)],
		["empty prefix", (t: string) => `.${t.slice(3)}`],
		["uppercase prefix", (t: string) => `V1.${t.slice(3)}`],
	])("rejects unknown format: %s", (_, mutate) => {
		expect(() => unsealWith(key, mutate(sealWith(key, value, "a")), "a")).toThrow("Unknown sealed format.");
	});

	test.each([
		["empty body", "v1."],
		["iv only", `v1.${randomBytes(12).toString("base64url")}`],
		["iv + tag, no data", `v1.${randomBytes(28).toString("base64url")}`],
	])("rejects truncated token: %s", (_, token) => {
		expect(() => unsealWith(key, token, "a")).toThrow("Sealed value too short.");
	});

	test("a token cut short past the minimum still fails authentication", () => {
		const token = sealWith(key, value, "a");
		expect(() => unsealWith(key, token.slice(0, -4), "a")).toThrow();
	});

	test("empty string throws", () => {
		expect(() => unsealWith(key, "", "a")).toThrow("Unknown sealed format.");
	});
});

describe("hmac", () => {
	test("stable for the same key and text", () => {
		expect(hmac(key, "hello")).toBe(hmac(key, "hello"));
	});

	test("known vector (HMAC-SHA256, base64url)", () => {
		expect(hmac(Buffer.from("key"), "The quick brown fox jumps over the lazy dog")).toBe(
			"97yD9DBThCSxMpjmqm-xQ-9NWaFJRhdZl0edvC0aPNg",
		);
	});

	test("differs by key and by text", () => {
		expect(hmac(key, "a")).not.toBe(hmac(other, "a"));
		expect(hmac(key, "a")).not.toBe(hmac(key, "b"));
	});

	test("is unpadded base64url of 32 bytes", () => {
		const out = hmac(key, "x");
		expect(out).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(Buffer.from(out, "base64url").length).toBe(32);
	});
});
