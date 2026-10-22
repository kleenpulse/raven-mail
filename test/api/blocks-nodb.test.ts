import { describe, expect, test } from "bun:test";
import { DELETE, GET, POST } from "@/app/api/blocks/route";
import { call, readJson, req } from "../helpers/request";

// DATABASE_URL is scrubbed in test/setup.ts: blocked senders answer with their own callout.

type Err = { ok: false; error: string; code: string; hint: string };

describe("/api/blocks without a database", () => {
	test.each([
		["GET", () => call(GET, req("/api/blocks"))],
		["POST", () => call(POST, req("/api/blocks", { json: { kind: "address", value: "bob@shop.example" } }))],
		["DELETE", () => call(DELETE, req(`/api/blocks?id=${crypto.randomUUID()}`, { method: "DELETE" }))],
	])("%s → 503 store_needs_db", async (_, run) => {
		const res = await run();
		expect(res.status).toBe(503);
		const body = await readJson<Err>(res);
		expect(body.code).toBe("store_needs_db");
		expect(body.error).toBe("Rules, blocked senders and reminders need a database.");
		expect(body.hint).toBe("Set DATABASE_URL, then run bun run db:migrate.");
	});
});
