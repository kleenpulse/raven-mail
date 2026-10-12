import { IntegrationError, type IntegrationErrorCode } from "./errors";

type ErrLike = { code?: unknown; message?: unknown; cause?: unknown; name?: unknown };

const TLS_CERT = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"CERT_UNTRUSTED",
]);

/** Every `code` on the error and its causes (libraries wrap socket errors). */
export function errorCodes(err: unknown): string[] {
	const codes: string[] = [];
	for (let e = err as ErrLike | undefined, i = 0; e && i < 5; e = e.cause as ErrLike | undefined, i++) {
		if (typeof e.code === "string") codes.push(e.code);
	}
	return codes;
}

/** Socket/DNS/TLS failures → catalog code, or null if it isn't a network error. */
export function netErrorCode(err: unknown): IntegrationErrorCode | null {
	for (const code of errorCodes(err)) {
		if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME") return "dns_failed";
		if (code === "ECONNREFUSED") return "connect_refused";
		if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "timeout";
		if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ECONNRESET" || code === "EPIPE") return "network";
		if (TLS_CERT.has(code)) return "cert_invalid";
		if (code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_") || code === "EPROTO") return "tls_failed";
	}
	const name = (err as ErrLike | undefined)?.name;
	if (name === "TimeoutError") return "timeout";
	return null;
}

export function netError(err: unknown, fallback: IntegrationErrorCode = "network"): IntegrationError {
	if (err instanceof IntegrationError) return err;
	return new IntegrationError(netErrorCode(err) ?? fallback, { cause: err });
}
