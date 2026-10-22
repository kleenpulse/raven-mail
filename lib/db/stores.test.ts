import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { makeSession } from "@/test/helpers/session";

// The rules, blocks and reminders services over in-memory repos: what gets
// stored (sealed), limits, validation, and rows that can't be opened.

type Row = Record<string, unknown> & { id: string; accountKey: string; createdAt: Date; updatedAt?: Date };
const tables: Record<string, Row[]> = { rules: [], blocks: [], follow: [] };
const now = () => new Date("2026-10-22T12:00:00Z");
const notFound = async () => {
	const { IntegrationError } = await import("@/lib/integrations/errors");
	return new IntegrationError("not_found");
};

const here = (p: string) => path.resolve(import.meta.dir, p);
mock.module(here("../rules/repo.ts"), () => ({
	listRules: async (key: string) => tables.rules!.filter((r) => r.accountKey === key),
	ruleStats: async (key: string) => {
		const mine = tables.rules!.filter((r) => r.accountKey === key);
		return { count: mine.length, nextPosition: mine.length ? Math.max(...mine.map((r) => r.position as number)) + 1 : 0 };
	},
	insertRule: async (v: Row) => {
		const row = { enabled: true, ...v, createdAt: now(), updatedAt: now() };
		tables.rules!.push(row);
		return row;
	},
	updateRule: async (key: string, id: string, patch: Partial<Row>) => {
		const row = tables.rules!.find((r) => r.accountKey === key && r.id === id);
		if (!row) throw await notFound();
		Object.assign(row, patch, { updatedAt: now() });
		return row;
	},
	deleteRule: async () => {},
}));
mock.module(here("../blocks/repo.ts"), () => ({
	listBlocks: async (key: string) => tables.blocks!.filter((r) => r.accountKey === key),
	countBlocks: async (key: string) => tables.blocks!.filter((r) => r.accountKey === key).length,
	insertBlock: async (v: Row) => {
		if (tables.blocks!.some((r) => r.accountKey === v.accountKey && r.fingerprint === v.fingerprint)) return null;
		const row = { ...v, createdAt: now() };
		tables.blocks!.push(row);
		return row;
	},
	deleteBlock: async () => {},
}));
mock.module(here("../follow-ups/repo.ts"), () => ({
	listOpenFollowUps: async (key: string) => tables.follow!.filter((r) => r.accountKey === key && r.status === "open"),
	countOpenFollowUps: async (key: string) => tables.follow!.filter((r) => r.accountKey === key && r.status === "open").length,
	insertFollowUp: async (v: Row) => {
		const row = { status: "open", ...v, createdAt: now(), updatedAt: now() };
		tables.follow!.push(row);
		return row;
	},
	updateFollowUp: async (key: string, id: string, patch: Partial<Row>) => {
		const row = tables.follow!.find((r) => r.accountKey === key && r.id === id);
		if (!row) throw await notFound();
		Object.assign(row, patch);
		return row;
	},
	deleteFollowUp: async () => {},
}));

const rules = await import("@/lib/rules/service");
const blocks = await import("@/lib/blocks/service");
const followUps = await import("@/lib/follow-ups/service");
const { RULE_LIMIT } = await import("@/lib/rules/types");
const { BLOCK_LIMIT } = await import("@/lib/blocks/types");
const { tenantKey } = await import("@/lib/integrations/crypto");

const session = makeSession({ email: "me@raven.dev" });
const other = makeSession({ email: "you@raven.dev" });

beforeEach(() => {
	for (const k of Object.keys(tables)) tables[k] = [];
});

describe("rules", () => {
	test("stores the criteria sealed, and reads it back", async () => {
		const rule = await rules.createRule(session, { criteria: "  anything from bob@acme.com  ", action: "trash" });
		expect(rule).toMatchObject({ criteria: "anything from bob@acme.com", action: "trash", enabled: true, position: 0 });
		const stored = JSON.stringify(tables.rules);
		expect(stored).not.toContain("bob");
		expect(stored).not.toContain("me@raven.dev");
		expect(await rules.getRules(session)).toEqual([rule]);
		expect(await rules.getRules(other)).toEqual([]);
	});

	test("move needs a folder; an empty rule is refused", async () => {
		await expect(rules.createRule(session, { criteria: "receipts", action: "move" })).rejects.toThrow("Pick a folder");
		await expect(rules.createRule(session, { criteria: "  ", action: "star" })).rejects.toThrow("Say which mail");
		const moved = await rules.createRule(session, { criteria: "receipts", action: "move", folder: "Receipts" });
		expect(moved.folder).toBe("Receipts");
	});

	test(`stops at ${RULE_LIMIT} rules; positions keep counting up`, async () => {
		for (let i = 0; i < RULE_LIMIT; i++) await rules.createRule(session, { criteria: `r${i}`, action: "read" });
		expect(tables.rules!.at(-1)!.position).toBe(RULE_LIMIT - 1);
		await expect(rules.createRule(session, { criteria: "one more", action: "read" })).rejects.toThrow(`${RULE_LIMIT} rules`);
	});

	test("a row that can't be opened (moved, or an old secret) is skipped, not shown broken", async () => {
		await rules.createRule(session, { criteria: "ok", action: "star" });
		const moved = await rules.createRule(session, { criteria: "moved", action: "star" });
		tables.rules!.find((r) => r.id === moved.id)!.accountKey = "someone-else";
		tables.rules!.push({ ...tables.rules![0]!, id: "copied-id" });
		expect((await rules.getRules(session)).map((r) => r.criteria)).toEqual(["ok"]);
	});
});

describe("blocked senders", () => {
	test("normalises, seals, and blocking twice returns the first entry", async () => {
		const first = await blocks.addBlock(session, "address", "  Bob@Acme.COM ");
		expect(first).toMatchObject({ kind: "address", value: "bob@acme.com" });
		const again = await blocks.addBlock(session, "address", "bob@acme.com");
		expect(again.id).toBe(first.id);
		expect(tables.blocks).toHaveLength(1);
		expect(JSON.stringify(tables.blocks)).not.toContain("acme");
		expect((await blocks.addBlock(session, "domain", "@acme.com")).value).toBe("acme.com");
	});

	test("refuses things that aren't an address or a domain", async () => {
		await expect(blocks.addBlock(session, "address", "bob")).rejects.toThrow("isn't an email address");
		await expect(blocks.addBlock(session, "domain", "not a domain")).rejects.toThrow("isn't a domain");
	});

	test(`stops at ${BLOCK_LIMIT}`, async () => {
		const key = tenantKey(session);
		for (let i = 0; i < BLOCK_LIMIT; i++) tables.blocks!.push({ id: `b${i}`, accountKey: key, createdAt: now() });
		await expect(blocks.addBlock(session, "domain", "acme.com")).rejects.toThrow(`${BLOCK_LIMIT} senders`);
	});
});

describe("reminders", () => {
	const target = { messageId: "<m1@raven.dev>", subject: "Quote for Acme", to: "bob@acme.com", folder: "Sent", uid: "9" };

	test("seals the target; snooze and done", async () => {
		const due = new Date("2026-10-25T09:00:00Z");
		const reminder = await followUps.createFollowUp(session, target, due);
		expect(reminder).toMatchObject({ ...target, status: "open", dueAt: due.toISOString() });
		expect(JSON.stringify(tables.follow)).not.toContain("Acme");
		const later = new Date("2026-10-26T09:00:00Z");
		expect((await followUps.snoozeFollowUp(session, reminder.id, later)).dueAt).toBe(later.toISOString());
		await followUps.finishFollowUp(session, reminder.id);
		expect(await followUps.getOpenFollowUps(session)).toEqual([]);
	});

	test("another mailbox can't touch it", async () => {
		const reminder = await followUps.createFollowUp(session, target, now());
		await expect(followUps.finishFollowUp(other, reminder.id)).rejects.toThrow();
	});
});
