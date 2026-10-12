import { describe, expect, test } from "bun:test";
import { Webhook } from "standardwebhooks";
import { newMessageId, newSigningSecret, signedHeaders, signPayload } from "@/lib/integrations/signing";

const body = JSON.stringify({ type: "raven.test", data: { hello: "wörld" } });

describe("newSigningSecret", () => {
	test("whsec_ + base64 of 24 random bytes, unique", () => {
		const secret = newSigningSecret();
		expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
		expect(Buffer.from(secret.slice(6), "base64").length).toBe(24);
		expect(newSigningSecret()).not.toBe(secret);
	});
});

describe("newMessageId", () => {
	test("msg_ + 32 hex chars, unique", () => {
		const id = newMessageId();
		expect(id).toMatch(/^msg_[0-9a-f]{32}$/);
		expect(newMessageId()).not.toBe(id);
	});
});

describe("signPayload", () => {
	test("verifies with the standardwebhooks library", () => {
		const secret = newSigningSecret();
		const ts = Math.floor(Date.now() / 1000);
		const sig = signPayload(secret, "msg_1", ts, body);
		const headers = { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": sig };
		expect(new Webhook(secret).verify(body, headers)).toEqual(JSON.parse(body));
	});

	test("matches the library's own signature", () => {
		const secret = newSigningSecret();
		const ts = 1_700_000_000;
		expect(signPayload(secret, "msg_x", ts, body)).toBe(new Webhook(secret).sign("msg_x", new Date(ts * 1000), body));
	});

	test("accepts a secret without the whsec_ prefix", () => {
		const secret = newSigningSecret();
		expect(signPayload(secret.slice(6), "m", 1, "b")).toBe(signPayload(secret, "m", 1, "b"));
	});

	test("format v1,<base64 sha256>", () => {
		expect(signPayload(newSigningSecret(), "m", 1, "b")).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
	});

	test.each([
		["body", (s: string) => signPayload(s, "m", 1, "B")],
		["id", (s: string) => signPayload(s, "n", 1, "b")],
		["timestamp", (s: string) => signPayload(s, "m", 2, "b")],
		["secret", () => signPayload(newSigningSecret(), "m", 1, "b")],
	])("changes when the %s changes", (_, variant) => {
		const secret = newSigningSecret();
		expect(variant(secret)).not.toBe(signPayload(secret, "m", 1, "b"));
	});
});

describe("signedHeaders", () => {
	test("with a secret: id, timestamp in seconds and a verifiable signature", () => {
		const secret = newSigningSecret();
		const now = Date.now();
		const headers = signedHeaders(secret, body, () => now);
		expect(Object.keys(headers).sort()).toEqual(["webhook-id", "webhook-signature", "webhook-timestamp"]);
		expect(headers["webhook-id"]).toMatch(/^msg_[0-9a-f]{32}$/);
		expect(headers["webhook-timestamp"]).toBe(String(Math.floor(now / 1000)));
		expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
	});

	test("verification fails on a tampered body or a different secret", () => {
		const secret = newSigningSecret();
		const headers = signedHeaders(secret, body);
		expect(() => new Webhook(secret).verify(`${body} `, headers)).toThrow();
		expect(() => new Webhook(newSigningSecret()).verify(body, headers)).toThrow();
	});

	test("a stale timestamp is rejected by receivers", () => {
		const secret = newSigningSecret();
		const headers = signedHeaders(secret, body, () => Date.now() - 60 * 60_000);
		expect(() => new Webhook(secret).verify(body, headers)).toThrow();
	});

	test("without a secret: no signature header", () => {
		expect(signedHeaders(undefined, body, () => 1_700_000_000_999)).toEqual({
			"webhook-id": expect.stringMatching(/^msg_/),
			"webhook-timestamp": "1700000000",
		});
	});

	test("an empty secret is treated as unsigned", () => {
		expect("webhook-signature" in signedHeaders("", body)).toBe(false);
	});

	test("fresh message id per call", () => {
		expect(signedHeaders(undefined, body)["webhook-id"]).not.toBe(signedHeaders(undefined, body)["webhook-id"]);
	});
});
