import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
	devAllMessages,
	devDeleteMessages,
	devGetAttachment,
	devGetMessage,
	devListFolders,
	devListMessages,
	devMoveMessages,
	devSaveDraft,
	devSendMessage,
	devSetFlags,
	isDevSession,
} from "@/lib/mail/dev-store";
import type { ComposeDraft } from "@/lib/mail/types";
import { makeSession } from "@/test/helpers/session";

const envVars = process.env as Record<string, string | undefined>;
const nodeEnv = envVars.NODE_ENV;
const NOW = new Date("2026-09-25T12:00:00.000Z");
const me = { address: "dev@localhost", name: "You" };

beforeEach(() => {
	setSystemTime(NOW);
});

afterEach(() => {
	if (nodeEnv === undefined) delete envVars.NODE_ENV;
	else envVars.NODE_ENV = nodeEnv;
});

const inFolder = (folder: string) => devAllMessages().filter((m) => m.folder === folder);
const folderCounts = (path: string) => devListFolders().find((f) => f.path === path)!;
const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({ to: "a@x.com", subject: "Hi", text: "Hello", ...over });

describe("isDevSession", () => {
	test("dev sessions outside production", () => {
		expect(isDevSession(makeSession())).toBe(true);
		expect(isDevSession(makeSession({ dev: false }))).toBe(false);
		expect(isDevSession({})).toBe(false);
	});

	test("never honored in production", () => {
		envVars.NODE_ENV = "production";
		expect(isDevSession(makeSession())).toBe(false);
	});

	test("only strict true counts", () => {
		expect(isDevSession({ dev: "true" as unknown as boolean })).toBe(false);
	});
});

describe("seed", () => {
	test("uids are unique and follow arrival order", () => {
		const all = devAllMessages().sort((a, b) => Number(a.uid) - Number(b.uid));
		expect(new Set(all.map((m) => m.uid)).size).toBe(all.length);
		for (let i = 1; i < all.length; i++) expect(Date.parse(all[i]!.date)).toBeGreaterThanOrEqual(Date.parse(all[i - 1]!.date));
	});

	test("devAllMessages returns a copy of the list", () => {
		const list = devAllMessages();
		list.length = 0;
		expect(devAllMessages().length).toBeGreaterThan(0);
	});

	test("store resets between tests (fresh seed)", () => {
		devMoveMessages("INBOX", inFolder("INBOX").map((m) => m.uid), "Archive");
		expect(inFolder("INBOX")).toHaveLength(0);
	});

	test("…and is back here", () => {
		expect(inFolder("INBOX").length).toBeGreaterThan(0);
	});
});

describe("devListFolders", () => {
	test("six special folders with live counts", () => {
		const folders = devListFolders();
		expect(folders.map((f) => f.path)).toEqual(["INBOX", "Sent", "Drafts", "Archive", "Junk", "Trash"]);
		for (const f of folders) {
			const msgs = inFolder(f.path);
			expect(f.total).toBe(msgs.length);
			expect(f.unread).toBe(msgs.filter((m) => !m.flags.seen).length);
		}
		expect(folderCounts("INBOX").unread).toBeGreaterThan(0);
	});
});

describe("devListMessages", () => {
	test("newest first, count is the whole folder, default limit 40", () => {
		const { messages, count } = devListMessages("INBOX");
		expect(count).toBe(inFolder("INBOX").length);
		expect(messages.length).toBe(Math.min(40, count));
		const times = messages.map((m) => Date.parse(m.date));
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	test("limit is capped at 100", () => {
		expect(devListMessages("INBOX", { limit: 1000 }).messages.length).toBeLessThanOrEqual(100);
		expect(devListMessages("INBOX", { limit: 3 }).messages).toHaveLength(3);
	});

	test("`before` pages by uid without changing count", () => {
		const first = devListMessages("INBOX", { limit: 5 });
		const cursor = Math.min(...first.messages.map((m) => Number(m.uid)));
		const next = devListMessages("INBOX", { limit: 5, before: cursor });
		expect(next.count).toBe(first.count);
		for (const m of next.messages) expect(Number(m.uid)).toBeLessThan(cursor);
	});

	test("summaries carry a whitespace-collapsed preview ≤ 220 chars", () => {
		for (const m of devListMessages("INBOX", { limit: 100 }).messages) {
			expect(m.preview.length).toBeLessThanOrEqual(220);
			expect(m.preview).not.toMatch(/\s{2}|\n/);
		}
	});

	test("search narrows the list and counts matches", () => {
		const hit = devListMessages("INBOX", { search: "Q3 roadmap" });
		expect(hit.count).toBeGreaterThan(0);
		expect(hit.count).toBeLessThan(inFolder("INBOX").length);
		expect(hit.messages.some((m) => m.subject.includes("Q3 roadmap"))).toBe(true);
	});

	test("blank search is ignored", () => {
		expect(devListMessages("INBOX", { search: "   " }).count).toBe(inFolder("INBOX").length);
	});

	test("unknown folder → empty", () => {
		expect(devListMessages("Nope")).toEqual({ messages: [], count: 0 });
	});
});

describe("devGetMessage", () => {
	test("finds by folder + uid, throws otherwise", () => {
		const m = inFolder("INBOX")[0]!;
		expect(devGetMessage("INBOX", m.uid)).toBe(m);
		expect(() => devGetMessage("Sent", m.uid)).toThrow("Message not found");
		expect(() => devGetMessage("INBOX", "999999")).toThrow("Message not found");
	});
});

describe("devSetFlags", () => {
	test("sets only the given flags on the given uids in that folder", () => {
		const unread = inFolder("INBOX").filter((m) => !m.flags.seen);
		const [a, b] = unread;
		const before = folderCounts("INBOX").unread;
		const flaggedBefore = b!.flags.flagged;
		devSetFlags("INBOX", [a!.uid], { seen: true });
		expect(devGetMessage("INBOX", a!.uid).flags.seen).toBe(true);
		expect(devGetMessage("INBOX", b!.uid).flags.seen).toBe(false);
		expect(folderCounts("INBOX").unread).toBe(before - 1);

		devSetFlags("INBOX", [b!.uid], { flagged: !flaggedBefore, answered: true });
		expect(devGetMessage("INBOX", b!.uid).flags).toMatchObject({ seen: false, flagged: !flaggedBefore, answered: true });
	});

	test("uids from another folder are ignored", () => {
		const m = inFolder("INBOX").find((x) => !x.flags.seen)!;
		devSetFlags("Sent", [m.uid], { seen: true });
		expect(m.flags.seen).toBe(false);
	});
});

describe("devMoveMessages", () => {
	test("moves only matching uids from the source folder", () => {
		const [a, b] = inFolder("INBOX");
		devMoveMessages("INBOX", [a!.uid, "999999"], "Archive");
		expect(devGetMessage("Archive", a!.uid)).toBe(a!);
		expect(devGetMessage("INBOX", b!.uid)).toBe(b!);
	});

	test("wrong source folder is a no-op", () => {
		const a = inFolder("INBOX")[0]!;
		devMoveMessages("Sent", [a.uid], "Archive");
		expect(a.folder).toBe("INBOX");
	});
});

describe("devDeleteMessages", () => {
	test("moves to Trash", () => {
		const a = inFolder("INBOX")[0]!;
		const total = devAllMessages().length;
		devDeleteMessages("INBOX", [a.uid], "Trash");
		expect(a.folder).toBe("Trash");
		expect(devAllMessages()).toHaveLength(total);
	});

	test("deleting inside Trash removes for good", () => {
		const t = inFolder("Trash")[0]!;
		const total = devAllMessages().length;
		devDeleteMessages("Trash", [t.uid], "Trash");
		expect(devAllMessages()).toHaveLength(total - 1);
		expect(() => devGetMessage("Trash", t.uid)).toThrow();
	});

	test("no trash folder → removes for good", () => {
		const a = inFolder("INBOX")[0]!;
		devDeleteMessages("INBOX", [a.uid], null);
		expect(devAllMessages().some((m) => m.uid === a.uid)).toBe(false);
	});
});

describe("devSendMessage", () => {
	test("lands in Sent, seen, newest, with parsed recipients", () => {
		const sentBefore = folderCounts("Sent").total;
		const { messageId } = devSendMessage(
			draft({ to: "Maya Chen <maya@x.com>, b@y.org", cc: "c@z.com; ", bcc: "d@z.com", subject: "Plan" }),
			me,
		);
		expect(messageId).toMatch(/^<dev-\d+@localhost>$/);
		expect(folderCounts("Sent").total).toBe(sentBefore + 1);
		const top = devListMessages("Sent", { limit: 1 }).messages[0]!;
		expect(top.messageId).toBe(messageId);
		expect(top.subject).toBe("Plan");
		expect(top.date).toBe(NOW.toISOString());
		const full = devGetMessage("Sent", top.uid);
		expect(full.flags).toEqual({ seen: true, flagged: false, answered: false, draft: false });
		expect(full.from).toEqual(me);
		expect(full.to).toEqual([{ address: "maya@x.com", name: "Maya Chen" }, { address: "b@y.org" }]);
		expect(full.cc).toEqual([{ address: "c@z.com" }]);
		expect(full.bcc).toEqual([{ address: "d@z.com" }]);
	});

	test("gets a fresh uid above every seeded one", () => {
		const max = Math.max(...devAllMessages().map((m) => Number(m.uid)));
		devSendMessage(draft(), me);
		const second = devSendMessage(draft(), me);
		expect(second.messageId).toBe(`<dev-${max + 2}@localhost>`);
	});

	test("escapes the body into HTML paragraphs", () => {
		devSendMessage(draft({ text: `<script>alert("x")</script> & co\n\nline 2\nline 3` }), me);
		const m = devGetMessage("Sent", devListMessages("Sent", { limit: 1 }).messages[0]!.uid);
		expect(m.html).toBe(`<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co</p><p>line 2<br>line 3</p>`);
		expect(m.text).toContain("<script>");
	});

	test("keeps the editor's HTML when compose sends one", () => {
		devSendMessage(draft({ text: "- a", html: "<ul><li><p><strong>a</strong></p></li></ul>" }), me);
		const m = devGetMessage("Sent", devListMessages("Sent", { limit: 1 }).messages[0]!.uid);
		expect(m.html).toBe("<ul><li><p><strong>a</strong></p></li></ul>");
		expect(m.text).toBe("- a");
	});

	test("empty subject becomes (no subject); reply headers kept", () => {
		devSendMessage(draft({ subject: "", inReplyTo: "<a@x>", references: ["<a@x>"] }), me);
		const m = devGetMessage("Sent", devListMessages("Sent", { limit: 1 }).messages[0]!.uid);
		expect(m.subject).toBe("(no subject)");
		expect(m.inReplyTo).toBe("<a@x>");
		expect(m.references).toEqual(["<a@x>"]);
	});

	test("attachment sizes come from the base64 length", () => {
		devSendMessage(
			draft({ attachments: [{ filename: "a.txt", contentType: "text/plain", contentBase64: "aGVsbG8gd29ybGQh" }] }),
			me,
		);
		const m = devGetMessage("Sent", devListMessages("Sent", { limit: 1 }).messages[0]!.uid);
		expect(m.attachments).toEqual([{ filename: "a.txt", contentType: "text/plain", size: 12, part: "2" }]);
	});

	test("sent attachments download as the bytes that were uploaded, in Sent and the self copy", () => {
		const file = { filename: "a.txt", contentType: "text/plain", contentBase64: "aGVsbG8gd29ybGQh" };
		devSendMessage(draft({ to: me.address, attachments: [file] }), me);
		for (const folder of ["Sent", "INBOX"]) {
			const uid = devListMessages(folder, { limit: 1 }).messages[0]!.uid;
			const { meta, bytes } = devGetAttachment(folder, uid, "2");
			expect(meta.filename).toBe("a.txt");
			expect(new TextDecoder().decode(bytes)).toBe("hello world!");
		}
	});

	test.each(["", "   "])("refuses without recipients (%p)", (to) => {
		const total = devAllMessages().length;
		expect(() => devSendMessage(draft({ to }), me)).toThrow("Add at least one recipient.");
		expect(devAllMessages()).toHaveLength(total);
	});
});

describe("devGetAttachment", () => {
	const seeded = () => devAllMessages().filter((m) => m.attachments.length > 0);

	test("every seeded attachment has a section and real bytes", () => {
		const all = seeded();
		expect(all.length).toBeGreaterThan(5);
		for (const m of all) {
			for (const a of m.attachments) {
				expect(a.part).toMatch(/^\d+$/);
				expect(devGetAttachment(m.folder, m.uid, a.part!).bytes.byteLength).toBeGreaterThan(0);
			}
		}
	});

	test("fixtures open as their type", () => {
		const find = (type: string) => {
			const m = seeded().find((x) => x.attachments.some((a) => a.contentType === type))!;
			const a = m.attachments.find((x) => x.contentType === type)!;
			return devGetAttachment(m.folder, m.uid, a.part!).bytes;
		};
		const text = (b: Uint8Array) => new TextDecoder().decode(b);
		const pdf = text(find("application/pdf"));
		expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
		// startxref must point at the xref table, or viewers have to repair the file
		const at = Number(pdf.match(/startxref\n(\d+)/)![1]);
		expect(pdf.slice(at, at + 4)).toBe("xref");
		expect([...find("image/png").slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(text(find("text/calendar"))).toContain("BEGIN:VCALENDAR");
	});

	test("unknown parts and messages throw not found", () => {
		const m = seeded()[0]!;
		expect(() => devGetAttachment(m.folder, m.uid, "99")).toThrow("Attachment not found");
		expect(() => devGetAttachment(m.folder, "999999", "2")).toThrow("Message not found");
	});
});

describe("devSaveDraft", () => {
	test("saves into Drafts with the draft flag, even without recipients", () => {
		const before = folderCounts("Drafts").total;
		const { uid } = devSaveDraft(draft({ to: "", subject: "WIP" }), me);
		const m = devGetMessage("Drafts", uid);
		expect(m.flags).toEqual({ seen: true, flagged: false, answered: false, draft: true });
		expect(m.subject).toBe("WIP");
		expect(m.to).toEqual([]);
		expect(folderCounts("Drafts").total).toBe(before + 1);
	});

	test("replacing: the new copy lands before the old one goes, and the count holds", () => {
		const first = devSaveDraft(draft({ text: "v1" }), me).uid;
		const before = folderCounts("Drafts").total;
		const second = devSaveDraft(draft({ text: "v2" }), me, first).uid;
		expect(second).not.toBe(first);
		expect(folderCounts("Drafts").total).toBe(before);
		expect(devGetMessage("Drafts", second).text).toBe("v2");
		expect(() => devGetMessage("Drafts", first)).toThrow("Message not found");
	});

	test("replacing only ever removes from Drafts", () => {
		const inboxUid = inFolder("INBOX")[0]!.uid;
		devSaveDraft(draft(), me, inboxUid);
		expect(devGetMessage("INBOX", inboxUid)).toBeDefined();
	});

	test("Bcc is kept on the saved copy", () => {
		const { uid } = devSaveDraft(draft({ bcc: "hidden@x.com" }), me);
		expect(devGetMessage("Drafts", uid).bcc).toEqual([{ address: "hidden@x.com" }]);
	});
});
