import { IntegrationError } from "../errors";
import { errorCodes, netErrorCode } from "../net-errors";

/*
 * imapflow and nodemailer each have their own error vocabulary; the login form
 * used to flatten both into one string. Here they become catalog codes with a
 * fix that fits the user's provider.
 */

type ImapLike = {
	authenticationFailed?: boolean;
	serverResponseCode?: string;
	responseText?: string;
	tlsFailed?: boolean;
	code?: string;
	message?: string;
};

type SmtpLike = { code?: string; responseCode?: number; command?: string; response?: string; message?: string };

/** Per-provider fix for a rejected password (presets from lib/providers.ts). */
const AUTH_HINTS: Record<string, string> = {
	gmail: "Gmail needs an app password (Google Account → Security → App passwords) with IMAP enabled.",
	outlook: "Outlook.com needs an app password, and IMAP must be allowed in Outlook settings.",
	yahoo: "Yahoo needs an app password (Account Security → Generate app password).",
	icloud: "iCloud needs an app-specific password (appleid.apple.com → Sign-In and Security).",
	fastmail: "Fastmail needs an app password with IMAP/SMTP access (Settings → Privacy & Security).",
	proton: "Proton Bridge must be running; use the Bridge password, not your Proton password.",
};

function detail(err: { responseText?: string; response?: string; message?: string }): string | undefined {
	const text = err.responseText ?? err.response ?? err.message;
	return typeof text === "string" && text.trim() ? text.trim().slice(0, 160) : undefined;
}

export function classifyImapError(err: unknown, provider?: string): IntegrationError {
	if (err instanceof IntegrationError) return err;
	const e = (err ?? {}) as ImapLike;
	if (e.authenticationFailed || e.serverResponseCode === "AUTHENTICATIONFAILED") {
		return new IntegrationError("imap_auth_failed", {
			hint: provider ? AUTH_HINTS[provider] : undefined,
			cause: err,
		});
	}
	const codes = errorCodes(err);
	if (e.tlsFailed || codes.includes("STARTTLS_INJECTION")) {
		return new IntegrationError("tls_failed", { cause: err, hint: detail(e) ?? undefined });
	}
	if (codes.some((c) => c === "CONNECT_TIMEOUT" || c === "GREETING_TIMEOUT" || c === "UPGRADE_TIMEOUT" || c === "ETIMEOUT")) {
		return new IntegrationError("timeout", { message: "The mail server didn't answer in time.", cause: err });
	}
	if (codes.includes("ETHROTTLE")) {
		return new IntegrationError("rate_limited", { message: "The mail server is throttling this account.", cause: err });
	}
	const net = netErrorCode(err);
	if (net === "dns_failed") return new IntegrationError("dns_failed", { message: "Couldn't find the mail server's address.", cause: err });
	if (net === "cert_invalid") return new IntegrationError("cert_invalid", { cause: err });
	if (net === "tls_failed") return new IntegrationError("tls_failed", { cause: err });
	if (net) return new IntegrationError("imap_unreachable", { cause: err });
	if (codes.includes("NoConnection") || codes.includes("EConnectionClosed")) {
		return new IntegrationError("imap_unreachable", { message: "The mail server closed the connection.", cause: err });
	}
	return new IntegrationError("mailbox_unavailable", { hint: detail(e), cause: err });
}

export function classifySmtpError(err: unknown, provider?: string): IntegrationError {
	if (err instanceof IntegrationError) return err;
	const e = (err ?? {}) as SmtpLike;
	if (e.code === "EAUTH" || e.code === "ENOAUTH" || e.responseCode === 535 || e.responseCode === 534) {
		return new IntegrationError("smtp_auth_failed", {
			hint: provider ? AUTH_HINTS[provider] : undefined,
			cause: err,
		});
	}
	if (e.code === "EREQUIRETLS") return new IntegrationError("tls_required", { cause: err });
	if (e.code === "ETLS") return new IntegrationError("tls_failed", { cause: err });
	if (e.code === "EDNS") return new IntegrationError("dns_failed", { message: "Couldn't find the outgoing server's address.", cause: err });
	const net = netErrorCode(err);
	if (net === "cert_invalid" || net === "tls_failed" || net === "dns_failed") return new IntegrationError(net, { cause: err });
	if (net === "timeout" || e.code === "ETIMEDOUT") {
		return new IntegrationError("timeout", { message: "The outgoing server didn't answer in time.", cause: err });
	}
	if (net || e.code === "ECONNECTION" || e.code === "ESOCKET") return new IntegrationError("smtp_unreachable", { cause: err });
	return new IntegrationError("smtp_unreachable", { hint: detail(e), cause: err });
}
