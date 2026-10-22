import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import path from "node:path";
import type { FollowUpView } from "@/lib/follow-ups/types";
import type { ReplyCheck } from "@/lib/mail/imap";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";

// The real-server path of GET /api/follow-ups: a reply check that crawls must not hold the list hostage.

type Row = { id: string; accountKey: string; sealed: string; dueAt: Date; status: "open" | "done"; createdAt: Date; updatedAt: Date };
let rows: Row[] = [];

mock.module(path.resolve(import.meta.dir, "../../lib/follow-ups/repo.ts"), () => ({
	listOpenFollowUps: async (key: string) => rows.filter((r) => r.accountKey === key && r.status === "open"),
	countOpenFollowUps: async (key: string) => rows.filter((r) => r.accountKey === key && r.status === "open").length,
	insertFollowUp: async (v: Pick<Row, "id" | "accountKey" | "sealed" | "dueAt">) => {
		const row: Row = { ...v, status: "open", createdAt: new Date(), updatedAt: new Date() };
		rows.push(row);
		return row;
	},
	updateFollowUp: async (key: string, id: string, patch: Partial<Pick<Row, "dueAt" | "status">>) => {
		const row = rows.find((r) => r.accountKey === key && r.id === id)!;
		Object.assign(row, patch, { updatedAt: new Date() });
		return row;
	},
	deleteFollowUp: async () => {},
}));

let seen: AbortSignal | undefined;
const imap = path.resolve(import.meta.dir, "../../lib/mail/imap.ts");
const realImap = await import(imap);
mock.module(imap, () => ({
	...realImap,
	// The first check answers at once (a reply), the rest crawl until the abort closes the socket.
	findReplies: (_s: unknown, checks: ReplyCheck[], signal?: AbortSignal) => {
		seen = signal;
		const answers = new Map([[checks[0]!.messageId, { replied: true }]]);
		return new Promise((resolve) => signal?.addEventListener("abort", () => resolve(answers), { once: true }));
	},
}));

const { GET } = await import("@/app/api/follow-ups/route");
const { createFollowUp } = await import("@/lib/follow-ups/service");

const start = new Date("2026-10-22T10:00:00Z");

beforeEach(() => {
	rows = [];
	seen = undefined;
	setSystemTime(start);
});

describe("GET /api/follow-ups over IMAP", () => {
	test("a slow reply check ends with the request: answered ones close, unchecked ones stay due", async () => {
		const me = makeSession({ dev: false });
		for (const n of [1, 2, 3]) {
			const target = { messageId: `<m${n}@x>`, subject: `Plan ${n}`, to: "Maya", folder: "Sent", uid: String(n) };
			await createFollowUp(me, target, new Date(start.getTime() + n * 1000));
		}
		setSystemTime(new Date(start.getTime() + 86_400_000));

		const ctl = new AbortController();
		const base = req("/api/follow-ups", { session: me });
		const pending = call(GET, new Request(base, { signal: ctl.signal }));
		setTimeout(() => ctl.abort(), 20);
		const res = await pending;

		expect(res.status).toBe(200);
		const data = (await readJson<{ data: FollowUpView[] }>(res)).data;
		expect(data.map((f) => [f.messageId, f.due])).toEqual([
			["<m2@x>", true],
			["<m3@x>", true],
		]);
		expect(rows.find((r) => r.status === "done")).toBeDefined();
		expect(seen?.aborted).toBe(true);
	});
});
