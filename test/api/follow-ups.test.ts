import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import path from "node:path";
import type { FollowUpDTO, FollowUpView } from "@/lib/follow-ups/types";
import type { MailSession } from "@/lib/session";
import { encryptSession, SESSION_COOKIE } from "@/lib/session";
import { makeSession } from "../helpers/session";
import { call, readJson, req } from "../helpers/request";
import { cookieState } from "../state";

// /api/follow-ups over an in-memory repo and the dev mailbox. The no-database path is in follow-ups-nodb.test.ts.

type Row = {
	id: string;
	accountKey: string;
	sealed: string;
	dueAt: Date;
	status: "open" | "done";
	createdAt: Date;
	updatedAt: Date;
};
let rows: Row[] = [];

const notFound = async () => {
	const { IntegrationError } = await import("@/lib/integrations/errors");
	return new IntegrationError("not_found", { message: "That reminder no longer exists." });
};

mock.module(path.resolve(import.meta.dir, "../../lib/follow-ups/repo.ts"), () => ({
	listOpenFollowUps: async (key: string) =>
		rows.filter((r) => r.accountKey === key && r.status === "open").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
	countOpenFollowUps: async (key: string) => rows.filter((r) => r.accountKey === key && r.status === "open").length,
	insertFollowUp: async (v: Pick<Row, "id" | "accountKey" | "sealed" | "dueAt">) => {
		const row: Row = { ...v, status: "open", createdAt: new Date(), updatedAt: new Date() };
		rows.push(row);
		return row;
	},
	updateFollowUp: async (key: string, id: string, patch: Partial<Pick<Row, "dueAt" | "status" | "sealed">>) => {
		const row = rows.find((r) => r.accountKey === key && r.id === id);
		if (!row) throw await notFound();
		Object.assign(row, patch, { updatedAt: new Date() });
		return row;
	},
	deleteFollowUp: async (key: string, id: string) => {
		const before = rows.length;
		rows = rows.filter((r) => !(r.accountKey === key && r.id === id));
		if (rows.length === before) throw await notFound();
	},
}));

const { GET, POST, PATCH, DELETE } = await import("@/app/api/follow-ups/route");
const { sendMessageAction } = await import("@/lib/actions/mail");
const { getOpenFollowUps } = await import("@/lib/follow-ups/service");
const { devAllMessages, devSendMessage } = await import("@/lib/mail/dev-store");

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string; code: string };

const DAY = 86_400_000;
const start = new Date("2026-10-22T10:00:00Z");
let me: MailSession;

const create = (json: unknown, session = me) => call(POST, req("/api/follow-ups", { json, session }));
const list = async (session = me) =>
	(await readJson<Ok<FollowUpView[]>>(await call(GET, req("/api/follow-ups", { session })))).data;
const patch = (json: unknown, session = me) => call(PATCH, req("/api/follow-ups", { method: "PATCH", json, session }));
const remove = (id: string, session = me) =>
	call(DELETE, req(`/api/follow-ups?id=${id}`, { method: "DELETE", session }));

function sentMessage() {
	return devAllMessages().find((m) => m.folder === "Sent" && m.messageId)!;
}

async function remindAbout(days = 1) {
	const sent = sentMessage();
	const res = await create({ folder: "Sent", uid: sent.uid, remind: { days } });
	expect(res.status).toBe(200);
	return { sent, saved: (await readJson<Ok<FollowUpDTO>>(res)).data };
}

/** A reply landing in the Inbox: mail to yourself that answers `messageId`. */
function replyTo(messageId: string) {
	devSendMessage(
		{ to: me.email, subject: "Re: plan", text: "Sounds good", inReplyTo: messageId, references: [messageId] },
		{ address: me.email },
	);
}

beforeEach(() => {
	rows = [];
	setSystemTime(start);
	me = makeSession();
});

describe("/api/follow-ups", () => {
	test("a reminder on a sent message reads the message on the server, and stays sealed", async () => {
		const { sent, saved } = await remindAbout(3);
		expect(saved).toMatchObject({ messageId: sent.messageId, subject: sent.subject, folder: "Sent", uid: sent.uid, status: "open" });
		expect(saved.dueAt).toBe(new Date(start.getTime() + 3 * DAY).toISOString());
		expect(saved.to.length).toBeGreaterThan(0);
		expect(JSON.stringify(rows)).not.toContain(sent.subject);
		expect(JSON.stringify(rows)).not.toContain(sent.messageId!);
	});

	test("not due before its time", async () => {
		await remindAbout(1);
		expect((await list()).map((f) => f.due)).toEqual([false]);
	});

	test("due once its time passes with no reply", async () => {
		await remindAbout(1);
		setSystemTime(new Date(start.getTime() + 2 * DAY));
		expect((await list()).map((f) => f.due)).toEqual([true]);
	});

	test("a reply in the Inbox closes it, so it never shows", async () => {
		const { sent, saved } = await remindAbout(1);
		setSystemTime(new Date(start.getTime() + 2 * DAY));
		replyTo(sent.messageId!);
		expect(await list()).toEqual([]);
		expect(rows.find((r) => r.id === saved.id)?.status).toBe("done");
	});

	test("a second reminder on the same message moves the first", async () => {
		const { saved } = await remindAbout(1);
		const again = await remindAbout(7);
		expect(again.saved.id).toBe(saved.id);
		expect(await list()).toHaveLength(1);
		expect((await list())[0]!.dueAt).toBe(new Date(start.getTime() + 7 * DAY).toISOString());
	});

	test("snooze moves it a day and it stops being due", async () => {
		const { saved } = await remindAbout(1);
		const later = new Date(start.getTime() + 2 * DAY);
		setSystemTime(later);
		const res = await patch({ id: saved.id, action: "snooze" });
		expect(res.status).toBe(200);
		expect((await readJson<Ok<FollowUpDTO>>(res)).data.dueAt).toBe(new Date(later.getTime() + DAY).toISOString());
		expect((await list()).map((f) => f.due)).toEqual([false]);
	});

	test("done and cancel both take it off the list", async () => {
		const first = await remindAbout(1);
		expect((await patch({ id: first.saved.id, action: "done" })).status).toBe(200);
		expect(await list()).toEqual([]);

		const second = await remindAbout(1);
		expect((await remove(second.saved.id)).status).toBe(200);
		expect(await list()).toEqual([]);
	});

	test("each mailbox sees and changes only its own", async () => {
		const { saved } = await remindAbout(1);
		const other = makeSession();
		expect(await list(other)).toEqual([]);
		expect((await patch({ id: saved.id, action: "done" }, other)).status).toBe(404);
		expect((await remove(saved.id, other)).status).toBe(404);
		expect(await list()).toHaveLength(1);
	});

	test.each([
		["a time in the past", { remind: { at: "2026-10-21T10:00:00.000Z" } }, 400],
		["over a year out", { remind: { days: 400 } }, 400],
		["a bad uid", { uid: "1:*" }, 400],
		["a missing message", { uid: "999999" }, 404],
	])("refuses %s", async (_, over, status) => {
		const sent = sentMessage();
		const res = await create({ folder: "Sent", uid: sent.uid, remind: { days: 1 }, ...over });
		expect(res.status).toBe(status);
		expect(rows).toEqual([]);
	});

	test("a message with no Message-ID can't get one: nothing to match a reply against", async () => {
		const sent = sentMessage();
		sent.messageId = undefined;
		const res = await create({ folder: "Sent", uid: sent.uid, remind: { days: 1 } });
		expect(res.status).toBe(400);
		expect((await readJson<Err>(res)).error).toBe("This message has no ID, so Raven can't spot a reply.");
	});

	test("401 without a session, 403 cross-origin", async () => {
		expect((await call(GET, req("/api/follow-ups", { session: null }))).status).toBe(401);
		const sent = sentMessage();
		const res = await call(POST, req("/api/follow-ups", { json: { folder: "Sent", uid: sent.uid, remind: { days: 1 } }, origin: "https://evil.example" }));
		expect(res.status).toBe(403);
	});
});

describe("Remind me if no reply, from compose", () => {
	function signIn() {
		cookieState.set(SESSION_COOKIE, encryptSession(me));
	}

	test("sending sets the reminder on the message that went, and finds its Sent copy when due", async () => {
		signIn();
		const res = await sendMessageAction({ draft: { to: "Maya <maya@acme.example>", subject: "Q3 plan", text: "Thoughts?", remind: { days: 3 } } });
		if (!res.ok) throw new Error(res.error);
		expect(res.data.reminder).toEqual({ ok: true, dueAt: new Date(start.getTime() + 3 * DAY).toISOString() });

		setSystemTime(new Date(start.getTime() + 4 * DAY));
		const [due] = await list();
		const copy = devAllMessages().find((m) => m.folder === "Sent" && m.messageId === res.data.messageId)!;
		expect(due).toMatchObject({ messageId: res.data.messageId, subject: "Q3 plan", to: "Maya", folder: "Sent", uid: copy.uid, due: true });
		// Saved once found, so the next load doesn't search Sent again.
		const [saved] = await getOpenFollowUps(me);
		expect(saved).toMatchObject({ id: due!.id, uid: copy.uid, subject: "Q3 plan" });
		expect(JSON.stringify(rows)).not.toContain("Q3 plan");
	});

	test("no reminder asked, none set", async () => {
		signIn();
		const res = await sendMessageAction({ draft: { to: "maya@acme.example", subject: "Hi", text: "x" } });
		if (!res.ok) throw new Error(res.error);
		expect(res.data.reminder).toBeUndefined();
		expect(rows).toEqual([]);
	});
});
