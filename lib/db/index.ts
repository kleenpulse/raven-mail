import "server-only";
import { neon, neonConfig } from "@neondatabase/serverless";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { IntegrationError } from "@/lib/integrations/errors";
import * as schema from "./schema";

/*
 * Neon over HTTP: every query is one fetch, so there's no pool to manage, no
 * sockets to keep alive across HMR, and it runs the same on Vercel or a plain
 * Node server. Importing this module is side-effect free apart from the fetch
 * timeout below; callers ask for the handle and branch on "not configured".
 *
 * The desktop app instead keeps a local Postgres (PGlite) under its data
 * folder. Only desktop builds contain it: RAVEN_DESKTOP_BUILD is inlined at
 * build time, so the web build drops that branch and never bundles PGlite.
 */

const QUERY_TIMEOUT_MS = 10_000;

// neonConfig.fetchFunction is process-global; a bounded fetch means a sleeping
// or unreachable database surfaces as "db_unavailable" instead of a hung route.
neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
	const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
	return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

/** Any Drizzle Postgres database with Raven's schema: Neon over HTTP, or the desktop's PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type NeonDb = NeonHttpDatabase<typeof schema>;

type Handle = { kind: "neon"; db: NeonDb } | { kind: "local"; db: Db };

let neonDb: NeonDb | undefined;

function connectNeon(): NeonDb {
	return drizzle({ client: neon(process.env.DATABASE_URL!.trim()), schema });
}

/** The desktop app's local database is on (desktop builds only). */
function localEnabled(): boolean {
	return Boolean(process.env.RAVEN_DESKTOP_BUILD) && process.env.RAVEN_DB === "pglite";
}

/** Whether a database is available. Sync, never throws. */
export function dbConfigured(): boolean {
	return localEnabled() || Boolean(process.env.DATABASE_URL?.trim());
}

async function handle(): Promise<Handle> {
	// Spelled out (not localEnabled()) so the inlined flag folds this branch away in web builds.
	if (process.env.RAVEN_DESKTOP_BUILD && process.env.RAVEN_DB === "pglite") {
		const { openLocalDb } = await import("./local");
		try {
			return { kind: "local", db: await openLocalDb() };
		} catch (err) {
			throw dbError(err);
		}
	}
	if (!process.env.DATABASE_URL?.trim()) throw new IntegrationError("db_not_configured");
	neonDb ??= connectNeon();
	return { kind: "neon", db: neonDb };
}

const LOCAL_HINT = "Raven's local database didn't open. Restart Raven. If it keeps happening, check the logs in Raven's data folder.";

/** Maps driver failures onto the catalog so the UI can say something useful. */
export function dbError(err: unknown): IntegrationError {
	if (err instanceof IntegrationError) return err;
	const code = findPgCode(err);
	if (code === "23505") return new IntegrationError("duplicate", { cause: err });
	const hint = localEnabled() ? LOCAL_HINT : undefined;
	if (code === "42P01") return new IntegrationError("db_not_migrated", { cause: err, hint });
	return new IntegrationError("db_unavailable", { cause: err, hint });
}

/** Runs a DB operation with errors mapped onto the catalog. */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
	const { db } = await handle();
	try {
		return await fn(db);
	} catch (err) {
		throw dbError(err);
	}
}

type Step = BatchItem<"pg"> & PromiseLike<unknown>;

/**
 * Runs statements together: one round trip on Neon (HTTP batch), one
 * transaction on the local database. Build every statement on the `q` you're
 * given; statements built on another handle would wait forever on PGlite's
 * transaction lock.
 */
export async function withDbAtomic(build: (q: Db) => readonly [Step, ...Step[]]): Promise<void> {
	const h = await handle();
	try {
		if (h.kind === "neon") {
			await h.db.batch(build(h.db));
		} else {
			await h.db.transaction(async (tx) => {
				for (const step of build(tx)) await step;
			});
		}
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
