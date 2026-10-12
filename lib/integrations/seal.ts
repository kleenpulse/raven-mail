import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/*
 * AES-256-GCM with associated data. The AAD binds a sealed value to where it
 * lives (account + row id), so a copied ciphertext won't open anywhere else.
 * Format: `v1.` + base64url(iv[12] | tag[16] | ciphertext).
 */

const VERSION = "v1";

export function sealWith(key: Buffer, value: unknown, aad: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(aad, "utf8"));
	const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
	return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}

/** Throws on a wrong key, wrong AAD, tampering or an unknown version. */
export function unsealWith<T>(key: Buffer, token: string, aad: string): T {
	const dot = token.indexOf(".");
	if (dot === -1 || token.slice(0, dot) !== VERSION) throw new Error("Unknown sealed format.");
	const raw = Buffer.from(token.slice(dot + 1), "base64url");
	if (raw.length < 29) throw new Error("Sealed value too short.");
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
	decipher.setAAD(Buffer.from(aad, "utf8"));
	decipher.setAuthTag(raw.subarray(12, 28));
	const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
	return JSON.parse(plain.toString("utf8")) as T;
}

export function hmac(key: Buffer, text: string): string {
	return createHmac("sha256", key).update(text, "utf8").digest("base64url");
}
