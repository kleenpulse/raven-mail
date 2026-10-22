import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import type { BlockDTO } from "@/lib/blocks/types";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";

// /api/blocks over an in-memory repo. The no-database path is in blocks-nodb.test.ts.

type Row = { id: string; accountKey: string; kind: string; fingerprint: string; sealed: string; createdAt: Date };
let rows: Row[] = [];

mock.module(path.resolve(import.meta.dir, "../../lib/blocks/repo.ts"), () => ({
	listBlocks: async (key: string) => rows.filter((r) => r.accountKey === key),
	countBlocks: async (key: string) => rows.filter((r) => r.accountKey === key).length,
	insertBlock: async (v: Omit<Row, "createdAt">) => {
		if (rows.some((r) => r.accountKey === v.accountKey && r.fingerprint === v.fingerprint)) return null;
		const row = { ...v, createdAt: new Date("2026-10-22T12:00:00Z") };
		rows.push(row);
		return row;
	},
	deleteBlock: async (key: string, id: string) => {
		const before = rows.length;
		rows = rows.filter((r) => !(r.accountKey === key && r.id === id));
		if (rows.length === before) {
			const { IntegrationError } = await import("@/lib/integrations/errors");
			throw new IntegrationError("not_found", { message: "That sender isn't blocked anymore." });
		}
	},
}));

const { GET, POST, DELETE } = await import("@/app/api/blocks/route");

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code: string };

const me = makeSession();
const add = (json: unknown, session = me) => call(POST, req("/api/blocks", { json, session }));
const list = async (session = me) => (await readJson<Ok<BlockDTO[]>>(await call(GET, req("/api/blocks", { session })))).data;
const remove = (id: string, opts: Parameters<typeof req>[1] = {}) =>
	call(DELETE, req(`/api/blocks?id=${id}`, { method: "DELETE", session: me, ...opts }));

beforeEach(() => {
	rows = [];
});

describe("/api/blocks", () => {
	test("block, list, unblock", async () => {
		const res = await add({ kind: "address", value: "  Bob@Shop.Example " });
		expect(res.status).toBe(200);
		const saved = (await readJson<Ok<BlockDTO>>(res)).data;
		expect(saved).toMatchObject({ kind: "address", value: "bob@shop.example" });
		expect(await list()).toEqual([saved]);
		// Stored sealed: the address never sits in the row in plain text.
		expect(JSON.stringify(rows)).not.toContain("bob@shop.example");

		expect((await remove(saved.id)).status).toBe(200);
		expect(await list()).toEqual([]);
	});

	test("blocking twice returns the first entry", async () => {
		const first = (await readJson<Ok<BlockDTO>>(await add({ kind: "domain", value: "@spam.example" }))).data;
		const again = (await readJson<Ok<BlockDTO>>(await add({ kind: "domain", value: "SPAM.example" }))).data;
		expect(again.id).toBe(first.id);
		expect(await list()).toHaveLength(1);
	});

	test("each mailbox sees only its own list", async () => {
		await add({ kind: "address", value: "bob@shop.example" });
		expect(await list(makeSession())).toEqual([]);
	});

	test("unblocking someone else's entry is a 404", async () => {
		const saved = (await readJson<Ok<BlockDTO>>(await add({ kind: "address", value: "bob@shop.example" }))).data;
		const res = await remove(saved.id, { session: makeSession() });
		expect(res.status).toBe(404);
		expect(await list()).toHaveLength(1);
	});

	test.each([
		["not an address", { kind: "address", value: "bob" }],
		["not a domain", { kind: "domain", value: "localhost" }],
		["unknown kind", { kind: "ip", value: "1.2.3.4" }],
		["empty", { kind: "address", value: "" }],
	])("400: %s", async (_, body) => {
		const res = await add(body);
		expect(res.status).toBe(400);
		expect(rows).toHaveLength(0);
	});

	test("400 for an id that isn't a uuid", async () => {
		expect((await remove("1%20OR%201=1")).status).toBe(400);
	});

	test("401 without a session, 403 cross-origin", async () => {
		expect((await call(GET, req("/api/blocks", { session: null }))).status).toBe(401);
		expect((await add({ kind: "address", value: "bob@shop.example" }, null as never)).status).toBe(401);
		const cross = await call(POST, req("/api/blocks", { json: { kind: "address", value: "a@b.example" }, origin: "https://evil.example" }));
		expect(cross.status).toBe(403);
		expect(rows).toHaveLength(0);
	});

	test("the limit is enforced", async () => {
		for (let i = 0; i < 500; i++) {
			rows.push({ id: crypto.randomUUID(), accountKey: "x", kind: "address", fingerprint: `f${i}`, sealed: "", createdAt: new Date() });
		}
		const { tenantKey } = await import("@/lib/integrations/crypto");
		for (const r of rows) r.accountKey = tenantKey(me);
		const res = await add({ kind: "address", value: "one.more@shop.example" });
		expect(res.status).toBe(409);
		expect((await readJson<Err>(res)).code).toBe("limit_reached");
	});
});
