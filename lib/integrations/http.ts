import { isLoopbackHost, isPrivateAddress } from "@/lib/auth/ip";
import { IntegrationError } from "./errors";

/** What an outbound call returned (body capped by safe-fetch). */
export type HttpResult = { status: number; headers: Record<string, string>; body: string; ms: number };

export type Outbound = {
	method: "GET" | "POST";
	url: URL;
	headers?: Record<string, string>;
	body?: string;
};

/**
 * Which URLs a deployment accepts. Production: public https only. Development:
 * loopback http is allowed so local mock receivers can stand in for Slack/Discord.
 */
export type UrlPolicy = { allowLoopback: boolean; allowPrivate: boolean };

export function parseHttpUrl(raw: string, policy: UrlPolicy): URL {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new IntegrationError("invalid_url");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new IntegrationError("invalid_url");

	const host = url.hostname.replace(/^\[|\]$/g, "");
	const loopback = isLoopbackHost(host);
	if (loopback && !policy.allowLoopback) throw new IntegrationError("private_address");
	if (!loopback && isPrivateAddress(host) && !policy.allowPrivate) throw new IntegrationError("private_address");

	const plainOk = (loopback && policy.allowLoopback) || policy.allowPrivate;
	if (url.protocol === "http:" && !plainOk) throw new IntegrationError("insecure_url");

	url.hash = "";
	return url;
}

export function isLocalMock(url: URL, policy: UrlPolicy): boolean {
	return policy.allowLoopback && isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ""));
}

export function json(body: unknown): { headers: Record<string, string>; body: string } {
	return { headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
	const at = Date.parse(value);
	return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Status-code fallback shared by every provider once its own error vocabulary is exhausted. */
export function judgeByStatus(res: HttpResult, now = Date.now()): IntegrationError | null {
	const { status } = res;
	if (status >= 200 && status < 300) return null;
	if (status >= 300 && status < 400) return new IntegrationError("redirect_blocked");
	if (status === 408) return new IntegrationError("timeout");
	if (status === 429) {
		return new IntegrationError("rate_limited", { retryAfterMs: parseRetryAfter(res.headers["retry-after"], now) });
	}
	if (status === 401 || status === 403) return new IntegrationError("forbidden");
	if (status === 404 || status === 410) return new IntegrationError("revoked");
	if (status === 400 || status === 413 || status === 415 || status === 422) {
		return new IntegrationError("payload_rejected");
	}
	if (status >= 500) return new IntegrationError("upstream_error", { message: `The service answered ${status}.` });
	return new IntegrationError("unexpected_response", { message: `The service answered ${status}.` });
}

export function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** First path segments only, secrets masked: `hooks.zapier.com/hooks/catch/••••`. */
export function maskUrl(url: URL, keepSegments = 2): string {
	const segments = url.pathname.split("/").filter(Boolean);
	const shown = segments.slice(0, keepSegments).join("/");
	const masked = segments.length > keepSegments ? "/••••" : "";
	return `${url.host}${shown ? `/${shown}` : ""}${masked}`;
}
