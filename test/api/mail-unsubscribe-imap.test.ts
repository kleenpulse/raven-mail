import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { IntegrationError } from "@/lib/integrations/errors";
import type { Outbound } from "@/lib/integrations/http";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";

// The real-server path of POST /api/mail/unsubscribe, with IMAP and the outbound socket stood in.

const ONE_CLICK = {
	"list-unsubscribe": "<https://reads.example/u/abc>, <mailto:leave@reads.example>",
	"list-unsubscribe-post": "List-Unsubscribe=One-Click",
};

let headers: Record<string, string> | Error = ONE_CLICK;
let answer: number | Error = 200;
const sent: Outbound[] = [];

const imap = path.resolve(import.meta.dir, "../../lib/mail/imap.ts");
const realImap = await import(imap);
mock.module(imap, () => ({
	...realImap,
	getUnsubscribeHeaders: async () => {
		if (headers instanceof Error) throw headers;
		return headers;
	},
}));

const safe = path.resolve(import.meta.dir, "../../lib/integrations/safe-fetch.ts");
const realSafe = await import(safe);
mock.module(safe, () => ({
	...realSafe,
	safeFetch: async (outbound: Outbound) => {
		sent.push(outbound);
		if (answer instanceof Error) throw answer;
		return { status: answer, headers: {}, body: "", ms: 1 };
	},
}));

const { POST: UNSUBSCRIBE } = await import("@/app/api/mail/unsubscribe/route");

type Err = { ok: false; error: string; code: string };
const post = (json: unknown) =>
	call(UNSUBSCRIBE, req("/api/mail/unsubscribe", { json, session: makeSession({ dev: false }) }));

beforeEach(() => {
	headers = ONE_CLICK;
	answer = 200;
	sent.length = 0;
});

describe("POST /api/mail/unsubscribe over IMAP", () => {
	test("POSTs List-Unsubscribe=One-Click to the target in the message's own headers", async () => {
		const res = await post({ folder: "INBOX", uid: "7", url: "https://evil.example/ignored" });
		expect(res.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.method).toBe("POST");
		expect(sent[0]!.url.href).toBe("https://reads.example/u/abc");
		expect(sent[0]!.body).toBe("List-Unsubscribe=One-Click");
		expect(sent[0]!.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
		expect(sent[0]!.headers).not.toHaveProperty("cookie");
	});

	test("a redirect answer counts as done", async () => {
		answer = 303;
		expect((await post({ folder: "INBOX", uid: "7" })).status).toBe(200);
	});

	test("no List-Unsubscribe-Post: 400, and nothing is sent", async () => {
		headers = { "list-unsubscribe": ONE_CLICK["list-unsubscribe"] };
		const res = await post({ folder: "INBOX", uid: "7" });
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).code).toBe("no_one_click");
		expect(sent).toHaveLength(0);
	});

	test.each([
		["a 4xx answer", 404, "unsubscribe_failed"],
		["a 5xx answer", 500, "unsubscribe_failed"],
		["a private address", new IntegrationError("private_address"), "unsubscribe_failed"],
		["a timeout before the body went out", new IntegrationError("timeout"), "unsubscribe_failed"],
		["a timeout after it went out", new IntegrationError("unconfirmed"), "unsubscribe_unconfirmed"],
	])("%s → 502 %s", async (_, outcome, code) => {
		answer = outcome;
		const res = await post({ folder: "INBOX", uid: "7" });
		expect(res.status).toBe(502);
		expect((await readJson<Err>(res)).code).toBe(code);
	});

	test("a missing message is a 404", async () => {
		headers = new Error("Message not found");
		expect((await post({ folder: "INBOX", uid: "7" })).status).toBe(404);
		expect(sent).toHaveLength(0);
	});
});
