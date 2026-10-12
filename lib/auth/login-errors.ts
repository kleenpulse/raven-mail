import { classifyImapError, classifySmtpError } from "@/lib/integrations/diagnostics/classify";
import type { ProviderPreset } from "@/lib/providers";

/*
 * Turns a failed IMAP/SMTP sign-in into words a person can act on. Servers
 * answer in protocol-speak ("534-5.7.9 Application-specific password
 * required … gsmtp"); the raw text only survives as a collapsed detail.
 */

export type LoginFailureCode =
	| "app_password_required"
	| "web_login_required"
	| "basic_auth_blocked"
	| "auth_failed"
	| "server_unreachable"
	| "timeout"
	| "tls_failed"
	| "rate_limited"
	| "unknown";

export type LoginFailure = {
	code: LoginFailureCode;
	/** One sentence: what went wrong. */
	error: string;
	/** What to do about it. */
	hint?: string;
	help?: { href: string; label: string };
	/** Which input to flag. */
	field?: "email" | "password" | "server";
	/** The server's own words, for the curious. */
	detail?: string;
};

type Side = "imap" | "smtp";

type Raw = { responseText?: string; response?: string; message?: string; code?: string; responseCode?: number };

function rawText(err: unknown): string {
	const e = (err ?? {}) as Raw;
	return [e.responseText, e.response, e.message].filter((t): t is string => typeof t === "string").join(" ");
}

export function serverDetail(err: unknown): string | undefined {
	const text = rawText(err).replace(/\s+/g, " ").trim();
	return text ? text.slice(0, 300) : undefined;
}

const APP_PASSWORD_REQUIRED = /application-specific password required|InvalidSecondFactor|\b5\.7\.9\b|app(lication)?[- ]specific password/i;
const WEB_LOGIN_REQUIRED = /\b5\.7\.14\b|WebLoginRequired|log in via your web browser|sign in via your web browser/i;
const BASIC_AUTH_BLOCKED = /BasicAuthBlocked|basic authentication is disabled|SmtpClientAuthentication is disabled/i;

export function describeLoginFailure(err: unknown, side: Side, provider: ProviderPreset): LoginFailure {
	const detail = serverDetail(err);
	const text = rawText(err);
	const name = provider.id === "custom" ? "The mail server" : provider.label.replace(/ \(.*\)$/, "");
	const appOnly = provider.password.kind === "app";
	const help = provider.password.help;
	const base = { detail, ...(help ? { help } : {}) };

	if (APP_PASSWORD_REQUIRED.test(text)) {
		return {
			...base,
			code: "app_password_required",
			error: `${name} needs an app password, not your regular password.`,
			hint: provider.hint,
			field: "password",
		};
	}
	if (WEB_LOGIN_REQUIRED.test(text)) {
		return {
			...base,
			code: "web_login_required",
			error: `${name} blocked this sign-in until you confirm it's you.`,
			hint: "Sign in to your mailbox in a browser once, approve any security prompt, then try again here.",
			field: "password",
		};
	}
	if (BASIC_AUTH_BLOCKED.test(text)) {
		return {
			...base,
			code: "basic_auth_blocked",
			error: `${name} has turned off password sign-in for mail apps on this account.`,
			hint: "Your admin (or account settings) must allow IMAP and SMTP with a password or app password.",
			field: "password",
		};
	}

	const classified = side === "imap" ? classifyImapError(err, provider.id) : classifySmtpError(err, provider.id);
	switch (classified.code) {
		case "imap_auth_failed":
		case "smtp_auth_failed":
			return {
				...base,
				code: "auth_failed",
				error: appOnly
					? `${name} didn't accept that email and app password.`
					: provider.password.kind === "bridge"
						? "Proton Bridge didn't accept that email and password."
						: `${name} didn't accept that email and password.`,
				hint: appOnly
					? "Check the address and paste the app password again. Your regular password won't work here."
					: provider.hint,
				field: "password",
			};
		case "timeout":
			return {
				...base,
				code: "timeout",
				error: `${name} didn't answer in time.`,
				hint: "It may be busy or unreachable from here. Try again in a moment.",
				field: provider.id === "custom" ? "server" : undefined,
			};
		case "tls_failed":
		case "cert_invalid":
		case "tls_required":
			return {
				...base,
				code: "tls_failed",
				error: "Couldn't open a secure connection to the mail server.",
				hint: provider.id === "custom" ? "Check the port and the TLS setting for each server." : classified.hint,
				field: "server",
			};
		case "rate_limited":
			return { ...base, code: "rate_limited", error: `${name} is limiting sign-ins right now.`, hint: "Wait a few minutes, then try again." };
		case "dns_failed":
		case "imap_unreachable":
		case "smtp_unreachable":
			return {
				...base,
				code: "server_unreachable",
				error: side === "imap" ? `Couldn't reach ${name === "The mail server" ? "the mail server" : `${name}'s mail server`}.` : "Couldn't reach the outgoing (SMTP) server.",
				hint:
					provider.id === "custom"
						? "Check the host names and ports."
						: provider.password.kind === "bridge"
							? "Make sure Proton Bridge is running on this machine."
							: "Check your connection and try again.",
				field: provider.id === "custom" ? "server" : undefined,
			};
		default:
			return {
				...base,
				code: "unknown",
				error: side === "imap" ? "Signed in, but the mailbox didn't respond." : "Reading works, but sending failed to connect.",
				hint: "Try again in a moment.",
			};
	}
}
