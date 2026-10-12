import { readNdjson } from "@/lib/ndjson-client";
import type { MailSession } from "@/lib/session";
import { cookieState } from "../state";
import { makeSession, sessionCookie } from "./session";

export const ORIGIN = "http://localhost:3000";

type ReqOptions = {
	method?: string;
	json?: unknown;
	body?: BodyInit;
	headers?: Record<string, string>;
	/** Default: a fresh dev session. `null` sends no cookie. */
	session?: MailSession | null;
	/** Default: same-origin on non-GET. `null` omits the header. */
	origin?: string | null;
};

export function req(pathname: string, opts: ReqOptions = {}): Request {
	const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? "POST" : "GET");
	const headers = new Headers({ host: "localhost:3000", ...opts.headers });
	const session = opts.session === undefined ? makeSession() : opts.session;
	if (session) headers.set("cookie", sessionCookie(session));
	const origin = opts.origin === undefined ? (method === "GET" ? null : ORIGIN) : opts.origin;
	if (origin) headers.set("origin", origin);
	let body = opts.body;
	if (opts.json !== undefined) {
		body = JSON.stringify(opts.json);
		if (!headers.has("content-type")) headers.set("content-type", "application/json");
	}
	return new Request(`${ORIGIN}${pathname}`, { method, headers, body });
}

/** Invoke a route handler the way Next does: cookies become ambient via `next/headers`. */
export async function call(handler: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
	cookieState.clear();
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const eq = part.indexOf("=");
		if (eq > 0) cookieState.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
	}
	return handler(request);
}

export async function readJson<T = { ok: boolean; data?: unknown; error?: string; code?: string }>(res: Response): Promise<NoInfer<T>> {
	return (await res.json()) as T;
}

export async function readNdjsonAll<T = { type?: string; stage?: string }>(res: Response): Promise<T[]> {
	const events: T[] = [];
	if (res.body) await readNdjson<T>(res.body, (e) => events.push(e));
	return events;
}
