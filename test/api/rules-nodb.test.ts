import { describe, expect, test } from "bun:test";
import * as rules from "@/app/api/rules/route";
import * as runRoute from "@/app/api/rules/run/route";
import * as eventsRoute from "@/app/api/rules/events/route";
import { call, readJson, req } from "../helpers/request";

// DATABASE_URL is scrubbed in test/setup.ts: rules answer with the store's own callout.

type Err = { ok: false; error: string; code: string; hint: string };
const id = crypto.randomUUID();

describe("/api/rules without a database", () => {
	test.each([
		["GET rules", () => call(rules.GET, req("/api/rules"))],
		["POST rules", () => call(rules.POST, req("/api/rules", { json: { criteria: "receipts", action: "archive" } }))],
		["PATCH rules", () => call(rules.PATCH, req("/api/rules", { method: "PATCH", json: { id, move: "up" } }))],
		["DELETE rules", () => call(rules.DELETE, req(`/api/rules?id=${id}`, { method: "DELETE" }))],
		["run", () => call(runRoute.POST, req("/api/rules/run", { json: {} }))],
		["GET activity", () => call(eventsRoute.GET, req("/api/rules/events"))],
		["undo", () => call(eventsRoute.POST, req("/api/rules/events", { json: { id } }))],
	])("%s → 503 store_needs_db", async (_, send) => {
		const res = await send();
		expect(res.status).toBe(503);
		const body = await readJson<Err>(res);
		expect(body.code).toBe("store_needs_db");
		expect(body.hint).toBe("Set DATABASE_URL, then run bun run db:migrate.");
	});
});
