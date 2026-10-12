import "server-only";
import { hkdfSync } from "node:crypto";

// Same rules as the session cookie (lib/session.ts): production refuses to run
// without a real secret; development falls back to a fixed, public one.
const DEV_SECRET = "dev-only-session-secret-change-me-in-production-32b";

/**
 * INTEGRATIONS_SECRET lets stored webhooks survive a SESSION_SECRET rotation
 * (which signs everyone out but shouldn't disconnect Slack); it falls back to
 * SESSION_SECRET so a fresh install needs one secret, not two.
 */
function appSecret(): string {
	const secret = (process.env.INTEGRATIONS_SECRET ?? process.env.SESSION_SECRET)?.trim();
	if (secret && secret.length >= 32) return secret;
	if (process.env.NODE_ENV === "production") {
		throw new Error("INTEGRATIONS_SECRET or SESSION_SECRET must be set (32+ chars) in production.");
	}
	return DEV_SECRET;
}

const keys = new Map<string, Buffer>();

/**
 * A 32-byte key dedicated to one purpose (HKDF-SHA256). Keys never collide
 * across purposes, and rotating SESSION_SECRET rotates every one of them.
 */
export function deriveKey(purpose: string): Buffer {
	let key = keys.get(purpose);
	if (!key) {
		key = Buffer.from(hkdfSync("sha256", appSecret(), "raven", purpose, 32));
		keys.set(purpose, key);
	}
	return key;
}
