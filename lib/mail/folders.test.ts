import { describe, expect, test } from "bun:test";
import { folderSpecialUse, labelSpecialUse, resolveSpecialFolder, shortFolderName } from "@/lib/mail/folders";
import type { MailFolder } from "@/lib/mail/types";

const folder = (path: string, specialUse?: MailFolder["specialUse"], delimiter = "/"): MailFolder => ({
	path,
	name: path,
	delimiter,
	specialUse,
	unread: 0,
	total: 0,
});

describe("labelSpecialUse", () => {
	test.each([
		["INBOX", "\\Inbox"],
		["inbox", "\\Inbox"],
		["Sent", "\\Sent"],
		["Sent Items", "\\Sent"],
		["[Gmail]/Sent Mail", "\\Sent"],
		["Outbox", "\\Sent"],
		["Drafts", "\\Drafts"],
		["Draft", "\\Drafts"],
		["Trash", "\\Trash"],
		["Deleted Items", "\\Trash"],
		["Bin", "\\Trash"],
		["Corbeille", "\\Trash"],
		["Junk", "\\Junk"],
		["Spam", "\\Junk"],
		["Junk E-mail", "\\Junk"],
		["Archive", "\\Archive"],
		["Archives", "\\Archive"],
		["[Gmail]/All Mail", "\\Archive"],
		["Projects", undefined],
		["Receipts", undefined],
	])("%p → %p", (path, role) => {
		expect(labelSpecialUse(path, "/")).toBe(role as MailFolder["specialUse"]);
	});

	test("matches the last path segment with the server's delimiter", () => {
		expect(labelSpecialUse("INBOX.Sent", ".")).toBe("\\Sent");
		expect(labelSpecialUse("INBOX.Sent", "/")).toBe("\\Sent"); // suffix match still hits
		expect(labelSpecialUse("Work/INBOX", "/")).toBe("\\Inbox");
		expect(labelSpecialUse("INBOX/Work", "/")).toBeUndefined();
	});

	// BUG: lib/mail/folders.ts:5-6 — the Sent/Trash patterns aren't anchored at a word start
	// and Sent is tried before Drafts, so "Unsent" (listed in the Drafts pattern) resolves to
	// \Sent, and ordinary folders like "Consent" or "Cabin" get system roles.
	test.todo("BUG: 'Unsent' is Drafts; 'Consent' / 'Cabin' have no role", () => {
		expect(labelSpecialUse("Unsent", "/")).toBe("\\Drafts");
		expect(labelSpecialUse("Consent", "/")).toBeUndefined();
		expect(labelSpecialUse("Cabin", "/")).toBeUndefined();
	});

	test("Inbox requires an exact name", () => {
		expect(labelSpecialUse("Old Inbox", "/")).toBeUndefined();
	});

	test("a declared special-use flag wins over the name", () => {
		expect(labelSpecialUse("Projects", "/", "\\Archive")).toBe("\\Archive");
		expect(labelSpecialUse("Sent", "/", "\\Trash")).toBe("\\Trash");
	});

	test("unknown declared flags fall back to name matching", () => {
		expect(labelSpecialUse("Sent", "/", "\\Flagged")).toBe("\\Sent");
		expect(labelSpecialUse("Projects", "/", "\\All")).toBeUndefined();
		expect(labelSpecialUse("Trash", "/", "")).toBe("\\Trash");
	});
});

describe("shortFolderName", () => {
	test.each([
		["INBOX", "/", "INBOX"],
		["[Gmail]/Sent Mail", "/", "Sent Mail"],
		["INBOX.Work.2026", ".", "2026"],
		["a/b", ".", "a/b"],
		["trailing/", "/", ""],
	])("(%p, %p) → %p", (path, delimiter, out) => {
		expect(shortFolderName(path, delimiter)).toBe(out);
	});
});

describe("resolveSpecialFolder", () => {
	test("prefers the flagged folder over a name match", () => {
		const folders = [folder("Trash"), folder("[Gmail]/Bin", "\\Trash")];
		expect(resolveSpecialFolder(folders, "\\Trash")).toBe("[Gmail]/Bin");
	});

	test("falls back to a name match", () => {
		expect(resolveSpecialFolder([folder("INBOX"), folder("Deleted Items")], "\\Trash")).toBe("Deleted Items");
		expect(resolveSpecialFolder([folder("INBOX.Spam", undefined, ".")], "\\Junk")).toBe("INBOX.Spam");
	});

	test("null when nothing matches", () => {
		expect(resolveSpecialFolder([folder("INBOX"), folder("Work")], "\\Archive")).toBeNull();
		expect(resolveSpecialFolder([], "\\Sent")).toBeNull();
	});
});

describe("folderSpecialUse", () => {
	const folders = [folder("INBOX", "\\Inbox"), folder("Posted", "\\Sent"), folder("Old Trash"), folder("Work")];

	test("flag on the listed folder", () => {
		expect(folderSpecialUse(folders, "Posted")).toBe("\\Sent");
	});

	test("listed but unflagged → name match", () => {
		expect(folderSpecialUse(folders, "Old Trash")).toBe("\\Trash");
		expect(folderSpecialUse(folders, "Work")).toBeUndefined();
	});

	test("not listed (or no list yet) → name match with '/'", () => {
		expect(folderSpecialUse(folders, "[Gmail]/Spam")).toBe("\\Junk");
		expect(folderSpecialUse(undefined, "Drafts")).toBe("\\Drafts");
		expect(folderSpecialUse(undefined, "Projects")).toBeUndefined();
	});
});
