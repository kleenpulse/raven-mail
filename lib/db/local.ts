import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 *
 * Before applying a new migration to an existing database it saves a copy
 * (see backUpBeforeMigrating). RAVEN_PGLITE_RESTORE names a copy to start an
 * empty folder from; the desktop app sets it when the user picks "Restore".
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
	const existed = existsSync(join(dataDir, "PG_VERSION"));
	const restore = process.env.RAVEN_PGLITE_RESTORE?.trim();
	const client =
		!existed && restore
			? new PGlite(dataDir, { loadDataDir: new Blob([readFileSync(restore)], { type: "application/x-gzip" }) })
			: new PGlite(dataDir);
	try {
		const db = drizzle({ client, schema });
		const migrationsFolder = migrationsDir();
		if (existed) await backUpBeforeMigrating(client, dataDir, migrationsFolder);
		await migrate(db, { migrationsFolder });
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

/** Backups made before migrations: `<data folder>.backups/before-<migration>-<time>.tar.gz`. */
export function backupsDir(dataDir: string): string {
	return `${dataDir}.backups`;
}

const KEEP_BACKUPS = 3;

/**
 * Saves a copy of the database before a new migration changes it, so a
 * migration that goes wrong can be undone (the desktop app offers to
 * restore it). Pending means what drizzle's migrator will apply: journal
 * entries newer than the last applied one. Keeps the newest three.
 */
async function backUpBeforeMigrating(client: PGlite, dataDir: string, migrationsFolder: string): Promise<void> {
	const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
		entries: { when: number; tag: string }[];
	};
	const last = await client
		.query<{ at: string | number | null }>("select max(created_at) as at from drizzle.__drizzle_migrations")
		.catch(() => null);
	// No migrations table yet: nothing has been stored, so there's nothing to keep.
	if (!last) return;
	const lastAt = Number(last.rows[0]?.at ?? 0);
	const pending = journal.entries.filter((entry) => entry.when > lastAt);
	if (pending.length === 0) return;

	const dump = await client.dumpDataDir("gzip");
	const dir = backupsDir(dataDir);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `before-${pending[0]!.tag}-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`);
	writeFileSync(`${file}.tmp`, Buffer.from(await dump.arrayBuffer()));
	renameSync(`${file}.tmp`, file);

	const old = readdirSync(dir)
		.filter((name) => /^before-.+\.tar\.gz$/.test(name))
		.map((name) => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
		.sort((a, b) => b.at - a.at)
		.slice(KEEP_BACKUPS);
	for (const backup of old) rmSync(backup.path, { force: true });
}
