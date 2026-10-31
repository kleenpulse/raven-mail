import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

/*
 * The desktop app's database: Postgres compiled to wasm (PGlite), stored in
 * RAVEN_PGLITE_DIR. Opening it applies any committed migration it hasn't seen
 * (drizzle tracks them in drizzle.__drizzle_migrations).
 *
 * One PGlite may own a data folder at a time, and Next can load this module
 * more than once (per bundle layer, and again on HMR), so the instance lives
 * on globalThis. The desktop server closes it on shutdown through the
 * "raven.db.close" hook; a killed writer can leave the folder unopenable.
 */

type Local = { client: PGlite; db: PgliteDatabase<typeof schema> };

const OPEN = Symbol.for("raven.pglite");
const CLOSE = Symbol.for("raven.db.close");
const registry = globalThis as { [OPEN]?: Promise<Local>; [CLOSE]?: () => Promise<void> };

export function openLocalDb(): Promise<PgliteDatabase<typeof schema>> {
	registry[OPEN] ??= open().catch((err: unknown) => {
		// Let the next request try again instead of caching the failure.
		delete registry[OPEN];
		throw err;
	});
	return registry[OPEN].then((local) => local.db);
}

export async function closeLocalDb(): Promise<void> {
	const pending = registry[OPEN];
	delete registry[OPEN];
	delete registry[CLOSE];
	const local = await pending?.catch(() => null);
	await local?.client.close();
}

async function open(): Promise<Local> {
	const dir = process.env.RAVEN_PGLITE_DIR?.trim();
	if (!dir) throw new Error("RAVEN_PGLITE_DIR must name the local database folder when RAVEN_DB=pglite.");
	const dataDir = resolve(dir);
	// PGlite creates the folder itself, but not its parents.
	mkdirSync(dirname(dataDir), { recursive: true });
	const client = new PGlite(dataDir);
	try {
		const db = drizzle({ client, schema });
		await migrate(db, { migrationsFolder: migrationsDir() });
		registry[CLOSE] = closeLocalDb;
		return { client, db };
	} catch (err) {
		await client.close().catch(() => {});
		throw err;
	}
}

function migrationsDir(): string {
	return process.env.RAVEN_MIGRATIONS_DIR?.trim() || join(process.cwd(), "lib", "db", "migrations");
}
