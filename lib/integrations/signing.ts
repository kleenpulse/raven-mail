import { createHmac, randomBytes, randomUUID } from "node:crypto";

/*
 * Standard Webhooks (https://www.standardwebhooks.com): receivers can verify
 * Raven's deliveries with any off-the-shelf library (Svix, standardwebhooks…).
 *   signature = base64(HMAC-SHA256(key = base64decode(secret without "whsec_"),
 *                                  msg = `${id}.${timestamp}.${body}`))
 */

const PREFIX = "whsec_";

export function newSigningSecret(): string {
	return `${PREFIX}${randomBytes(24).toString("base64")}`;
}

export function newMessageId(): string {
	return `msg_${randomUUID().replaceAll("-", "")}`;
}

export function signPayload(secret: string, id: string, timestampSec: number, body: string): string {
	const key = Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, "base64");
	const mac = createHmac("sha256", key).update(`${id}.${timestampSec}.${body}`).digest("base64");
	return `v1,${mac}`;
}

export function signedHeaders(
	secret: string | undefined,
	body: string,
	now: () => number = Date.now,
): Record<string, string> {
	const id = newMessageId();
	const timestamp = Math.floor(now() / 1000);
	return {
		"webhook-id": id,
		"webhook-timestamp": String(timestamp),
		...(secret ? { "webhook-signature": signPayload(secret, id, timestamp, body) } : {}),
	};
}
