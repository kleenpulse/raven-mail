import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeSession } from "@/test/helpers/session";
import type { BoardDoc } from "./types";

// The real SQL (a guarded multi-row upsert, then a read) on the desktop's local database.

let tmp: string;

beforeAll(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "raven-board-"));
	process.env.RAVEN_DESKTOP_BUILD = "1";
	process.env.RAVEN_DB = "pglite";
	process.env.RAVEN_PGLITE_DIR = path.join(tmp, "db");
	process.env.RAVEN_MIGRATIONS_DIR = path.resolve(import.meta.dir, "../db/migrations");
});

afterAll(async () => {
	const { closeLocalDb } = await import("@/lib/db/local");
	await closeLocalDb();
	for (const key of ["RAVEN_DESKTOP_BUILD", "RAVEN_DB", "RAVEN_PGLITE_DIR", "RAVEN_MIGRATIONS_DIR"]) delete process.env[key];
	rmSync(tmp, { recursive: true, force: true });
});

const T1 = "2026-11-18T10:00:00.000Z";
const T2 = "2026-11-18T10:05:00.000Z";
const T3 = "2026-11-18T10:10:00.000Z";

const cell = (i: string, x = 0, y = 0) => ({ i, x, y, w: 4, h: 8 });

describe("overview board service", () => {
	test("a mailbox with no saved board reads as an empty record", async () => {
		const { getBoard } = await import("./service");
		expect(await getBoard(makeSession())).toEqual({});
	}, 60_000);

	test("what is saved is what is read back, part by part", async () => {
		const { getBoard, saveBoard } = await import("./service");
		const session = makeSession();
		const doc: BoardDoc = {
			lg: { items: [cell("orbit"), cell("volume", 4)], updatedAt: T1 },
			sm: { items: null, updatedAt: T2 },
			widgets: { on: ["orbit", "volume"], known: ["orbit", "volume", "streak"], updatedAt: T1 },
		};
		expect(await saveBoard(session, doc)).toEqual(doc);
		expect(await getBoard(session)).toEqual(doc);
	}, 60_000);

	test("an older write never replaces a newer one, and the caller is told what stands", async () => {
		const { getBoard, saveBoard } = await import("./service");
		const session = makeSession();
		const newer: BoardDoc = { lg: { items: [cell("orbit")], updatedAt: T2 } };
		await saveBoard(session, newer);
		expect(await saveBoard(session, { lg: { items: [cell("volume")], updatedAt: T1 } })).toEqual(newer);
		expect(await getBoard(session)).toEqual(newer);
	}, 60_000);

	test("parts win and lose on their own in one save", async () => {
		const { saveBoard } = await import("./service");
		const session = makeSession();
		await saveBoard(session, {
			lg: { items: [cell("orbit")], updatedAt: T2 },
			widgets: { on: ["orbit"], known: ["orbit"], updatedAt: T1 },
		});
		// A phone that was offline: its layout is older, its card list is newer.
		const stored = await saveBoard(session, {
			lg: { items: [cell("volume")], updatedAt: T1 },
			widgets: { on: [], known: ["orbit"], updatedAt: T3 },
		});
		expect(stored).toEqual({
			lg: { items: [cell("orbit")], updatedAt: T2 },
			widgets: { on: [], known: ["orbit"], updatedAt: T3 },
		});
	}, 60_000);

	test("a save returns the parts it did not send too", async () => {
		const { saveBoard } = await import("./service");
		const session = makeSession();
		await saveBoard(session, { md: { items: [cell("streak")], updatedAt: T1 } });
		const stored = await saveBoard(session, { sm: { items: [cell("orbit")], updatedAt: T2 } });
		expect(Object.keys(stored).sort()).toEqual(["md", "sm"]);
	}, 60_000);

	test("a stamp from a clock far ahead is pinned near now", async () => {
		const { saveBoard } = await import("./service");
		const session = makeSession();
		const before = Date.now();
		const stored = await saveBoard(session, { lg: { items: null, updatedAt: "2099-01-01T00:00:00.000Z" } });
		const at = Date.parse(stored.lg?.updatedAt ?? "");
		expect(at).toBeGreaterThanOrEqual(before);
		expect(at).toBeLessThanOrEqual(Date.now() + 60_000);
	}, 60_000);

	test("the change time lives in its column, not in the stored data", async () => {
		const { saveBoard } = await import("./service");
		const { withDb } = await import("@/lib/db");
		const { overviewBoard } = await import("@/lib/db/schema");
		const { tenantKey } = await import("@/lib/integrations/crypto");
		const session = makeSession();
		await saveBoard(session, { widgets: { on: null, known: ["orbit"], updatedAt: T1 } });
		const rows = await withDb((db) => db.select().from(overviewBoard).where(eq(overviewBoard.accountKey, tenantKey(session))));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.data).toEqual({ on: null, known: ["orbit"] });
		expect(rows[0]?.updatedAt.toISOString()).toBe(T1);
	}, 60_000);

	test("one mailbox never reads another's board, and a row this release cannot read is left out", async () => {
		const { getBoard, saveBoard } = await import("./service");
		const { withDb } = await import("@/lib/db");
		const { overviewBoard } = await import("@/lib/db/schema");
		const { tenantKey } = await import("@/lib/integrations/crypto");
		const mine = makeSession();
		const theirs = makeSession();
		await saveBoard(mine, { lg: { items: [cell("orbit")], updatedAt: T1 } });
		await saveBoard(theirs, { lg: { items: [cell("volume")], updatedAt: T1 } });
		// As a later release might write it: a shape this one does not know.
		await withDb((db) =>
			db.insert(overviewBoard).values({ accountKey: tenantKey(mine), part: "md", data: { cells: [] } as never, updatedAt: new Date(T1) }),
		);
		expect(await getBoard(mine)).toEqual({ lg: { items: [cell("orbit")], updatedAt: T1 } });
		expect(await getBoard(theirs)).toEqual({ lg: { items: [cell("volume")], updatedAt: T1 } });
	}, 60_000);
});
