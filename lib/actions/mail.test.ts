import { describe, expect, test } from "bun:test";
import { discardDraftAction, saveDraftAction, sendMessageAction } from "@/lib/actions/mail";
import { devAllMessages, devGetMessage } from "@/lib/mail/dev-store";
import { encryptSession, SESSION_COOKIE } from "@/lib/session";
import type { ComposeDraft } from "@/lib/mail/types";
import { makeSession } from "@/test/helpers/session";
import { cookieState } from "@/test/state";

// Dev mailbox end to end. The IMAP ordering lives in mail-imap.test.ts.

function signIn() {
	const session = makeSession();
	cookieState.set(SESSION_COOKIE, encryptSession(session));
	return session;
}

const drafts = () => devAllMessages().filter((m) => m.folder === "Drafts");
const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
	to: "a@x.com",
	cc: "c@x.com",
	bcc: "secret@x.com",
	subject: "Plan",
	text: "v1",
	...over,
});

async function save(over: Partial<ComposeDraft> = {}, draftUid?: string): Promise<string> {
	const res = await saveDraftAction({ draft: draft(over), draftUid });
	if (!res.ok) throw new Error(res.error);
	return res.data.uid!;
}

describe("saveDraftAction", () => {
	test("each save replaces the copy it came from, so drafts don't pile up", async () => {
		signIn();
		const before = drafts().length;
		const first = await save({ text: "v1" });
		const second = await save({ text: "v2" }, first);
		const third = await save({ text: "v3" }, second);
		expect(drafts()).toHaveLength(before + 1);
		expect(new Set([first, second, third]).size).toBe(3);
		expect(() => devGetMessage("Drafts", first)).toThrow();
		expect(() => devGetMessage("Drafts", second)).toThrow();
		const kept = devGetMessage("Drafts", third);
		expect(kept.text).toBe("v3");
		expect(kept.bcc.map((a) => a.address)).toEqual(["secret@x.com"]);
	});

	test("without a draftUid it adds a copy", async () => {
		signIn();
		const before = drafts().length;
		await save();
		await save();
		expect(drafts()).toHaveLength(before + 2);
	});

	test("never touches anything outside Drafts", async () => {
		signIn();
		const inbox = devAllMessages().find((m) => m.folder === "INBOX")!;
		await save({}, inbox.uid);
		expect(devGetMessage("INBOX", inbox.uid)).toBeDefined();
	});

	test.each(["1:*", "abc", "1,2", ""])("refuses a malformed draftUid (%p)", async (draftUid) => {
		signIn();
		const before = drafts().length;
		const res = await saveDraftAction({ draft: draft(), draftUid });
		expect(res.ok).toBe(false);
		expect(drafts()).toHaveLength(before);
	});
});

describe("sendMessageAction", () => {
	test("sending a saved draft deletes its Drafts copy", async () => {
		signIn();
		const uid = await save();
		const before = drafts().length;
		const res = await sendMessageAction({ draft: draft(), draftUid: uid });
		expect(res.ok).toBe(true);
		expect(drafts()).toHaveLength(before - 1);
		expect(() => devGetMessage("Drafts", uid)).toThrow();
	});

	test("a failed send keeps the draft", async () => {
		signIn();
		const uid = await save();
		const res = await sendMessageAction({ draft: draft({ to: " " }), draftUid: uid });
		expect(res.ok).toBe(false);
		expect(devGetMessage("Drafts", uid).text).toBe("v1");
	});

	test("refuses a malformed draftUid before sending anything", async () => {
		signIn();
		const sent = devAllMessages().filter((m) => m.folder === "Sent").length;
		const res = await sendMessageAction({ draft: draft(), draftUid: "1:*" });
		expect(res.ok).toBe(false);
		expect(devAllMessages().filter((m) => m.folder === "Sent")).toHaveLength(sent);
	});
});

describe("discardDraftAction", () => {
	test("deletes the server copy for good, not to Trash", async () => {
		signIn();
		const uid = await save({ subject: "Throwaway" });
		const trash = devAllMessages().filter((m) => m.folder === "Trash").length;
		expect((await discardDraftAction({ draftUid: uid })).ok).toBe(true);
		expect(() => devGetMessage("Drafts", uid)).toThrow();
		expect(devAllMessages().filter((m) => m.folder === "Trash")).toHaveLength(trash);
		expect(devAllMessages().some((m) => m.subject === "Throwaway")).toBe(false);
	});

	test("refuses a malformed uid", async () => {
		signIn();
		expect((await discardDraftAction({ draftUid: "1:*" })).ok).toBe(false);
	});
});

describe("sendMessageAction: \\Answered", () => {
	test("a reply reopened from Drafts (no source) still flags the original by In-Reply-To", async () => {
		signIn();
		const original = devAllMessages().find((m) => m.folder === "INBOX" && !m.flags.answered && m.messageId)!;
		const res = await sendMessageAction({
			draft: draft({ subject: `Re: ${original.subject}`, inReplyTo: original.messageId }),
		});
		expect(res.ok).toBe(true);
		expect(devGetMessage("INBOX", original.uid).flags.answered).toBe(true);
	});

	test("a malformed In-Reply-To flags nothing", async () => {
		signIn();
		const answered = () => devAllMessages().filter((m) => m.flags.answered).length;
		const before = answered();
		await sendMessageAction({ draft: draft({ inReplyTo: "not an id" }) });
		expect(answered()).toBe(before);
	});
});

describe("sendMessageAction with Remind me if no reply", () => {
	test("without a database the message still goes, and the reminder says why it wasn't set", async () => {
		signIn();
		const before = devAllMessages().filter((m) => m.folder === "Sent").length;
		const res = await sendMessageAction({ draft: draft({ remind: { days: 3 } }) });
		if (!res.ok) throw new Error(res.error);
		expect(devAllMessages().filter((m) => m.folder === "Sent")).toHaveLength(before + 1);
		expect(res.data.reminder).toEqual({
			ok: false,
			error: "Rules, blocked senders and reminders need a database.",
			hint: "Set DATABASE_URL, then run bun run db:migrate.",
		});
	});

	test("a picked time that has passed by send time sets nothing", async () => {
		signIn();
		const res = await sendMessageAction({ draft: draft({ remind: { at: "2020-01-01T00:00:00.000Z" } }) });
		if (!res.ok) throw new Error(res.error);
		expect(res.data.reminder).toEqual({ ok: false, error: "The reminder time had passed, so no reminder was set." });
	});
});
