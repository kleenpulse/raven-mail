import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileStore, loadSecrets, resetSecrets, type Sealer, type Secrets } from "./secrets";

/** A stand-in keychain: reversible, but never stores the text as is. */
function keychain(backend = "win32", protects = true, opts: { reseal?: boolean } = {}): Sealer {
	const tag = Buffer.from(`${backend}:`);
	return {
		backend,
		protects,
		seal: async (text) => Buffer.concat([tag, Buffer.from(text).reverse()]),
		open: async (sealed) => {
			if (!sealed.subarray(0, tag.length).equals(tag)) throw new Error("wrong key");
			return { text: Buffer.from(sealed.subarray(tag.length)).reverse().toString(), reseal: opts.reseal ?? false };
		},
	};
}

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "raven-secrets-"));
	file = path.join(dir, "secrets.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function ok(result: Awaited<ReturnType<typeof loadSecrets>>): Promise<Secrets> {
	if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
	return result.secrets;
}

describe("loadSecrets", () => {
	test("first launch makes two different 43-character secrets and stores them sealed", async () => {
		const result = await loadSecrets(fileStore(file), keychain());
		expect(result).toMatchObject({ kind: "ok", created: true, reset: false });
		const secrets = await ok(result);
		expect(secrets.SESSION_SECRET).toHaveLength(43);
		expect(secrets.INTEGRATIONS_SECRET).toHaveLength(43);
		expect(secrets.SESSION_SECRET).not.toBe(secrets.INTEGRATIONS_SECRET);
		const stored = readFileSync(file, "utf8");
		expect(stored).not.toContain(secrets.SESSION_SECRET);
		expect(stored).not.toContain(secrets.INTEGRATIONS_SECRET);
		if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("later launches get the same secrets back", async () => {
		const first = await ok(await loadSecrets(fileStore(file), keychain()));
		const again = await loadSecrets(fileStore(file), keychain());
		expect(again).toMatchObject({ kind: "ok", created: false, reset: false });
		expect(await ok(again)).toEqual(first);
	});

	test("a file the same keychain can't read is kept aside and replaced", async () => {
		const first = await ok(await loadSecrets(fileStore(file), keychain()));
		writeFileSync(file, JSON.stringify({ v: 1, backend: "win32", protected: true, data: Buffer.from("garbage").toString("base64") }));
		const result = await loadSecrets(fileStore(file), keychain());
		expect(result).toMatchObject({ kind: "ok", created: true, reset: true });
		expect((await ok(result)).SESSION_SECRET).not.toBe(first.SESSION_SECRET);
		expect(readdirSync(dir).some((name) => name.startsWith("secrets.json.broken-"))).toBe(true);
	});

	test("a changed keychain is reported, not silently replaced", async () => {
		await loadSecrets(fileStore(file), keychain("gnome_libsecret"));
		const before = readFileSync(file, "utf8");
		const result = await loadSecrets(fileStore(file), keychain("kwallet6"));
		expect(result).toEqual({ kind: "keychain-changed", was: "gnome_libsecret", now: "kwallet6" });
		expect(readFileSync(file, "utf8")).toBe(before);

		const reset = await resetSecrets(fileStore(file), keychain("kwallet6"));
		expect(reset).toMatchObject({ kind: "ok", reset: true });
		expect(await ok(await loadSecrets(fileStore(file), keychain("kwallet6")))).toEqual(await ok(reset));
	});

	test("a keychain that can't encrypt right now is reported, not silently replaced", async () => {
		await loadSecrets(fileStore(file), keychain("darwin"));
		const before = readFileSync(file, "utf8");
		const down: Sealer = { ...keychain("darwin", false), open: async () => Promise.reject(new Error("keychain unavailable")) };
		expect(await loadSecrets(fileStore(file), down)).toEqual({ kind: "keychain-unavailable", backend: "darwin" });
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(readdirSync(dir).some((name) => name.startsWith("secrets.json.broken-"))).toBe(false);
	});

	test("Linux without a keyring stores them as is, and seals them once a keyring appears", async () => {
		const plain = await ok(await loadSecrets(fileStore(file), keychain("basic_text", false)));
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ backend: "basic_text", protected: false });
		expect(await ok(await loadSecrets(fileStore(file), keychain("gnome_libsecret")))).toEqual(plain);
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ backend: "gnome_libsecret", protected: true });
	});

	test("a key rotation re-seals the file", async () => {
		const first = await ok(await loadSecrets(fileStore(file), keychain()));
		const store = fileStore(file);
		let writes = 0;
		const counting = { ...store, write: (data: Buffer) => (writes++, store.write(data)) };
		expect(await ok(await loadSecrets(counting, keychain()))).toEqual(first);
		expect(writes).toBe(0);
		expect(await ok(await loadSecrets(counting, keychain("win32", true, { reseal: true })))).toEqual(first);
		expect(writes).toBe(1);
	});
});

describe("generated secrets pass the server's production checks", () => {
	test("lib/session.ts and lib/server/secret.ts accept them", async () => {
		const secrets = await ok(await loadSecrets(fileStore(file), keychain()));
		const saved = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET, INTEGRATIONS_SECRET: process.env.INTEGRATIONS_SECRET };
		Object.assign(process.env, { NODE_ENV: "production", ...secrets });
		try {
			const { decryptSession, encryptSession } = await import("@/lib/session");
			const { deriveKey } = await import("@/lib/server/secret");
			const session = {
				email: "ada@example.com",
				displayName: "Ada",
				provider: "custom" as const,
				password: "pw",
				imap: { host: "127.0.0.1", port: 1143, secure: false },
				smtp: { host: "127.0.0.1", port: 1025, secure: false },
				createdAt: 1,
			};
			expect(decryptSession(encryptSession(session))).toMatchObject({ email: "ada@example.com" });
			expect(deriveKey("raven:desktop-test:v1")).toHaveLength(32);
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});
