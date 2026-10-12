import "server-only";
import { createHash } from "node:crypto";
import type { MailSession } from "@/lib/session";

/** Stable, non-reversible key for per-mailbox caches, limits and locks. */
export function sessionKey(session: Pick<MailSession, "email" | "imap">): string {
	return createHash("sha256")
		.update(`${session.email.trim().toLowerCase()}|${session.imap.host.trim().toLowerCase()}`)
		.digest("base64url")
		.slice(0, 22);
}
