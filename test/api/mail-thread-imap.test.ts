import { describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";

// The real-server path of GET /api/mail/thread, with getThread stood in.

let seen: AbortSignal | undefined;
let behaviour: "hang" | "missing" = "hang";

const imap = path.resolve(import.meta.dir, "../../lib/mail/imap.ts");
const realImap = await import(imap);
mock.module(imap, () => ({
	...realImap,
	getThread: (_s: unknown, _f: string, _u: string, signal?: AbortSignal) => {
		seen = signal;
		if (behaviour === "missing") return Promise.reject(new Error("Message not found"));
		// Like a header SEARCH on a huge folder: only the abort (closing the socket) ends it.
		return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("Connection not available"))));
	},
}));
const { GET: THREAD } = await import("@/app/api/mail/thread/route");

const imapSession = () => makeSession({ dev: false });

describe("GET /api/mail/thread over IMAP", () => {
	test("the reader moving on aborts getThread and answers partial", async () => {
		behaviour = "hang";
		const ctl = new AbortController();
		const base = req("/api/mail/thread?folder=INBOX&uid=9", { session: imapSession() });
		const pending = call(THREAD, new Request(base, { signal: ctl.signal }));
		setTimeout(() => ctl.abort(), 20);
		const res = await pending;
		expect(res.status).toBe(200);
		expect((await readJson<{ data: unknown }>(res)).data).toEqual({ messages: [], partial: true });
		expect(seen?.aborted).toBe(true);
	});

	test("a real error is still an error, not a partial answer", async () => {
		behaviour = "missing";
		const res = await call(THREAD, req("/api/mail/thread?folder=INBOX&uid=9", { session: imapSession() }));
		expect(res.status).toBe(404);
		expect(seen?.aborted).toBe(false);
	});
});
