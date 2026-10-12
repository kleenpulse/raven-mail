import "server-only";
import type { z } from "zod";
import { getSession, type MailSession } from "@/lib/session";

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code = "error",
	) {
		super(message);
	}
}

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
	return Response.json(data, { ...init, headers });
}

export async function requireApiSession(): Promise<MailSession> {
	const session = await getSession();
	if (!session) throw new HttpError(401, "Not signed in.", "unauthorized");
	return session;
}

/**
 * Server Actions get an Origin check from Next; Route Handlers don't.
 * Browsers always send Origin on cross-site POSTs, so a mismatch = CSRF attempt.
 */
export function assertSameOrigin(request: Request): void {
	const origin = request.headers.get("origin");
	if (!origin) return;
	const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		throw new HttpError(403, "Bad origin.", "forbidden");
	}
	if (!host || originHost !== host) throw new HttpError(403, "Cross-origin request blocked.", "forbidden");
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	const type = request.headers.get("content-type") ?? "";
	if (!type.toLowerCase().includes("application/json")) {
		throw new HttpError(415, "Expected application/json.", "unsupported_media_type");
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new HttpError(400, "Malformed JSON.", "bad_request");
	}
	return parseWith(schema, body);
}

export function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	if (!parsed.success) {
		throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.", "bad_request");
	}
	return parsed.data;
}

type Handler = (request: Request) => Promise<Response>;

/** Wraps a handler: CSRF guard on mutations, typed HttpErrors, no leaked internals. */
export function route(
	handler: Handler,
	{ fallback = "Something went wrong talking to the mail server." }: { fallback?: string } = {},
): Handler {
	return async (request) => {
		try {
			if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
			return await handler(request);
		} catch (err) {
			if (err instanceof HttpError) {
				return json({ ok: false, error: err.message, code: err.code }, { status: err.status });
			}
			console.error("[api]", err);
			return json({ ok: false, error: fallback, code: "internal" }, { status: 500 });
		}
	};
}
