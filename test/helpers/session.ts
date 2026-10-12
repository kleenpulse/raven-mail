import { encryptSession, SESSION_COOKIE, type MailSession } from "@/lib/session";

/** A dev-mailbox session. Unique email per call keeps per-session rate limiters apart. */
export function makeSession(over: Partial<MailSession> = {}): MailSession {
	return {
		email: `t-${crypto.randomUUID()}@dev.local`,
		displayName: "Test User",
		provider: "custom" as MailSession["provider"],
		password: "dev",
		imap: { host: "dev.local", port: 993, secure: true },
		smtp: { host: "dev.local", port: 465, secure: true },
		createdAt: Date.now(),
		dev: true,
		...over,
	} as MailSession;
}

export function sessionCookie(session: MailSession = makeSession()): string {
	return `${SESSION_COOKIE}=${encryptSession(session)}`;
}
