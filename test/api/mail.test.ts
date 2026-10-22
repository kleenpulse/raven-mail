import { describe, expect, test } from "bun:test";
import { GET as FOLDERS } from "@/app/api/mail/folders/route";
import { GET as MESSAGES } from "@/app/api/mail/messages/route";
import { GET as MESSAGE } from "@/app/api/mail/message/route";
import { GET as PRELOAD } from "@/app/api/mail/preload/route";
import { GET as ATTACHMENT } from "@/app/api/mail/attachment/route";
import { POST as ACTIONS } from "@/app/api/mail/actions/route";
import { GET as THREAD } from "@/app/api/mail/thread/route";
import { GET as CONTACTS } from "@/app/api/mail/contacts/route";
import { devAllMessages } from "@/lib/mail/dev-store";
import { attachmentHref } from "@/lib/mail/attachment";
import { SESSION_COOKIE } from "@/lib/session";
import type { MailFolder, MailMessage, MailSummary } from "@/lib/mail/types";
import type { PreloadResult } from "@/lib/mail/preload";
import { call, readJson, req } from "../helpers/request";
import { makeSession, sessionCookie } from "../helpers/session";

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
	["attachment", ATTACHMENT, "/api/mail/attachment?folder=INBOX&uid=1&part=2"],
	["thread", THREAD, "/api/mail/thread?folder=INBOX&uid=1"],
	["contacts", CONTACTS, "/api/mail/contacts"],
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

describe("GET /api/mail/attachment", () => {
	const withFile = (filename: string) => {
		const m = devAllMessages().find((x) => x.attachments.some((a) => a.filename === filename))!;
		return { m, a: m.attachments.find((a) => a.filename === filename)! };
	};
	const get = (path: string) => call(ATTACHMENT, req(path));

	test("dev path: streams fixture bytes as a download", async () => {
		const { m, a } = withFile("invoice-1842.pdf");
		const res = await get(attachmentHref(m.folder, m.uid, a.part!));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="invoice-1842.pdf"; filename*=UTF-8''invoice-1842.pdf`,
		);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
		expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
	});

	test("dev path: an SVG is never served as an image", async () => {
		const { m, a } = withFile("critique-board.svg");
		const res = await get(attachmentHref(m.folder, m.uid, a.part!));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("content-disposition")!.startsWith("attachment;")).toBe(true);
	});

	test("dev path: a unicode name comes through RFC 5987", async () => {
		const { m, a } = withFile("Notes – Tuesday critique.txt");
		const res = await get(attachmentHref(m.folder, m.uid, a.part!));
		const header = res.headers.get("content-disposition")!;
		expect(decodeURIComponent(header.split("filename*=UTF-8''")[1]!)).toBe("Notes – Tuesday critique.txt");
		expect(res.headers.get("content-type")).toBe("text/plain");
	});

	test("unknown part or message → 404", async () => {
		const { m } = withFile("invoice-1842.pdf");
		expect((await get(attachmentHref(m.folder, m.uid, "9"))).status).toBe(404);
		expect((await get(attachmentHref("INBOX", "999999", "2"))).status).toBe(404);
		expect((await get(attachmentHref("Trash", m.uid, "2"))).status).toBe(404);
	});

	test.each([
		["missing part", "folder=INBOX&uid=1"],
		["word part", "folder=INBOX&uid=1&part=TEXT"],
		["header part", "folder=INBOX&uid=1&part=1.MIME"],
		["trailing dot", "folder=INBOX&uid=1&part=2."],
		["letters uid", "folder=INBOX&uid=abc&part=2"],
		["missing uid", "folder=INBOX&part=2"],
		["empty folder", "folder=&uid=1&part=2"],
		["newline folder", "folder=IN%0D%0ABOX&uid=1&part=2"],
	])("%s → 400", async (_name, query) => {
		const res = await get(`/api/mail/attachment?${query}`);
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("bad_request");
	});
});

describe("POST /api/mail/actions (keepalive commit)", () => {
	const post = (json: unknown, opts: Parameters<typeof req>[1] = {}) =>
		call(ACTIONS, req("/api/mail/actions", { json, ...opts }));
	const inbox = () => devAllMessages().filter((m) => m.folder === "INBOX");

	test("archives on the dev mailbox", async () => {
		const uid = inbox()[0]!.uid;
		const res = await post({ kind: "archive", folder: "INBOX", uids: [uid], destination: "Archive" });
		expect(res.status).toBe(200);
		expect(devAllMessages().find((m) => m.uid === uid)!.folder).toBe("Archive");
	});

	test("trash moves to Trash", async () => {
		const uid = inbox()[0]!.uid;
		expect((await post({ kind: "trash", folder: "INBOX", uids: [uid] })).status).toBe(200);
		expect(devAllMessages().find((m) => m.uid === uid)!.folder).toBe("Trash");
	});

	test("401 without a session", async () => {
		expect((await post({ kind: "trash", folder: "INBOX", uids: ["1"] }, { session: null })).status).toBe(401);
	});

	test("403 cross-origin", async () => {
		const res = await post({ kind: "trash", folder: "INBOX", uids: ["1"] }, { origin: "https://evil.example" });
		expect(res.status).toBe(403);
	});

	test.each([
		["unknown kind", { kind: "nuke", folder: "INBOX", uids: ["1"] }],
		["star range", { kind: "trash", folder: "INBOX", uids: ["1:*"] }],
		["no uids", { kind: "trash", folder: "INBOX", uids: [] }],
		["archive without destination", { kind: "archive", folder: "INBOX", uids: ["1"] }],
	])("400: %s", async (_name, body) => {
		const before = inbox().length;
		expect((await post(body)).status).toBe(400);
		expect(inbox()).toHaveLength(before);
	});
});

describe("GET /api/mail/thread", () => {
	type Thread = { messages: MailSummary[]; partial?: boolean };
	const thread = async (folder: string, uid: string) => {
		const res = await call(THREAD, req(`/api/mail/thread?folder=${encodeURIComponent(folder)}&uid=${uid}`));
		expect(res.status).toBe(200);
		return (await readJson<Ok<Thread>>(res)).data;
	};
	const bySubject = (subject: string, folder = "INBOX") =>
		devAllMessages().find((m) => m.subject === subject && m.folder === folder)!;

	test("header chain: Inbox plus Sent, oldest first, the archived middle left out", async () => {
		const last = bySubject("Re: Contract redlines");
		const t = await thread("INBOX", last.uid);
		expect(t.messages.map((m) => m.messageId)).toEqual([
			"<dev-redlines-1@northwind.example>",
			"<dev-redlines-3@northwind.example>",
		]);
	});

	test("server thread id: every member across Inbox and Sent, no headers needed", async () => {
		const latest = devAllMessages().find((m) => m.threadId === "dev-thread-7301" && m.folder === "INBOX" && !m.flags.seen)!;
		const t = await thread("INBOX", latest.uid);
		expect(t.messages.map((m) => [m.folder, m.subject])).toEqual([
			["INBOX", "Launch checklist"],
			["Sent", "Re: Launch checklist"],
			["INBOX", "Re: Launch checklist"],
		]);
		expect(t.messages.every((m) => m.threadId === "dev-thread-7301")).toBe(true);
	});

	test("a synthetic seed thread comes back whole and in order", async () => {
		const reply = devAllMessages().find((m) => m.folder === "INBOX" && (m.references?.length ?? 0) >= 2)!;
		const t = await thread("INBOX", reply.uid);
		expect(t.messages.length).toBeGreaterThanOrEqual(3);
		const dates = t.messages.map((m) => Date.parse(m.date));
		expect([...dates].sort((a, b) => a - b)).toEqual(dates);
		expect(t.messages.some((m) => m.folder === "Sent")).toBe(true);
		expect(t.messages.some((m) => m.uid === reply.uid)).toBe(true);
	});

	test("unknown message → 404, bad params → 400", async () => {
		expect((await call(THREAD, req("/api/mail/thread?folder=INBOX&uid=999999"))).status).toBe(404);
		expect((await call(THREAD, req("/api/mail/thread?folder=INBOX&uid=1:*"))).status).toBe(400);
		expect((await call(THREAD, req("/api/mail/thread?uid=1"))).status).toBe(400);
	});
});

describe("whole-thread actions", () => {
	const launch = () => devAllMessages().filter((m) => m.threadId === "dev-thread-7301");

	test("archiving a thread row reaches members the list never loaded (server thread id)", async () => {
		const latest = launch().find((m) => m.folder === "INBOX" && !m.flags.seen)!;
		const res = await call(
			ACTIONS,
			req("/api/mail/actions", {
				json: { kind: "archive", folder: "INBOX", uids: [latest.uid], destination: "Archive", threadIds: ["dev-thread-7301"] },
			}),
		);
		expect(res.status).toBe(200);
		expect(launch().map((m) => m.folder).sort()).toEqual(["Archive", "Archive", "Sent"]);
	});

	test("without thread ids only the listed uids move (header-chain servers)", async () => {
		const last = devAllMessages().find((m) => m.subject === "Re: Contract redlines" && m.folder === "INBOX")!;
		await call(ACTIONS, req("/api/mail/actions", { json: { kind: "trash", folder: "INBOX", uids: [last.uid] } }));
		const first = devAllMessages().find((m) => m.subject === "Contract redlines")!;
		expect(first.folder).toBe("INBOX");
	});

	test("a malformed thread id is refused", async () => {
		const res = await call(
			ACTIONS,
			req("/api/mail/actions", { json: { kind: "trash", folder: "INBOX", uids: ["1"], threadIds: ["1 OR ALL"] } }),
		);
		expect(res.status).toBe(400);
	});
});

describe("GET /api/mail/contacts", () => {
	type Contact = { name?: string; address: string; score: number };

	test("ranked people from recent mail: no self, no no-reply, best first", async () => {
		// The real dev login is dev@localhost, the seeded mailbox owner.
		const res = await call(CONTACTS, req("/api/mail/contacts", { session: makeSession({ email: "dev@localhost" }) }));
		expect(res.status).toBe(200);
		const contacts = (await readJson<Ok<Contact[]>>(res)).data;
		expect(contacts.length).toBeGreaterThan(5);
		const addresses = contacts.map((c) => c.address.toLowerCase());
		expect(addresses.some((a) => a.includes("no-reply") || a.includes("noreply"))).toBe(false);
		expect(addresses).not.toContain("dev@localhost");
		const scores = contacts.map((c) => c.score);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
		expect(contacts.some((c) => c.name)).toBe(true);
	});
});
