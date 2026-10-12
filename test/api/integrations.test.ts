import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { GET as OVERVIEW } from "@/app/api/integrations/route";
import { GET as EVENTS } from "@/app/api/integrations/events/route";
import { POST as CONNECT } from "@/app/api/integrations/connect/route";
import { POST as CHECK } from "@/app/api/integrations/check/route";
import { POST as SHARE } from "@/app/api/integrations/share/route";
import { POST as BRIEF } from "@/app/api/integrations/brief/route";
import { POST as PLAN } from "@/app/api/integrations/export/plan/route";
import { POST as CHUNK } from "@/app/api/integrations/export/chunk/route";
import type { ExportPlan, IntegrationsOverview, StepEvent } from "@/lib/integrations/types";
import { afterQueue, flushAfter } from "../state";
import { call, readJson, readNdjsonAll, req } from "../helpers/request";
import { makeSession } from "../helpers/session";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code: string; hint?: string; retryable?: boolean };
type Ev = StepEvent & { code?: string; step?: string };

const UUID = "3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const SLACK_URL = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";

// Nothing in this file may touch the network: DB is unconfigured, flows are
// chosen to stop before delivery. Fail loudly if one ever reaches fetch.
let fetchSpy: Mock<typeof fetch>;
let warnSpy: Mock<typeof console.warn>;
beforeEach(() => {
	// connectFlow records activity best-effort even without a DB; it logs a warning.
	warnSpy = spyOn(console, "warn").mockImplementation(() => {});
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
		throw new Error("network access in tests");
	}) as unknown as typeof fetch);
});
afterEach(() => {
	expect(fetchSpy).not.toHaveBeenCalled();
	fetchSpy.mockRestore();
	warnSpy.mockRestore();
});

function post(handler: (r: Request) => Promise<Response>, path: string, json: unknown, opts: Parameters<typeof req>[1] = {}) {
	return call(handler, req(path, { json, ...opts }));
}

function terminal(events: Ev[]) {
	const ends = events.filter((e) => e.type === "done" || e.type === "error");
	expect(ends).toHaveLength(1);
	expect(events.at(-1)).toBe(ends[0]!);
	expect(events[0]!.type).toBe("plan");
	return ends[0]!;
}

describe("GET /api/integrations", () => {
	test("401 without a session", async () => {
		const res = await call(OVERVIEW, req("/api/integrations", { session: null }));
		expect(res.status).toBe(401);
	});

	test("degrades without a database: 200, builtins present, connections null", async () => {
		const session = makeSession();
		const res = await call(OVERVIEW, req("/api/integrations", { session }));
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<IntegrationsOverview>>(res);
		expect(data.dbReady).toBe(false);
		expect(data.dbError?.code).toBe("db_not_configured");
		expect(typeof data.dbError?.hint).toBe("string");
		expect(data.connections).toBeNull();
		expect(data.lastExport).toBeNull();
		expect(data.builtins.mail).toMatchObject({
			email: session.email,
			provider: "dev",
			dev: true,
			imap: { host: "dev.local", port: 993, security: "tls" },
			smtp: { host: "dev.local", port: 465, security: "tls" },
			lastCheck: null,
		});
		expect(data.builtins.jev).toMatchObject({ configured: false, model: "jev-latest", lastCheck: null });
		expect(Number.isNaN(Date.parse(data.syncedAt))).toBe(false);
	});
});

describe("GET /api/integrations/events", () => {
	test("401 without a session", async () => {
		const res = await call(EVENTS, req("/api/integrations/events", { session: null }));
		expect(res.status).toBe(401);
	});

	test("no database → 503 db_not_configured with catalog hint", async () => {
		const res = await call(EVENTS, req("/api/integrations/events?limit=10&target=mail"));
		expect(res.status).toBe(503);
		const body = await readJson<Err>(res);
		expect(body).toMatchObject({ ok: false, code: "db_not_configured", retryable: false });
		expect(body.hint).toContain("DATABASE_URL");
	});

	test.each([
		["limit=0", "limit=0"],
		["limit=51", "limit=51"],
		["bad target", "target=telegram"],
		["bad integrationId", "integrationId=nope"],
		["negative cursor", "cursor=-3"],
	])("%s → 400 before touching the DB", async (_name, query) => {
		const res = await call(EVENTS, req(`/api/integrations/events?${query}`));
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});
});

describe("POST /api/integrations/connect", () => {
	test("403 cross-origin", async () => {
		const res = await post(CONNECT, "/api/integrations/connect", { kind: "slack", url: SLACK_URL }, { origin: "https://evil.example" });
		expect(res.status).toBe(403);
	});

	test("415 non-JSON", async () => {
		const res = await call(CONNECT, req("/api/integrations/connect", { body: "kind=slack", headers: { "content-type": "application/x-www-form-urlencoded" } }));
		expect(res.status).toBe(415);
	});

	test.each([
		["unknown kind", { kind: "teams", url: SLACK_URL }],
		["empty url", { kind: "slack", url: "   " }],
		["url too long", { kind: "slack", url: `https://hooks.slack.com/${"a".repeat(2050)}` }],
		["bad replaceId", { kind: "slack", url: SLACK_URL, replaceId: "x" }],
		["label too long", { kind: "slack", url: SLACK_URL, label: "l".repeat(61) }],
	])("400 on %s", async (_name, body) => {
		const res = await post(CONNECT, "/api/integrations/connect", body);
		expect(res.status).toBe(400);
	});

	test("invalid URL: stream ends in one error at 'validate' (no network)", async () => {
		const res = await post(CONNECT, "/api/integrations/connect", { kind: "slack", url: "not a url" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
		const events = await readNdjsonAll<Ev>(res);
		const end = terminal(events);
		expect(end).toMatchObject({ type: "error", code: "invalid_url", step: "validate" });
		expect(events).toContainEqual(expect.objectContaining({ type: "step", id: "validate", status: "error" }));
	});

	test("Discord URL on the Slack card → wrong_provider_url", async () => {
		const res = await post(CONNECT, "/api/integrations/connect", {
			kind: "slack",
			url: "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnop",
		});
		const end = terminal(await readNdjsonAll<Ev>(res));
		expect(end).toMatchObject({ type: "error", code: "wrong_provider_url" });
	});

	test("valid Slack URL without a DB: one terminal error (db_not_configured) before any delivery", async () => {
		const res = await post(CONNECT, "/api/integrations/connect", { kind: "slack", url: SLACK_URL });
		const events = await readNdjsonAll<Ev>(res);
		const plan = events[0] as Extract<StepEvent, { type: "plan" }>;
		expect(plan.steps.map((s) => s.id)).toEqual(["validate", "test", "save"]);
		const end = terminal(events);
		expect(end).toMatchObject({ type: "error", code: "db_not_configured", step: "validate" });
		expect(events.some((e) => e.type === "step" && e.id === "test")).toBe(false);
	});

	test("Discord plan includes the lookup step, still stops at validate without DB", async () => {
		const res = await post(CONNECT, "/api/integrations/connect", {
			kind: "discord",
			url: "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnop",
		});
		const events = await readNdjsonAll<Ev>(res);
		expect((events[0] as Extract<StepEvent, { type: "plan" }>).steps.map((s) => s.id)).toEqual(["validate", "lookup", "test", "save"]);
		expect(terminal(events)).toMatchObject({ type: "error", step: "validate" });
	});
});

describe("POST /api/integrations/check", () => {
	test("401 without a session", async () => {
		const res = await post(CHECK, "/api/integrations/check", { target: "mail" }, { session: null });
		expect(res.status).toBe(401);
	});

	test.each([
		["unknown target", { target: "slack" }],
		["bad id", { id: "123" }],
		["empty body", {}],
	])("400 on %s", async (_name, body) => {
		const res = await post(CHECK, "/api/integrations/check", body);
		expect(res.status).toBe(400);
	});

	test(
		"mail diagnostics on the dev mailbox: all steps ok, one terminal done",
		async () => {
			const res = await post(CHECK, "/api/integrations/check", { target: "mail" });
			expect(res.status).toBe(200);
			const events = await readNdjsonAll<Ev>(res);
			const plan = events[0] as Extract<StepEvent, { type: "plan" }>;
			const ids = plan.steps.map((s) => s.id);
			expect(ids).toEqual(["resolve", "secure", "signin", "mailbox", "features", "smtp"]);
			const end = terminal(events);
			expect(end).toMatchObject({ type: "done", result: { outcome: "ok", summary: `All ${ids.length} checks passed` } });
			for (const id of ids) {
				expect(events).toContainEqual(expect.objectContaining({ type: "step", id, status: "ok" }));
			}
			// DB unconfigured → nothing recorded.
			expect(afterQueue).toHaveLength(0);
		},
		15_000,
	);

	test("jev diagnostics with Jev disabled: one terminal error jev_no_key at 'key'", async () => {
		const res = await post(CHECK, "/api/integrations/check", { target: "jev" });
		const events = await readNdjsonAll<Ev>(res);
		const end = terminal(events);
		expect(end).toMatchObject({ type: "error", code: "jev_no_key", step: "key" });
		expect(events.some((e) => e.type === "step" && e.id === "reach")).toBe(false);
	});

	test("connection test without a DB: one terminal error at 'unlock'", async () => {
		const res = await post(CHECK, "/api/integrations/check", { id: UUID });
		const events = await readNdjsonAll<Ev>(res);
		expect(terminal(events)).toMatchObject({ type: "error", code: "db_not_configured", step: "unlock" });
	});

	test("rate limit: 10/min per mailbox, 11th → 429 too_many_requests with Retry-After", async () => {
		const session = makeSession();
		for (let i = 0; i < 10; i++) {
			const res = await post(CHECK, "/api/integrations/check", { target: "jev" }, { session });
			expect(res.status).toBe(200);
			await readNdjsonAll(res);
		}
		const res = await post(CHECK, "/api/integrations/check", { target: "jev" }, { session });
		expect(res.status).toBe(429);
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
		expect((await readJson<Err>(res)).code).toBe("too_many_requests");
	});
});

const email = {
	folder: "INBOX",
	uid: "42",
	messageId: "<a@b>",
	subject: "Hello",
	from: { name: "Maya", address: "maya@example.com" },
	date: new Date(0).toISOString(),
	preview: "Hi there",
};
const item = { folder: "INBOX", uid: "42", subject: "Hello", from: { name: "Maya", address: "maya@example.com" }, why: ["Asked you a question"] };

describe("POST /api/integrations/share", () => {
	test.each([
		["missing integrationId", { email }],
		["bad integrationId", { integrationId: "nope", email }],
		["bad uid", { integrationId: UUID, email: { ...email, uid: "abc" } }],
		["folder with newline", { integrationId: UUID, email: { ...email, folder: "IN\nBOX" } }],
		["note too long", { integrationId: UUID, email, note: "n".repeat(281) }],
		["preview too long", { integrationId: UUID, email: { ...email, preview: "p".repeat(561) } }],
	])("400 on %s", async (_name, body) => {
		const res = await post(SHARE, "/api/integrations/share", body);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});

	test("403 cross-origin", async () => {
		const res = await post(SHARE, "/api/integrations/share", { integrationId: UUID, email }, { origin: "https://evil.example" });
		expect(res.status).toBe(403);
	});

	test("valid input without a DB → 503 db_not_configured; after() queue flushes cleanly", async () => {
		const res = await post(SHARE, "/api/integrations/share", { integrationId: UUID, email, note: "fyi" });
		expect(res.status).toBe(503);
		expect(await readJson<Err>(res)).toMatchObject({ ok: false, code: "db_not_configured", retryable: false });
		// Nothing was delivered, so nothing is recorded.
		expect(afterQueue).toHaveLength(0);
		await expect(flushAfter()).resolves.toBeUndefined();
	});
});

describe("POST /api/integrations/brief", () => {
	test.each([
		["no items", { integrationId: UUID, dateLabel: "Today", items: [] }],
		["six items", { integrationId: UUID, dateLabel: "Today", items: Array(6).fill(item) }],
		["empty dateLabel", { integrationId: UUID, dateLabel: "  ", items: [item] }],
		["too many whys", { integrationId: UUID, dateLabel: "Today", items: [{ ...item, why: ["a", "b", "c", "d", "e"] }] }],
		["bad integrationId", { integrationId: "x", dateLabel: "Today", items: [item] }],
	])("400 on %s", async (_name, body) => {
		const res = await post(BRIEF, "/api/integrations/brief", body);
		expect(res.status).toBe(400);
	});

	test("415 on text/plain", async () => {
		const res = await call(BRIEF, req("/api/integrations/brief", { body: "{}", headers: { "content-type": "text/plain" } }));
		expect(res.status).toBe(415);
	});

	test("valid input without a DB → 503; after() queue flushes cleanly", async () => {
		const res = await post(BRIEF, "/api/integrations/brief", { integrationId: UUID, dateLabel: "Thu 25 Sep", items: [item] });
		expect(res.status).toBe(503);
		expect((await readJson<Err>(res)).code).toBe("db_not_configured");
		await expect(flushAfter()).resolves.toBeUndefined();
	});

	test("rate limit: 6/min per mailbox", async () => {
		const session = makeSession();
		const body = { integrationId: UUID, dateLabel: "Today", items: [item] };
		for (let i = 0; i < 6; i++) expect((await post(BRIEF, "/api/integrations/brief", body, { session })).status).toBe(503);
		expect((await post(BRIEF, "/api/integrations/brief", body, { session })).status).toBe(429);
	});
});

describe("POST /api/integrations/export/plan", () => {
	async function plan(folder: string, range: string) {
		return post(PLAN, "/api/integrations/export/plan", { folder, range });
	}

	test("dev INBOX, range all → uids, chunks and totals that agree", async () => {
		const res = await plan("INBOX", "all");
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<ExportPlan>>(res);
		expect(data).toMatchObject({ folder: "INBOX", range: "all", uidValidity: "1" });
		expect(data.total).toBeGreaterThan(0);
		expect(data.chunks.length).toBeGreaterThan(0);
		expect(data.chunks.reduce((n, c) => n + c.count, 0)).toBe(data.total);
		expect(data.chunks.reduce((n, c) => n + c.bytes, 0)).toBe(data.bytes);
		for (const c of data.chunks) {
			expect(c.uids).toMatch(/^\d+(?::\d+)?(?:,\d+(?::\d+)?)*$/);
			expect(c.count).toBeLessThanOrEqual(100);
		}
	});

	test("30d is a subset of all", async () => {
		const all = (await readJson<Ok<ExportPlan>>(await plan("INBOX", "all"))).data;
		const recent = (await readJson<Ok<ExportPlan>>(await plan("INBOX", "30d"))).data;
		expect(recent.total).toBeLessThanOrEqual(all.total);
	});

	test("unknown folder → 404 folder_missing", async () => {
		const res = await plan("NoSuchFolder", "all");
		expect(res.status).toBe(404);
		expect((await readJson<Err>(res)).code).toBe("folder_missing");
	});

	test.each([
		["bad range", "INBOX", "7d"],
		["empty folder", "", "all"],
	])("400 on %s", async (_name, folder, range) => {
		const res = await plan(folder, range);
		expect(res.status).toBe(400);
	});
});

describe("POST /api/integrations/export/chunk", () => {
	test("first chunk of the plan → application/mbox with count header and mboxrd body", async () => {
		const session = makeSession();
		const planned = (await readJson<Ok<ExportPlan>>(await post(PLAN, "/api/integrations/export/plan", { folder: "INBOX", range: "all" }, { session }))).data;
		const first = planned.chunks[0]!;
		const res = await post(CHUNK, "/api/integrations/export/chunk", { folder: "INBOX", uidValidity: planned.uidValidity, uids: first.uids }, { session });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/mbox");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const meta = JSON.parse(res.headers.get("x-raven-export")!) as { count: number; missing: number };
		expect(meta.count).toBeGreaterThanOrEqual(1);
		expect(meta.count + meta.missing).toBe(first.count);
		const text = await res.text();
		expect(text.startsWith("From ")).toBe(true);
		expect(text.match(/^From /gm)!.length).toBe(meta.count);
	});

	test("uids outside the folder are counted as missing", async () => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", { folder: "INBOX", uidValidity: "1", uids: "4000000000" });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.headers.get("x-raven-export")!)).toEqual({ count: 0, missing: 1 });
		expect((await res.arrayBuffer()).byteLength).toBe(0);
	});

	test("changed UIDVALIDITY → 409 export_changed", async () => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", { folder: "INBOX", uidValidity: "2", uids: "1" });
		expect(res.status).toBe(409);
		expect((await readJson<Err>(res)).code).toBe("export_changed");
	});

	test.each([
		["star set", { folder: "INBOX", uidValidity: "1", uids: "1:*" }],
		["zero uid", { folder: "INBOX", uidValidity: "1", uids: "0" }],
		["over 100 uids", { folder: "INBOX", uidValidity: "1", uids: "1:101" }],
		["reversed range", { folder: "INBOX", uidValidity: "1", uids: "9:2" }],
	])("400 invalid_request on %s", async (_name, body) => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", body);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("invalid_request");
	});

	test.each([
		["non-numeric uidValidity", { folder: "INBOX", uidValidity: "abc", uids: "1" }],
		["empty uids", { folder: "INBOX", uidValidity: "1", uids: "" }],
		["missing folder", { uidValidity: "1", uids: "1" }],
	])("400 bad_request on %s", async (_name, body) => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", body);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});

	test("unknown folder → 404 folder_missing", async () => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", { folder: "Nope", uidValidity: "1", uids: "1" });
		expect(res.status).toBe(404);
	});

	test("401 without a session", async () => {
		const res = await post(CHUNK, "/api/integrations/export/chunk", { folder: "INBOX", uidValidity: "1", uids: "1" }, { session: null });
		expect(res.status).toBe(401);
	});
});
