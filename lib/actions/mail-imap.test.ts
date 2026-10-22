import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { encryptSession, SESSION_COOKIE } from "@/lib/session";
import type { ComposeDraft } from "@/lib/mail/types";
import { makeSession } from "@/test/helpers/session";
import { cookieState } from "@/test/state";

// The real-server path of saveDraftAction / sendMessageAction, with the IMAP layer recorded.

const calls: string[] = [];
let appendUid: string | undefined;
let searchUid: string | null;
let appendFails = false;
let rawSaved = "";

const imap = path.resolve(import.meta.dir, "../mail/imap.ts");
const realImap = await import(imap);
mock.module(imap, () => ({
	...realImap,
	resolveSpecial: async (_s: unknown, role: string) => (role === "\\Drafts" ? "Drafts" : "Sent"),
	appendRaw: async (_s: unknown, mailbox: string, raw: Buffer) => {
		calls.push(`append ${mailbox}`);
		if (appendFails) throw new Error("NO [OVERQUOTA]");
		rawSaved = raw.toString();
		return appendUid ? { uid: appendUid } : {};
	},
	findUidByMessageId: async (_s: unknown, folder: string, mid: string) => {
		calls.push(`search ${folder} ${mid.startsWith("<") ? "<mid>" : mid}`);
		return searchUid;
	},
	deleteMessages: async (_s: unknown, folder: string, uids: string[], trash: string | null) => {
		calls.push(`delete ${folder} ${uids.join(",")} trash=${trash}`);
	},
	setFlags: async (_s: unknown, folder: string, uids: string[], changes: { add?: string[] }) => {
		calls.push(`flag ${folder} ${uids.join(",")} ${changes.add?.join(",")}`);
	},
}));

const smtp = path.resolve(import.meta.dir, "../mail/smtp.ts");
const realSmtp = await import(smtp);
mock.module(smtp, () => ({
	...realSmtp,
	sendRaw: async () => {
		calls.push("smtp send");
		return "<sent@x>";
	},
	serverSavesSentCopy: () => true,
}));

const { saveDraftAction, sendMessageAction } = await import("@/lib/actions/mail");

const draft: ComposeDraft = { to: "a@x.com", bcc: "secret@x.com", subject: "Plan", text: "hello" };

beforeEach(() => {
	calls.length = 0;
	appendUid = undefined;
	searchUid = null;
	appendFails = false;
	rawSaved = "";
	cookieState.set(SESSION_COOKIE, encryptSession(makeSession({ dev: false })));
});

describe("saveDraftAction over IMAP", () => {
	test("appends first, then deletes the copy it replaces, in Drafts, for good", async () => {
		appendUid = "42";
		const res = await saveDraftAction({ draft, draftUid: "41" });
		expect(res).toEqual({ ok: true, data: { uid: "42" } });
		expect(calls).toEqual(["append Drafts", "delete Drafts 41 trash=null"]);
	});

	test("keeps Bcc in the saved copy, so a reopened draft still has it", async () => {
		appendUid = "42";
		await saveDraftAction({ draft });
		expect(rawSaved).toMatch(/^Bcc: secret@x\.com/m);
	});

	test("without UIDPLUS, finds the new copy by its Message-ID", async () => {
		searchUid = "77";
		const res = await saveDraftAction({ draft, draftUid: "41" });
		expect(res).toEqual({ ok: true, data: { uid: "77" } });
		expect(calls).toEqual(["append Drafts", "search Drafts <mid>", "delete Drafts 41 trash=null"]);
	});

	test("if the new copy can't be found, the old one still goes and no uid comes back", async () => {
		const res = await saveDraftAction({ draft, draftUid: "41" });
		expect(res).toEqual({ ok: true, data: { uid: undefined } });
		expect(calls.at(-1)).toBe("delete Drafts 41 trash=null");
	});

	test("a failed append never deletes the old copy", async () => {
		appendFails = true;
		const res = await saveDraftAction({ draft, draftUid: "41" });
		expect(res.ok).toBe(false);
		expect(calls).toEqual(["append Drafts"]);
	});
});

describe("sendMessageAction over IMAP", () => {
	test("sent mail never carries the Bcc header", async () => {
		const realBuild = realSmtp.buildRawMessage as typeof import("@/lib/mail/smtp").buildRawMessage;
		const { raw } = await realBuild(makeSession({ dev: false }), draft);
		expect(raw.toString()).not.toMatch(/^Bcc:/im);
	});

	test("removes the draft copy only after the message is sent", async () => {
		const res = await sendMessageAction({ draft, draftUid: "41" });
		expect(res.ok).toBe(true);
		expect(calls).toEqual(["smtp send", "delete Drafts 41 trash=null"]);
	});
});

describe("sendMessageAction over IMAP: \\Answered", () => {
	test("with a source, flags it directly", async () => {
		await sendMessageAction({ draft: { ...draft, source: { folder: "Work", uid: "9" } } });
		expect(calls).toContain("flag Work 9 \\Answered");
	});

	test("without one, finds the original in INBOX by In-Reply-To", async () => {
		searchUid = "55";
		await sendMessageAction({ draft: { ...draft, inReplyTo: "<orig@x>" } });
		expect(calls).toEqual(["smtp send", "search INBOX <mid>", "flag INBOX 55 \\Answered"]);
	});

	test("nothing found, nothing flagged", async () => {
		await sendMessageAction({ draft: { ...draft, inReplyTo: "<orig@x>" } });
		expect(calls.some((c) => c.startsWith("flag"))).toBe(false);
	});
});
