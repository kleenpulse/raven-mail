import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { Db } from "@/lib/db";
import type * as schema from "@/lib/db/schema";
import { tourProgress } from "@/lib/db/schema";

// Neon is never reached: its drizzle() is swapped for a stand-in that records batches.
const batches: unknown[][] = [];
mock.module("drizzle-orm/neon-http", () => ({
	drizzle: () => ({
		batch: async (items: unknown[]) => {
			batches.push(items);
			return [];
		},
		insert: () => ({ values: () => ({ kind: "insert" }) }),
	}),
}));

const { dbConfigured, withDb, withDbAtomic } = await import("@/lib/db");
const { closeLocalDb } = await import("@/lib/db/local");

// Compile-time: both drivers fit the shared type.
type Fits<T extends Db> = T;
export type NeonFits = Fits<NeonHttpDatabase<typeof schema>>;
export type PgliteFits = Fits<PgliteDatabase<typeof schema>>;

const KEYS = ["RAVEN_DESKTOP_BUILD", "RAVEN_DB", "DATABASE_URL"] as const;
let tmp: string;

beforeAll(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "raven-db-"));
	process.env.RAVEN_PGLITE_DIR = path.join(tmp, "db");
	process.env.RAVEN_MIGRATIONS_DIR = path.resolve(import.meta.dir, "migrations");
});

afterEach(() => {
	for (const key of KEYS) delete process.env[key];
});

afterAll(async () => {
	await closeLocalDb();
	delete process.env.RAVEN_PGLITE_DIR;
	delete process.env.RAVEN_MIGRATIONS_DIR;
	rmSync(tmp, { recursive: true, force: true });
});

function local() {
	process.env.RAVEN_DESKTOP_BUILD = "1";
	process.env.RAVEN_DB = "pglite";
}

const row = (accountKey: string) => ({ accountKey, updatedAt: new Date("2026-10-30T12:00:00Z") });

describe("dbConfigured", () => {
	test("web: only a DATABASE_URL counts", () => {
		expect(dbConfigured()).toBe(false);
		process.env.DATABASE_URL = "  ";
		expect(dbConfigured()).toBe(false);
		process.env.DATABASE_URL = "postgres://x";
		expect(dbConfigured()).toBe(true);
	});

	test("desktop builds count the local database", () => {
		local();
		expect(dbConfigured()).toBe(true);
	});

	test("RAVEN_DB=pglite is ignored outside desktop builds", async () => {
		process.env.RAVEN_DB = "pglite";
		expect(dbConfigured()).toBe(false);
		const err = await withDb(async () => 1).catch((e: unknown) => e);
		expect(err).toMatchObject({ code: "db_not_configured" });
	});
});

describe("local database through withDb", () => {
	test("runs queries, and wins over DATABASE_URL", async () => {
		local();
		process.env.DATABASE_URL = "postgres://never-used";
		await withDb((db) => db.insert(tourProgress).values(row("a")));
		expect(await withDb((db) => db.select().from(tourProgress).where(eq(tourProgress.accountKey, "a")))).toHaveLength(1);
		expect(batches).toHaveLength(0);
	}, 60_000);

	test("withDbAtomic commits all statements together", async () => {
		local();
		await withDbAtomic((q) => [q.insert(tourProgress).values(row("b1")), q.insert(tourProgress).values(row("b2"))]);
		expect(await withDb((db) => db.select().from(tourProgress))).toEqual(
			expect.arrayContaining([expect.objectContaining({ accountKey: "b1" }), expect.objectContaining({ accountKey: "b2" })]),
		);
	}, 60_000);

	test("withDbAtomic rolls back when a later statement fails", async () => {
		local();
		const err = await withDbAtomic((q) => [q.insert(tourProgress).values(row("c")), q.insert(tourProgress).values(row("a"))]).catch((e: unknown) => e);
		expect(err).toMatchObject({ code: "duplicate" });
		expect(await withDb((db) => db.select().from(tourProgress).where(eq(tourProgress.accountKey, "c")))).toHaveLength(0);
	}, 60_000);
});

describe("Neon through withDbAtomic", () => {
	test("sends every statement in one batch", async () => {
		process.env.DATABASE_URL = "postgres://user:pass@example.neon.tech/db";
		await withDbAtomic((q) => [q.insert(tourProgress).values(row("n1")), q.insert(tourProgress).values(row("n2"))]);
		expect(batches).toEqual([[{ kind: "insert" }, { kind: "insert" }]]);
	});
});
