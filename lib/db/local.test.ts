import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { closeLocalDb, openLocalDb } from "@/lib/db/local";
import { tourProgress } from "@/lib/db/schema";

// The desktop app's local Postgres, on disk, with the committed migrations.

const MIGRATIONS = path.resolve(import.meta.dir, "migrations");
const JOURNAL = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
const TABLES = ["blocked_senders", "follow_ups", "integration_events", "integrations", "mail_rules", "rule_events", "tour_progress"];

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "raven-pglite-"));
	process.env.RAVEN_PGLITE_DIR = path.join(tmp, "data", "db");
	process.env.RAVEN_MIGRATIONS_DIR = MIGRATIONS;
});

afterEach(async () => {
	await closeLocalDb();
	delete process.env.RAVEN_PGLITE_DIR;
	delete process.env.RAVEN_MIGRATIONS_DIR;
	rmSync(tmp, { recursive: true, force: true });
});

type LocalDb = Awaited<ReturnType<typeof openLocalDb>>;

async function applied(db: LocalDb): Promise<number> {
	const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
	return result.rows[0]!.n;
}

async function tables(db: LocalDb): Promise<string[]> {
	const result = await db.execute<{ name: string }>(sql`select table_name as name from information_schema.tables where table_schema = 'public' order by 1`);
	return result.rows.map((r) => r.name);
}

const row = { accountKey: "acct", lastStep: 3, updatedAt: new Date("2026-10-30T12:00:00Z") };

describe("local database", () => {
	test("a fresh folder gets every migration, tracked", async () => {
		const db = await openLocalDb();
		expect(await applied(db)).toBe(JOURNAL.entries.length);
		expect(await tables(db)).toEqual(TABLES);
	}, 60_000);

	test("rows survive a restart and nothing is applied twice", async () => {
		await (await openLocalDb()).insert(tourProgress).values(row);
		await closeLocalDb();

		const db = await openLocalDb();
		expect(await applied(db)).toBe(JOURNAL.entries.length);
		expect(await db.select().from(tourProgress)).toEqual([expect.objectContaining({ accountKey: "acct", lastStep: 3 })]);
	}, 60_000);

	test("a later release applies only its new migration", async () => {
		const migrations = path.join(tmp, "migrations");
		cpSync(MIGRATIONS, migrations, { recursive: true });
		const journalFile = path.join(migrations, "meta", "_journal.json");
		const full = readFileSync(journalFile, "utf8");
		const older = JSON.parse(full) as { entries: unknown[] };
		older.entries = older.entries.slice(0, -1);
		writeFileSync(journalFile, JSON.stringify(older));
		process.env.RAVEN_MIGRATIONS_DIR = migrations;

		const before = await openLocalDb();
		expect(await applied(before)).toBe(JOURNAL.entries.length - 1);
		expect(await tables(before)).not.toContain("rule_events");
		await before.insert(tourProgress).values(row);
		await closeLocalDb();

		writeFileSync(journalFile, full);
		const after = await openLocalDb();
		expect(await applied(after)).toBe(JOURNAL.entries.length);
		expect(await tables(after)).toContain("rule_events");
		expect(await after.select().from(tourProgress)).toHaveLength(1);
	}, 60_000);

	test("concurrent opens share one instance", async () => {
		const [a, b] = await Promise.all([openLocalDb(), openLocalDb()]);
		expect(a).toBe(b);
	}, 60_000);

	test("a missing folder setting is a clear error, and the next open can still succeed", async () => {
		const dir = process.env.RAVEN_PGLITE_DIR;
		delete process.env.RAVEN_PGLITE_DIR;
		const err = await openLocalDb().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toContain("RAVEN_PGLITE_DIR");

		process.env.RAVEN_PGLITE_DIR = dir;
		expect(await applied(await openLocalDb())).toBe(JOURNAL.entries.length);
	}, 60_000);
});
