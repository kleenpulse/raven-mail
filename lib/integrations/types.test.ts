import { describe, expect, test } from "bun:test";
import {
	BRIEF_MAX,
	briefItemSchema,
	checkInputSchema,
	connectInputSchema,
	exportChunkSchema,
	exportPlanSchema,
	logExportSchema,
	NOTE_MAX,
	PREVIEW_MAX,
	sendBriefSchema,
	shareEmailSchema,
	sharedEmailSchema,
} from "@/lib/integrations/types";

const UUID = "0b8f2a3c-6d1e-4f5a-9b7c-2e3d4f5a6b7c";

const email = {
	folder: "INBOX",
	uid: "42",
	messageId: "<m@x>",
	subject: "Hi",
	from: { name: "Maya", address: "maya@x.com" },
	date: "2026-09-25T12:00:00Z",
	preview: "hello",
};

const item = { folder: "INBOX", uid: "42", subject: "Hi", from: { name: "", address: "a@x" }, why: ["Asked you a question"] };

describe("connectInputSchema", () => {
	test("accepts and trims", () => {
		expect(connectInputSchema.parse({ kind: "slack", url: "  https://hooks.slack.com/x  ", label: " #room " })).toEqual({
			kind: "slack",
			url: "https://hooks.slack.com/x",
			label: "#room",
		});
	});

	test("optional fields", () => {
		expect(connectInputSchema.safeParse({ kind: "webhook", url: "https://x", signed: false, replaceId: UUID }).success).toBe(true);
	});

	test.each([
		["unknown kind", { kind: "teams", url: "https://x" }],
		["blank url", { kind: "slack", url: "   " }],
		["url too long", { kind: "slack", url: `https://x/${"a".repeat(2048)}` }],
		["label too long", { kind: "slack", url: "https://x", label: "x".repeat(61) }],
		["non-uuid replaceId", { kind: "slack", url: "https://x", replaceId: "123" }],
		["signed not boolean", { kind: "webhook", url: "https://x", signed: "yes" }],
	])("rejects %s", (_, input) => {
		expect(connectInputSchema.safeParse(input).success).toBe(false);
	});

	test("friendly messages", () => {
		expect(connectInputSchema.safeParse({ kind: "slack", url: "" }).error?.issues[0]?.message).toBe("Paste the webhook URL.");
		expect(connectInputSchema.safeParse({ kind: "slack", url: "h".repeat(2049) }).error?.issues[0]?.message).toBe(
			"That URL is too long.",
		);
	});
});

describe("checkInputSchema", () => {
	test.each([{ target: "mail" }, { target: "jev" }, { id: UUID }])("accepts %p", (input) => {
		expect(checkInputSchema.safeParse(input).success).toBe(true);
	});

	test.each([{ target: "slack" }, { id: "nope" }, {}, null])("rejects %p", (input) => {
		expect(checkInputSchema.safeParse(input).success).toBe(false);
	});
});

describe("sharedEmailSchema", () => {
	test("accepts a full email, null messageId, missing messageId", () => {
		expect(sharedEmailSchema.safeParse(email).success).toBe(true);
		expect(sharedEmailSchema.safeParse({ ...email, messageId: null }).success).toBe(true);
		const rest: Partial<typeof email> = { ...email };
		delete rest.messageId;
		expect(sharedEmailSchema.safeParse(rest).success).toBe(true);
	});

	test.each([
		["empty folder", { folder: "" }],
		["CR in folder (IMAP command injection)", { folder: "INBOX\r\nA1 DELETE INBOX" }],
		["LF in folder", { folder: "a\nb" }],
		["folder too long", { folder: "f".repeat(513) }],
		["non-numeric uid", { uid: "1:*" }],
		["uid too long", { uid: "12345678901" }],
		["negative uid", { uid: "-1" }],
		["subject too long", { subject: "s".repeat(301) }],
		["preview too long", { preview: "p".repeat(PREVIEW_MAX * 2 + 1) }],
		["address too long", { from: { name: "a", address: "a".repeat(321) } }],
		["missing from", { from: undefined }],
	])("rejects %s", (_, patch) => {
		expect(sharedEmailSchema.safeParse({ ...email, ...patch }).success).toBe(false);
	});

	test("folder/uid messages", () => {
		expect(sharedEmailSchema.safeParse({ ...email, folder: "a\rb" }).error?.issues[0]?.message).toBe("Invalid folder.");
		expect(sharedEmailSchema.safeParse({ ...email, uid: "x" }).error?.issues[0]?.message).toBe("Invalid message id.");
	});

	test("boundaries accepted", () => {
		expect(sharedEmailSchema.safeParse({ ...email, uid: "4294967295", preview: "p".repeat(PREVIEW_MAX * 2) }).success).toBe(true);
	});
});

describe("shareEmailSchema", () => {
	test("accepts with and without a trimmed note", () => {
		expect(shareEmailSchema.parse({ integrationId: UUID, email, note: "  fyi  " }).note).toBe("fyi");
		expect(shareEmailSchema.safeParse({ integrationId: UUID, email }).success).toBe(true);
	});

	test("rejects a long note or bad id", () => {
		expect(shareEmailSchema.safeParse({ integrationId: UUID, email, note: "n".repeat(NOTE_MAX + 1) }).success).toBe(false);
		expect(shareEmailSchema.safeParse({ integrationId: "x", email }).success).toBe(false);
	});
});

describe("briefItemSchema / sendBriefSchema", () => {
	test("accepts up to BRIEF_MAX items", () => {
		const items = Array.from({ length: BRIEF_MAX }, () => item);
		expect(sendBriefSchema.safeParse({ integrationId: UUID, dateLabel: "Fri, Sep 25", items }).success).toBe(true);
	});

	test.each([
		["no items", { items: [] }],
		["too many items", { items: Array.from({ length: BRIEF_MAX + 1 }, () => item) }],
		["blank date label", { dateLabel: "   " }],
		["long date label", { dateLabel: "d".repeat(61) }],
	])("rejects %s", (_, patch) => {
		expect(sendBriefSchema.safeParse({ integrationId: UUID, dateLabel: "Today", items: [item], ...patch }).success).toBe(false);
	});

	test("why: at most 4 reasons of 80 chars", () => {
		expect(briefItemSchema.safeParse({ ...item, why: ["a", "b", "c", "d"] }).success).toBe(true);
		expect(briefItemSchema.safeParse({ ...item, why: ["a", "b", "c", "d", "e"] }).success).toBe(false);
		expect(briefItemSchema.safeParse({ ...item, why: ["w".repeat(81)] }).success).toBe(false);
	});
});

describe("export schemas", () => {
	test("plan", () => {
		expect(exportPlanSchema.safeParse({ folder: "INBOX", range: "30d" }).success).toBe(true);
		expect(exportPlanSchema.safeParse({ folder: "INBOX", range: "7d" }).success).toBe(false);
	});

	test("chunk", () => {
		expect(exportChunkSchema.safeParse({ folder: "INBOX", uidValidity: "1234567890", uids: "1:50" }).success).toBe(true);
		expect(exportChunkSchema.safeParse({ folder: "INBOX", uidValidity: "abc", uids: "1:50" }).success).toBe(false);
		expect(exportChunkSchema.safeParse({ folder: "INBOX", uidValidity: "1".repeat(21), uids: "1" }).success).toBe(false);
		expect(exportChunkSchema.safeParse({ folder: "INBOX", uidValidity: "1", uids: "" }).success).toBe(false);
		expect(exportChunkSchema.safeParse({ folder: "INBOX", uidValidity: "1", uids: "1".repeat(4001) }).success).toBe(false);
	});

	test("log", () => {
		const log = { folder: "INBOX", range: "all", outcome: "partial", total: 10, saved: 4, bytes: 100 };
		expect(logExportSchema.safeParse(log).success).toBe(true);
		expect(logExportSchema.safeParse({ ...log, errorCode: "timeout" }).success).toBe(true);
		expect(logExportSchema.safeParse({ ...log, outcome: "done" }).success).toBe(false);
		expect(logExportSchema.safeParse({ ...log, saved: -1 }).success).toBe(false);
		expect(logExportSchema.safeParse({ ...log, bytes: 1.5 }).success).toBe(false);
		expect(logExportSchema.safeParse({ ...log, errorCode: "e".repeat(65) }).success).toBe(false);
	});
});
