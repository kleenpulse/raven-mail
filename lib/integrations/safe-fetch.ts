import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { isLoopbackHost, isPrivateAddress } from "@/lib/auth/ip";
import { IntegrationError } from "./errors";
import type { HttpResult, Outbound, UrlPolicy } from "./http";
import { netError } from "./net-errors";

const BODY_CAP = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

/** Deployment policy for user-supplied webhook URLs. */
export function outboundPolicy(): UrlPolicy {
	const dev = process.env.NODE_ENV !== "production";
	const optIn = process.env.ALLOW_PRIVATE_WEBHOOK_HOSTS === "true";
	return { allowLoopback: dev, allowPrivate: dev || optIn };
}

function allowed(address: string, policy: UrlPolicy): boolean {
	if (isLoopbackHost(address)) return policy.allowLoopback;
	return !isPrivateAddress(address) || policy.allowPrivate;
}

/**
 * Resolves then vets every address *at connect time* — the socket can only
 * reach what was checked, so DNS rebinding can't swap in 169.254.169.254.
 */
function guardedLookup(policy: UrlPolicy) {
	return (
		hostname: string,
		options: { all?: boolean; family?: number },
		callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
	) => {
		dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
			if (err) return callback(err, "");
			const ok = addresses.filter((a) => allowed(a.address, policy));
			if (ok.length === 0 || ok.length !== addresses.length) {
				return callback(new IntegrationError("private_address"), "");
			}
			if (options.all) return callback(null, ok);
			callback(null, ok[0]!.address, ok[0]!.family);
		});
	};
}

type SafeFetchOptions = { policy?: UrlPolicy; timeoutMs?: number; signal?: AbortSignal };

/**
 * Outbound HTTP for user-supplied URLs: private networks blocked at the socket,
 * a fresh socket per call, no redirects followed, bounded time and body. A
 * timeout after the body fully went out is `unconfirmed` — it may have landed.
 */
export function safeFetch(req: Outbound, opts: SafeFetchOptions = {}): Promise<HttpResult> {
	const policy = opts.policy ?? outboundPolicy();
	const url = req.url;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host) && !allowed(host, policy)) return Promise.reject(new IntegrationError("private_address"));

	const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
	const body = req.body === undefined ? undefined : Buffer.from(req.body, "utf8");
	const client = url.protocol === "https:" ? https : http;
	const started = performance.now();

	return new Promise<HttpResult>((resolve, reject) => {
		let bodySent = false;
		const request = client.request(
			url,
			{
				method: req.method,
				headers: {
					accept: "application/json, text/plain;q=0.9, */*;q=0.5",
					"user-agent": "Raven/1.0",
					...req.headers,
					...(body ? { "content-length": String(body.byteLength) } : {}),
				},
				lookup: guardedLookup(policy) as never,
				agent: false,
				signal,
			},
			(response) => {
				const chunks: Buffer[] = [];
				let size = 0;
				response.on("data", (chunk: Buffer) => {
					if (size >= BODY_CAP) return;
					chunks.push(chunk);
					size += chunk.byteLength;
					if (size >= BODY_CAP) response.destroy();
				});
				const finish = () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: Object.fromEntries(
							Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
						),
						body: Buffer.concat(chunks).subarray(0, BODY_CAP).toString("utf8"),
						ms: Math.round(performance.now() - started),
					});
				response.on("end", finish);
				response.on("close", finish); // capped bodies end via destroy()
				response.on("error", (err) => (size >= BODY_CAP ? finish() : reject(netError(err))));
			},
		);
		request.on("finish", () => {
			bodySent = true;
		});
		request.on("error", (err) => {
			if (err instanceof IntegrationError) return reject(err);
			if (timeout.aborted) {
				return reject(new IntegrationError(bodySent && req.method === "POST" ? "unconfirmed" : "timeout", { cause: err }));
			}
			if (opts.signal?.aborted) return reject(opts.signal.reason ?? err);
			const cause = (err as { cause?: unknown }).cause;
			if (cause instanceof IntegrationError) return reject(cause);
			reject(netError(err));
		});
		if (body) request.write(body);
		request.end();
	});
}
