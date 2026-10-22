/*
 * One catalog for every way an integration can fail. Each code carries the copy
 * the UI shows, whether trying again can help, and whether the connection needs
 * the user's hands (status → "error", card glows until reconnected).
 */

type Copy = { title: string; hint: string; retryable: boolean; attention: boolean };

const copy = (title: string, hint: string, retryable = false, attention = false): Copy => ({
	title,
	hint,
	retryable,
	attention,
});

export const ERROR_COPY = {
	/* Input */
	invalid_request: copy("That request isn't valid.", "Reload the page and try again."),
	invalid_url: copy("That doesn't look like a webhook URL.", "Copy the full URL, starting with https://."),
	insecure_url: copy("Webhooks must use https.", "Plain http would send your email details unencrypted."),
	wrong_provider_url: copy("That URL belongs to a different service.", "Connect it from the matching card instead."),
	private_address: copy(
		"That address points inside a private network.",
		"Raven only delivers to public internet hosts.",
	),
	duplicate: copy("This webhook is already connected.", "Open the existing connection to test or rename it."),
	limit_reached: copy("You've reached 10 connections.", "Disconnect one you no longer use first."),
	not_found: copy("That connection no longer exists.", "It may have been removed in another tab."),
	paused: copy("This connection is paused.", "Resume it to send again."),
	secret_unreadable: copy(
		"Raven can't unlock this connection's saved URL.",
		"The server secret changed. Reconnect with the webhook URL.",
		false,
		true,
	),

	/* Network */
	dns_failed: copy("Couldn't find that host.", "Check the URL for typos.", true),
	connect_refused: copy("The server refused the connection.", "The service may be down, or the port is closed.", true),
	timeout: copy("The server took too long to answer.", "It may be overloaded. Try again in a moment.", true),
	tls_failed: copy("Couldn't open a secure connection.", "The server's TLS setup rejected Raven.", true),
	cert_invalid: copy("The server's certificate isn't trusted.", "It may be expired or self-signed."),
	redirect_blocked: copy(
		"The URL redirects somewhere else.",
		"Raven doesn't follow redirects. Paste the final URL.",
		false,
		true,
	),
	network: copy("The connection dropped.", "Check your network and try again.", true),

	/* Provider answers */
	revoked: copy(
		"This webhook no longer exists.",
		"It was deleted or its app was removed. Create a new one and reconnect.",
		false,
		true,
	),
	archived: copy("That channel was archived.", "Unarchive it, or connect a webhook for another channel.", false, true),
	forbidden: copy("The service refused the message.", "The webhook isn't allowed to post there anymore.", false, true),
	rate_limited: copy("Sending too fast for the service.", "Wait a few seconds and try again.", true),
	payload_rejected: copy(
		"The service rejected Raven's message.",
		"This is on Raven's side. Try again, and report it if it keeps happening.",
	),
	upstream_error: copy("The service had an internal error.", "It's on their side. Try again shortly.", true),
	unexpected_response: copy("The service answered in an unexpected way.", "Check the URL still points at a webhook.", true),
	unconfirmed: copy(
		"Sent, but the service never confirmed it.",
		"It may have posted anyway. Check the channel before sending again.",
		true,
	),

	/* Mail account */
	imap_auth_failed: copy(
		"The mail server rejected the password.",
		"Many providers need an app password. Sign out and in again with one.",
		false,
		true,
	),
	smtp_auth_failed: copy(
		"The outgoing server rejected the password.",
		"Sending uses the same credentials. Check SMTP is enabled for this account.",
		false,
		true,
	),
	imap_unreachable: copy("Couldn't reach the mail server.", "Check the host and port, or your network.", true),
	smtp_unreachable: copy("Couldn't reach the outgoing server.", "Check the SMTP host and port.", true),
	tls_required: copy("The server needs a secure connection first.", "Use the provider preset, or port 993 / 465.", false, true),
	mailbox_unavailable: copy("Signed in, but the mailbox didn't answer.", "The server may be busy. Try again.", true),

	/* Jev */
	jev_no_key: copy(
		"Jev isn't configured.",
		"Add your TypeSafe key in Settings → Account, or set TYPESAFE_API_KEY on the server. Raven runs on free local heuristics until then.",
	),
	jev_key_rejected: copy(
		"TypeSafe rejected the API key.",
		"Create a new key at console.typesafe.ai, then save it in Settings → Account (or update TYPESAFE_API_KEY on the server).",
		false,
		true,
	),
	jev_model_missing: copy(
		"The pinned Jev model isn't available.",
		"Unset TYPESAFE_DEFAULT_MODEL or pin a model your key can use.",
		false,
		true,
	),
	jev_rate_limited: copy("Jev is rate limiting this key.", "Wait a minute and try again.", true),
	jev_timeout: copy("Jev took too long to answer.", "Try again. Heuristics keep working meanwhile.", true),
	jev_unreachable: copy("Couldn't reach Jev.", "Check the server's network. Heuristics keep working meanwhile.", true),

	/* Platform */
	db_not_configured: copy(
		"Integrations need a database.",
		"Set DATABASE_URL (Neon) in your environment, then run bun run db:migrate.",
	),
	store_needs_db: copy(
		"Rules, blocked senders and reminders need a database.",
		"Set DATABASE_URL, then run bun run db:migrate.",
	),
	db_not_migrated: copy("The database isn't set up yet.", "Run bun run db:migrate, then reload."),
	db_unavailable: copy("Couldn't reach the database.", "It may be waking up. Try again in a few seconds.", true),
	too_many_requests: copy("Slow down a little.", "Too many attempts in a minute. Try again shortly.", true),
	export_running: copy("An export is already running.", "Wait for it to finish, or cancel it first."),
	folder_missing: copy("That folder doesn't exist anymore.", "Pick another folder."),
	export_changed: copy(
		"The folder changed on the server mid-export.",
		"Its message IDs were reset (UIDVALIDITY). Keep what's saved, then start a fresh export.",
	),
	export_too_large: copy("That's too much for one export.", "Pick a shorter date range."),
	export_failed: copy("The export stopped early.", "Everything saved so far is intact. Retry to pick up where it stopped.", true),
	internal: copy("Something went wrong on Raven's side.", "Try again. If it keeps happening, check the server logs."),
} satisfies Record<string, Copy>;

export type IntegrationErrorCode = keyof typeof ERROR_COPY;

export function isErrorCode(code: string): code is IntegrationErrorCode {
	return Object.hasOwn(ERROR_COPY, code);
}

type ErrorOptions = {
	/** Overrides the catalog title (e.g. provider wording). */
	message?: string;
	/** Overrides the catalog hint (e.g. provider-specific fix). */
	hint?: string;
	/** HTTP status the route should answer with (defaults per code family). */
	status?: number;
	/** Upstream asked us to wait this long before retrying. */
	retryAfterMs?: number;
	cause?: unknown;
};

export class IntegrationError extends Error {
	readonly code: IntegrationErrorCode;
	readonly hint: string;
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(code: IntegrationErrorCode, opts: ErrorOptions = {}) {
		super(opts.message ?? ERROR_COPY[code].title, { cause: opts.cause });
		this.name = "IntegrationError";
		this.code = code;
		this.hint = opts.hint ?? ERROR_COPY[code].hint;
		this.status = opts.status ?? defaultStatus(code);
		this.retryAfterMs = opts.retryAfterMs;
	}

	get retryable(): boolean {
		return ERROR_COPY[this.code].retryable;
	}

	/** The connection can't recover without the user (reconnect, re-auth…). */
	get attention(): boolean {
		return ERROR_COPY[this.code].attention;
	}
}

function defaultStatus(code: IntegrationErrorCode): number {
	switch (code) {
		case "invalid_request":
		case "invalid_url":
		case "insecure_url":
		case "wrong_provider_url":
		case "private_address":
			return 400;
		case "not_found":
		case "folder_missing":
			return 404;
		case "export_changed":
			return 409;
		case "export_too_large":
			return 413;
		case "duplicate":
		case "limit_reached":
		case "paused":
		case "export_running":
		case "jev_no_key":
			return 409;
		case "too_many_requests":
			return 429;
		case "db_not_configured":
		case "store_needs_db":
		case "db_not_migrated":
		case "db_unavailable":
			return 503;
		case "internal":
			return 500;
		default:
			return 502;
	}
}

export function toIntegrationError(err: unknown): IntegrationError {
	if (err instanceof IntegrationError) return err;
	return new IntegrationError("internal", { cause: err });
}

/** The shape every failure takes on the wire (NDJSON error events, action results). */
export function describe(err: IntegrationError) {
	return {
		code: err.code,
		message: err.message,
		hint: err.hint,
		retryable: err.retryable,
		...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
	};
}
