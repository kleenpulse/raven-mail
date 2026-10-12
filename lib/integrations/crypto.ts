import "server-only";
import { deriveKey } from "@/lib/server/secret";
import type { MailSession } from "@/lib/session";
import { IntegrationError } from "./errors";
import type { Target } from "./providers";
import { hmac, sealWith, unsealWith } from "./seal";

/**
 * The tenant id for a mailbox. Keyed, so a leaked table can't be joined back to
 * email addresses by hashing guesses (a plain sha256 could be).
 */
export function tenantKey(session: Pick<MailSession, "email" | "imap">): string {
	return hmac(
		deriveKey("raven:tenant:v1"),
		`${session.email.trim().toLowerCase()}|${session.imap.host.trim().toLowerCase()}`,
	);
}

/** Dedupe key for a webhook within one account — reveals nothing about the URL. */
export function fingerprint(accountKey: string, canonical: string): string {
	return hmac(deriveKey("raven:fingerprint:v1"), `${accountKey}|${canonical}`);
}

type SealedTarget = { url: string; signingSecret?: string };

export function sealTarget(target: Target, accountKey: string, id: string): string {
	const value: SealedTarget = { url: target.url.toString(), ...(target.signingSecret ? { signingSecret: target.signingSecret } : {}) };
	return sealWith(deriveKey("raven:integrations:v1"), value, `${accountKey}|${id}`);
}

export function openTarget(sealed: string, accountKey: string, id: string): Target {
	try {
		const value = unsealWith<SealedTarget>(deriveKey("raven:integrations:v1"), sealed, `${accountKey}|${id}`);
		return { url: new URL(value.url), ...(value.signingSecret ? { signingSecret: value.signingSecret } : {}) };
	} catch (err) {
		throw new IntegrationError("secret_unreadable", { cause: err });
	}
}
