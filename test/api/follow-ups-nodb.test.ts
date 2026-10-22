import { describe, expect, test } from "bun:test";
import { DELETE, GET, PATCH, POST } from "@/app/api/follow-ups/route";
import { call, readJson, req } from "../helpers/request";

// DATABASE_URL is scrubbed in test/setup.ts: reminders answer with the store's own callout.

type Err = { ok: false; error: string; code: string; hint: string };
const id = crypto.randomUUID();

describe("/api/follow-ups without a database", () => {
	test.each([
		["GET", () => call(GET, req("/api/follow-ups"))],
		["POST", () => call(POST, req("/api/follow-ups", { json: { folder: "Sent", uid: "1", remind: { days: 1 } } }))],
		["PATCH", () => call(PATCH, req("/api/follow-ups", { method: "PATCH", json: { id, action: "done" } }))],
		["DELETE", () => call(DELETE, req(`/api/follow-ups?id=${id}`, { method: "DELETE" }))],
	])("%s → 503 store_needs_db", async (_, run) => {
		const res = await run();
		expect(res.status).toBe(503);
		const body = await readJson<Err>(res);
		expect(body.code).toBe("store_needs_db");
		expect(body.error).toBe("Rules, blocked senders and reminders need a database.");
		expect(body.hint).toBe("Set DATABASE_URL, then run bun run db:migrate.");
	});
});
