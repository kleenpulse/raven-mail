import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// recordEvent's real SQL (insert + prune, in one transaction) on the desktop's local database.

let tmp: string;

beforeAll(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "raven-events-"));
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

describe("recordEvent", () => {
	test("keeps the newest 500 per account and leaves other accounts alone", async () => {
		const { listEvents, recordEvent } = await import("@/lib/integrations/repo");
		const event = (accountKey: string, n: number) =>
			({ accountKey, target: "webhook", action: "test", outcome: "ok", summary: `event ${n}` }) as const;

		await recordEvent(event("other", 0));
		for (let n = 1; n <= 505; n++) await recordEvent(event("acct", n));

		const kept: string[] = [];
		let cursor: number | undefined;
		do {
			const page = await listEvents("acct", { cursor, limit: 100 });
			kept.push(...page.events.map((e) => e.summary));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);

		expect(kept).toHaveLength(500);
		expect(kept[0]).toBe("event 505");
		expect(kept.at(-1)).toBe("event 6");
		expect((await listEvents("other", {})).events.map((e) => e.summary)).toEqual(["event 0"]);
	}, 120_000);
});
