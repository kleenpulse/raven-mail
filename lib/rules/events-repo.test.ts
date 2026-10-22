import { beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { RULE_LIMIT, RUN_RECENT, type RuleAction } from "@/lib/rules/types";

// The real SQL of events-repo, on an in-process Postgres with the committed migrations.

const pg = new PGlite();
const db = drizzle({ client: pg, schema });
const migrations = path.resolve(import.meta.dir, "../db/migrations");
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
	await pg.exec(readFileSync(path.join(migrations, file), "utf8"));
}
mock.module(path.resolve(import.meta.dir, "../db/index.ts"), () => ({
	withDb: <T>(fn: (d: typeof db) => Promise<T>) => fn(db),
}));
const { claimUndo, judgedFingerprints, listEvents, NON_MATCHES_KEPT, NOTABLE_KEPT, pruneEvents } = await import("@/lib/rules/events-repo");

const KEY = "acct";
let clock = Date.UTC(2026, 9, 1);

async function makeRules(n: number, action: RuleAction = "archive"): Promise<string[]> {
	const ids = Array.from({ length: n }, () => randomUUID());
	await db.insert(schema.mailRules).values(ids.map((id, position) => ({ id, accountKey: KEY, sealed: "x", action, position })));
	return ids;
}

type Kind = "miss" | "applied" | "held";
const PROBABILITY: Record<Kind, number> = { miss: 0.1, applied: 0.9, held: 0.7 };

/** One judgment per rule per message, each newer than the last, as a run writes them. */
async function judge(ruleIds: string[], messages: string[], kind: Kind = "miss"): Promise<string[]> {
	const rows = messages.flatMap((m) =>
		ruleIds.map((ruleId) => ({
			id: randomUUID(),
			accountKey: KEY,
			ruleId,
			fingerprint: `${ruleId}:${m}`,
			action: "archive" as const,
			probability: PROBABILITY[kind],
			applied: kind === "applied",
			engine: "kage" as const,
			sealed: "x",
			createdAt: new Date((clock += 1000)),
		})),
	);
	for (let i = 0; i < rows.length; i += 1000) await db.insert(schema.ruleEvents).values(rows.slice(i, i + 1000));
	return rows.map((r) => r.id);
}

const window = (tag: string, n = RUN_RECENT) => Array.from({ length: n }, (_, i) => `${tag}-${i}`);
const fingerprints = (ruleIds: string[], messages: string[]) => messages.flatMap((m) => ruleIds.map((r) => `${r}:${m}`));
const count = async () => (await db.select().from(schema.ruleEvents)).length;

beforeEach(async () => {
	await pg.exec("DELETE FROM rule_events; DELETE FROM mail_rules;");
});

describe("pruneEvents keeps what rules did apart from plain non-matches", () => {
	test("an applied move keeps its Undo after many runs over new mail", async () => {
		const rules = await makeRules(5);
		const [applied] = await judge(rules.slice(0, 1), ["weekly-roundup"], "applied");
		for (let run = 0; run < 25; run++) {
			await judge(rules, window(`run${run}`));
			await pruneEvents(KEY);
		}

		expect((await listEvents(KEY)).map((e) => e.id)).toContain(applied);
		expect(await claimUndo(KEY, applied)).toBe(true);
		expect(await count()).toBe(1 + NON_MATCHES_KEPT);
	});

	test("a message still in the window isn't judged again", async () => {
		const rules = await makeRules(RULE_LIMIT);
		const inbox = window("inbox");
		await judge(rules, inbox);
		// Later mail the rules held back (people you write to), then left the window.
		await judge(rules.slice(0, 6), window("held", 50), "held");
		await pruneEvents(KEY);

		expect((await judgedFingerprints(KEY, fingerprints(rules, inbox))).size).toBe(RULE_LIMIT * RUN_RECENT);
	});

	test("each kind keeps its own newest", async () => {
		const rules = await makeRules(1);
		const oldNotable = await judge(rules, window("old-held", 5), "held");
		const notable = await judge(rules, window("applied", NOTABLE_KEPT), "applied");
		const oldMisses = await judge(rules, window("old-miss", 5));
		await judge(rules, window("miss", NON_MATCHES_KEPT));
		await pruneEvents(KEY);

		const rows = await db.select().from(schema.ruleEvents);
		const ids = new Set(rows.map((r) => r.id));
		expect(rows.length).toBe(NOTABLE_KEPT + NON_MATCHES_KEPT);
		expect(oldNotable.some((id) => ids.has(id))).toBe(false);
		expect(oldMisses.some((id) => ids.has(id))).toBe(false);
		expect(notable.every((id) => ids.has(id))).toBe(true);
	});

	test("a held-back 0.7 stored as real still counts as notable", async () => {
		const rules = await makeRules(1);
		const [held] = await judge(rules, ["invite"], "held");
		await judge(rules, window("miss", NON_MATCHES_KEPT + 10));
		await pruneEvents(KEY);

		expect((await listEvents(KEY)).map((e) => e.id)).toEqual([held]);
	});
});
