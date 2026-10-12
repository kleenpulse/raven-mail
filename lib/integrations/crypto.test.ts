import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fingerprint, openTarget, sealTarget, tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";

const session = { email: "Maya@Example.com ", imap: { host: " IMAP.example.com", port: 993, secure: true } };

function thrown(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error("expected a throw");
}

describe("tenantKey", () => {
	test("normalizes case and whitespace of email and host", () => {
		expect(tenantKey(session)).toBe(tenantKey({ email: "maya@example.com", imap: { ...session.imap, host: "imap.example.com" } }));
	});

	test("differs by mailbox and by server", () => {
		const base = tenantKey(session);
		expect(tenantKey({ ...session, email: "sam@example.com" })).not.toBe(base);
		expect(tenantKey({ ...session, imap: { ...session.imap, host: "imap.other.com" } })).not.toBe(base);
	});

	test("is keyed: not a plain hash of the address", () => {
		const key = tenantKey(session);
		const plain = createHash("sha256").update("maya@example.com|imap.example.com").digest("base64url");
		expect(key).not.toBe(plain);
		expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

describe("fingerprint", () => {
	test("stable, scoped to the account, and opaque", () => {
		const url = "https://hooks.slack.com/services/T/B/x";
		const a = fingerprint("acct1", url);
		expect(a).toBe(fingerprint("acct1", url));
		expect(a).not.toBe(fingerprint("acct2", url));
		expect(a).not.toBe(fingerprint("acct1", `${url}y`));
		expect(a).not.toContain("slack");
	});

	test("purpose-separated from tenantKey", () => {
		expect(fingerprint("a", "b")).not.toBe(tenantKey({ email: "a", imap: { host: "b", port: 1, secure: true } }));
	});
});

describe("sealTarget / openTarget", () => {
	const url = new URL("https://hooks.zapier.com/hooks/catch/1/abc");

	test("round-trips url and signing secret", () => {
		const opened = openTarget(sealTarget({ url, signingSecret: "whsec_abc" }, "acct", "id-1"), "acct", "id-1");
		expect(opened.url).toBeInstanceOf(URL);
		expect(opened.url.href).toBe(url.href);
		expect(opened.signingSecret).toBe("whsec_abc");
	});

	test("omits signingSecret when there is none", () => {
		const opened = openTarget(sealTarget({ url }, "acct", "id-1"), "acct", "id-1");
		expect(opened.url.href).toBe(url.href);
		expect("signingSecret" in opened).toBe(false);
	});

	test("sealed value hides the URL and secret", () => {
		const sealed = sealTarget({ url, signingSecret: "whsec_abc" }, "acct", "id");
		expect(sealed).not.toContain("zapier");
		expect(sealed).not.toContain("whsec");
	});

	test.each([
		["another account", "acct2", "id-1"],
		["another row", "acct", "id-2"],
	])("won't open under %s", (_, acct, id) => {
		const err = thrown(() => openTarget(sealTarget({ url }, "acct", "id-1"), acct, id));
		expect(err).toBeInstanceOf(IntegrationError);
		expect((err as IntegrationError).code).toBe("secret_unreadable");
		expect((err as IntegrationError).attention).toBe(true);
		expect((err as IntegrationError).cause).toBeInstanceOf(Error);
	});

	test.each(["not-a-token", "", "v1.AAAA"])("garbage %p maps to secret_unreadable", (token) => {
		expect((thrown(() => openTarget(token, "acct", "id")) as IntegrationError).code).toBe("secret_unreadable");
	});
});
