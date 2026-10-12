import { describe, expect, test } from "bun:test";
import { GET as FOLDERS } from "@/app/api/mail/folders/route";
import { GET as MESSAGES } from "@/app/api/mail/messages/route";
import { GET as MESSAGE } from "@/app/api/mail/message/route";
import { GET as PRELOAD } from "@/app/api/mail/preload/route";
import { SESSION_COOKIE } from "@/lib/session";
import type { MailFolder, MailMessage, MailSummary } from "@/lib/mail/types";
import type { PreloadResult } from "@/lib/mail/preload";
import { call, readJson, req } from "../helpers/request";
import { sessionCookie } from "../helpers/session";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code: string };
type List = { messages: MailSummary[]; count: number };

function tamperedCookie(): string {
	const cookie = sessionCookie();
	const value = cookie.slice(SESSION_COOKIE.length + 1);
	// Flip one character in the ciphertext body: GCM auth must reject it.
	const i = Math.floor(value.length / 2);
	const flipped = value[i] === "A" ? "B" : "A";
	return `${SESSION_COOKIE}=${value.slice(0, i)}${flipped}${value.slice(i + 1)}`;
}

async function list(query: string): Promise<List> {
	const res = await call(MESSAGES, req(`/api/mail/messages?${query}`));
	expect(res.status).toBe(200);
	return (await readJson<Ok<List>>(res)).data;
}

const handlers = [
	["folders", FOLDERS, "/api/mail/folders"],
	["messages", MESSAGES, "/api/mail/messages?folder=INBOX"],
	["message", MESSAGE, "/api/mail/message?folder=INBOX&uid=1"],
	["preload", PRELOAD, "/api/mail/preload?folder=INBOX&uids=1"],
] as const;

describe("auth", () => {
	for (const [name, handler, path] of handlers) {
		test(`${name}: 401 without a cookie`, async () => {
			const res = await call(handler, req(path, { session: null }));
			expect(res.status).toBe(401);
			expect(await readJson(res)).toEqual({ ok: false, error: "Not signed in.", code: "unauthorized" });
		});

		test(`${name}: 401 with a tampered cookie`, async () => {
			const res = await call(handler, req(path, { session: null, headers: { cookie: tamperedCookie() } }));
			expect(res.status).toBe(401);
			expect((await readJson<Err>(res)).code).toBe("unauthorized");
		});

		test(`${name}: 401 with a garbage cookie`, async () => {
			const res = await call(handler, req(path, { session: null, headers: { cookie: `${SESSION_COOKIE}=not-a-token` } }));
			expect(res.status).toBe(401);
		});
	}
});

describe("GET /api/mail/folders", () => {
	test("200 with the dev folder list and no-store", async () => {
		const res = await call(FOLDERS, req("/api/mail/folders"));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const body = await readJson<Ok<MailFolder[]>>(res);
		expect(body.ok).toBe(true);
		expect(body.data.map((f) => f.path)).toEqual(["INBOX", "Sent", "Drafts", "Archive", "Junk", "Trash"]);
		const inbox = body.data[0]!;
		expect(inbox).toMatchObject({ name: "Inbox", delimiter: "/", specialUse: "\\Inbox" });
		expect(inbox.total).toBeGreaterThan(0);
		expect(inbox.unread).toBeGreaterThanOrEqual(0);
		expect(inbox.unread).toBeLessThanOrEqual(inbox.total);
	});
});

describe("GET /api/mail/messages", () => {
	test("200 shape: newest first, default page of 50", async () => {
		const data = await list("folder=INBOX");
		expect(data.count).toBeGreaterThan(50);
		expect(data.messages).toHaveLength(50);
		const first = data.messages[0]!;
		expect(first).toMatchObject({ folder: "INBOX" });
		expect(typeof first.uid).toBe("string");
		expect(typeof first.subject).toBe("string");
		expect(first.flags).toHaveProperty("seen");
		expect(first.from).toHaveProperty("address");
		const dates = data.messages.map((m) => Date.parse(m.date));
		expect(dates).toEqual([...dates].sort((a, b) => b - a));
	});

	test("limit is honoured", async () => {
		const data = await list("folder=INBOX&limit=5");
		expect(data.messages).toHaveLength(5);
	});

	test.each(["0", "101", "-1", "abc", "2.5"])("limit=%s → 400", async (limit) => {
		const res = await call(MESSAGES, req(`/api/mail/messages?folder=INBOX&limit=${limit}`));
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});

	test("missing folder → 400", async () => {
		const res = await call(MESSAGES, req("/api/mail/messages"));
		expect(res.status).toBe(400);
	});

	test("folder with a CR/LF → 400", async () => {
		const res = await call(MESSAGES, req(`/api/mail/messages?folder=${encodeURIComponent("INBOX\r\nA1 LOGOUT")}`));
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).error).toBe("Invalid folder name.");
	});

	test("q > 200 chars → 400", async () => {
		const res = await call(MESSAGES, req(`/api/mail/messages?folder=INBOX&q=${"a".repeat(201)}`));
		expect(res.status).toBe(400);
	});

	test("q filter narrows the result", async () => {
		const all = await list("folder=INBOX&limit=100");
		const hits = await list("folder=INBOX&limit=100&q=roadmap");
		expect(hits.count).toBeGreaterThan(0);
		expect(hits.count).toBeLessThan(all.count);
		expect(hits.messages.some((m) => /roadmap/i.test(m.subject))).toBe(true);
	});

	test("q with no match → empty page", async () => {
		const data = await list("folder=INBOX&q=zzqqxxnomatchqqzz");
		expect(data).toEqual({ messages: [], count: 0 });
	});

	test("before pages strictly below the cursor uid, without overlap", async () => {
		const page1 = await list("folder=INBOX&limit=10");
		const lowest = Math.min(...page1.messages.map((m) => Number(m.uid)));
		const page2 = await list(`folder=INBOX&limit=10&before=${lowest}`);
		expect(page2.messages.length).toBeGreaterThan(0);
		expect(page2.count).toBe(page1.count);
		for (const m of page2.messages) expect(Number(m.uid)).toBeLessThan(lowest);
		const seen = new Set(page1.messages.map((m) => m.uid));
		for (const m of page2.messages) expect(seen.has(m.uid)).toBe(false);
	});

	test.each(["abc", "-1", "12345678901"])("before=%s → 400", async (before) => {
		const res = await call(MESSAGES, req(`/api/mail/messages?folder=INBOX&before=${before}`));
		expect(res.status).toBe(400);
	});

	test("unknown folder → empty list (dev store)", async () => {
		const data = await list("folder=Nope");
		expect(data).toEqual({ messages: [], count: 0 });
	});
});

describe("GET /api/mail/message", () => {
	test("by folder + uid → full message, sanitized", async () => {
		const [summary] = (await list("folder=INBOX&limit=1")).messages;
		const res = await call(MESSAGE, req(`/api/mail/message?folder=INBOX&uid=${summary!.uid}`));
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<MailMessage & { remoteContent: boolean }>>(res);
		expect(data.uid).toBe(summary!.uid);
		expect(data.folder).toBe("INBOX");
		expect(data.subject).toBe(summary!.subject);
		expect(typeof data.text).toBe("string");
		expect(typeof data.html).toBe("string");
		expect(typeof data.remoteContent).toBe("boolean");
		expect(data.html).not.toMatch(/<script/i);
	});

	test("unknown uid → 404 not_found", async () => {
		const res = await call(MESSAGE, req("/api/mail/message?folder=INBOX&uid=9999999"));
		expect(res.status).toBe(404);
		expect((await readJson<Err>(res)).code).toBe("not_found");
	});

	test("uid in the wrong folder → 404", async () => {
		const [summary] = (await list("folder=INBOX&limit=1")).messages;
		const res = await call(MESSAGE, req(`/api/mail/message?folder=Trash&uid=${summary!.uid}`));
		expect(res.status).toBe(404);
	});

	test.each([
		["non-numeric uid", "folder=INBOX&uid=abc"],
		["missing uid", "folder=INBOX"],
		["missing folder", "uid=1"],
		["malformed mid", "folder=INBOX&uid=1&mid=not-a-message-id"],
	])("%s → 400", async (_name, query) => {
		const res = await call(MESSAGE, req(`/api/mail/message?${query}`));
		expect(res.status).toBe(400);
	});
});

describe("GET /api/mail/preload", () => {
	async function preload(uids: string, folder = "INBOX") {
		return call(PRELOAD, req(`/api/mail/preload?folder=${folder}&uids=${encodeURIComponent(uids)}`));
	}

	test("comma list + range parse; bodies returned newest first", async () => {
		const top = (await list("folder=INBOX&limit=3")).messages.map((m) => Number(m.uid));
		const set = top.join(",");
		const res = await preload(set);
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<PreloadResult>>(res);
		expect(data.skipped).toEqual([]);
		expect(data.messages.map((m) => Number(m.uid))).toEqual([...top].sort((a, b) => b - a));
		for (const m of data.messages) expect(typeof m.html).toBe("string");
	});

	test("range syntax a:b expands", async () => {
		const res = await preload("1:3");
		expect(res.status).toBe(200);
		const { data } = await readJson<Ok<PreloadResult>>(res);
		const got = new Set([...data.messages.map((m) => m.uid), ...data.skipped]);
		expect(got).toEqual(new Set(["1", "2", "3"]));
	});

	test("uids not in the folder are reported as skipped", async () => {
		const res = await preload("4000000000");
		expect(res.status).toBe(200);
		expect((await readJson<Ok<PreloadResult>>(res)).data).toEqual({ messages: [], skipped: ["4000000000"] });
	});

	test("exactly 12 uids is allowed", async () => {
		const res = await preload("1:12");
		expect(res.status).toBe(200);
	});

	test.each([
		["more than 12 (range)", "1:13"],
		["more than 12 (list)", "1,2,3,4,5,6,7,8,9,10,11,12,13"],
		["star", "1:*"],
		["zero", "0"],
		["reversed range", "5:1"],
		["letters", "a,b"],
		["trailing comma", "1,2,"],
		["above uint32", "4294967296"],
	])("%s → 400", async (_name, uids) => {
		const res = await preload(uids);
		expect(res.status).toBe(400);
		expect(await readJson(res)).toEqual({ ok: false, error: "Invalid message ids.", code: "bad_request" });
	});

	test("uids > 300 chars → 400 (zod)", async () => {
		const res = await preload("1,".repeat(160) + "1");
		expect(res.status).toBe(400);
	});

	test("missing uids → 400", async () => {
		const res = await call(PRELOAD, req("/api/mail/preload?folder=INBOX"));
		expect(res.status).toBe(400);
	});
});
