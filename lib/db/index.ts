import "server-only";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { IntegrationError } from "@/lib/integrations/errors";
import * as schema from "./schema";

/*
 * Neon over HTTP: every query is one fetch, so there's no pool to manage, no
 * sockets to keep alive across HMR, and it runs the same on Vercel or a plain
 * Node server. Importing this module is side-effect free apart from the fetch
 * timeout below; callers ask for the handle and branch on "not configured".
 */

const QUERY_TIMEOUT_MS = 10_000;

// neonConfig.fetchFunction is process-global; a bounded fetch means a sleeping
// or unreachable database surfaces as "db_unavailable" instead of a hung route.
neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
	const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
	return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

function connect() {
	return drizzle({ client: neon(process.env.DATABASE_URL!.trim()), schema });
}

export type Db = ReturnType<typeof connect>;

let handle: Db | undefined;

/** Whether a connection string is present. Sync, never throws. */
export function dbConfigured(): boolean {
	return Boolean(process.env.DATABASE_URL?.trim());
}

/** The DB handle, or throws `db_not_configured` — routes turn that into a setup callout. */
export function requireDb(): Db {
	if (!dbConfigured()) throw new IntegrationError("db_not_configured");
	handle ??= connect();
	return handle;
}

/** Maps driver failures onto the catalog so the UI can say something useful. */
export function dbError(err: unknown): IntegrationError {
	if (err instanceof IntegrationError) return err;
	const code = findPgCode(err);
	if (code === "42P01") return new IntegrationError("db_not_migrated", { cause: err });
	if (code === "23505") return new IntegrationError("duplicate", { cause: err });
	return new IntegrationError("db_unavailable", { cause: err });
}

/** Runs a DB operation with errors mapped onto the catalog. */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
	const db = requireDb();
	try {
		return await fn(db);
	} catch (err) {
		throw dbError(err);
	}
}

function findPgCode(err: unknown): string | undefined {
	// Drizzle wraps driver errors; the SQLSTATE sits on the error or its cause.
	for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
		if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
	}
	return undefined;
}
