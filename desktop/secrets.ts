import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

/*
 * The server needs SESSION_SECRET (seals the sign-in cookie) and
 * INTEGRATIONS_SECRET (seals webhook URLs, rules and the per-account key every
 * stored row is filed under). The desktop app makes both on first launch and
 * keeps them sealed by the OS keychain (Electron safeStorage).
 *
 * They must never change by accident: a new secret signs the user out and
 * leaves every stored row unreadable. So a keychain that changed under us
 * (Linux: libsecret today, basic_text tomorrow) is reported, not silently
 * replaced; only a file that can't be read with the same keychain is.
 */

export type Secrets = { SESSION_SECRET: string; INTEGRATIONS_SECRET: string };

export interface Sealer {
	/** Which keychain seals the data ("win32", "darwin", or the Linux backend). */
	readonly backend: string;
	/** False when nothing really encrypts (Linux basic_text): the file is stored as is, owner-only. */
	readonly protects: boolean;
	seal(text: string): Promise<Buffer>;
	open(sealed: Buffer): Promise<{ text: string; reseal: boolean }>;
}

export interface SecretStore {
	read(): Buffer | null;
	write(data: Buffer): void;
	/** Moves an unreadable file aside, keeping it for the user. */
	keepBroken(): void;
}

export type SecretsResult =
	| { kind: "ok"; secrets: Secrets; created: boolean; reset: boolean }
	| { kind: "keychain-changed"; was: string; now: string };

type Envelope = { v: 1; backend: string; protected: boolean; data: string };

const MIN_LENGTH = 32;

export function newSecret(): string {
	return randomBytes(32).toString("base64url");
}

export async function loadSecrets(store: SecretStore, sealer: Sealer, random: () => string = newSecret): Promise<SecretsResult> {
	const raw = store.read();
	if (!raw) return { kind: "ok", secrets: await create(store, sealer, random), created: true, reset: false };

	const envelope = parseEnvelope(raw);
	const sameKeychain = envelope?.backend === sealer.backend;
	const opened = envelope ? await openEnvelope(envelope, sealer) : null;
	if (!opened) {
		if (envelope && !sameKeychain) return { kind: "keychain-changed", was: envelope.backend, now: sealer.backend };
		return resetSecrets(store, sealer, random);
	}
	if (opened.reseal || !sameKeychain) store.write(await envelopeFor(opened.secrets, sealer));
	return { kind: "ok", secrets: opened.secrets, created: false, reset: false };
}

/** Starts over with new secrets, keeping the old file aside. */
export async function resetSecrets(store: SecretStore, sealer: Sealer, random: () => string = newSecret): Promise<SecretsResult> {
	store.keepBroken();
	return { kind: "ok", secrets: await create(store, sealer, random), created: true, reset: true };
}

async function create(store: SecretStore, sealer: Sealer, random: () => string): Promise<Secrets> {
	const secrets: Secrets = { SESSION_SECRET: random(), INTEGRATIONS_SECRET: random() };
	if (!valid(secrets)) throw new Error("generated secrets are too short");
	store.write(await envelopeFor(secrets, sealer));
	return secrets;
}

async function envelopeFor(secrets: Secrets, sealer: Sealer): Promise<Buffer> {
	const text = JSON.stringify(secrets);
	const data = sealer.protects ? (await sealer.seal(text)).toString("base64") : Buffer.from(text).toString("base64");
	const envelope: Envelope = { v: 1, backend: sealer.backend, protected: sealer.protects, data };
	return Buffer.from(`${JSON.stringify(envelope)}\n`);
}

function parseEnvelope(raw: Buffer): Envelope | null {
	try {
		const value = JSON.parse(raw.toString("utf8")) as Partial<Envelope>;
		if (value.v !== 1 || typeof value.backend !== "string" || typeof value.protected !== "boolean" || typeof value.data !== "string") return null;
		return value as Envelope;
	} catch {
		return null;
	}
}

async function openEnvelope(envelope: Envelope, sealer: Sealer): Promise<{ secrets: Secrets; reseal: boolean } | null> {
	try {
		const bytes = Buffer.from(envelope.data, "base64");
		const { text, reseal } = envelope.protected ? await sealer.open(bytes) : { text: bytes.toString("utf8"), reseal: sealer.protects };
		const secrets = JSON.parse(text) as Secrets;
		return valid(secrets) ? { secrets, reseal } : null;
	} catch {
		return null;
	}
}

function valid(secrets: Partial<Secrets>): secrets is Secrets {
	return (
		typeof secrets.SESSION_SECRET === "string" &&
		typeof secrets.INTEGRATIONS_SECRET === "string" &&
		secrets.SESSION_SECRET.trim().length >= MIN_LENGTH &&
		secrets.INTEGRATIONS_SECRET.trim().length >= MIN_LENGTH &&
		secrets.SESSION_SECRET !== secrets.INTEGRATIONS_SECRET
	);
}

/** secrets.json in the data folder: written atomically, readable by the owner only. */
export function fileStore(path: string): SecretStore {
	return {
		read() {
			try {
				return readFileSync(path);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw err;
			}
		},
		write(data) {
			const tmp = `${path}.tmp`;
			writeFileSync(tmp, data, { mode: 0o600 });
			renameSync(tmp, path);
		},
		keepBroken() {
			try {
				renameSync(path, `${path}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
			}
		},
	};
}
