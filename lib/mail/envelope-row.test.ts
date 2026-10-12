import { describe, expect, test } from "bun:test";
import { snapshotFromMessages, toEnvelopeRow } from "@/lib/mail/envelope-row";
import type { MailMessage } from "@/lib/mail/types";

const NOW = Date.UTC(2026, 8, 25, 12);

function message(over: Partial<MailMessage> = {}): MailMessage {
	return {
		uid: "42",
		folder: "INBOX",
		subject: "Hello",
		from: { name: "Maya", address: "maya@x.com" },
		to: [{ address: "me@x.com" }],
		cc: [],
		bcc: [],
		date: new Date(NOW - 3_600_000).toISOString(),
		flags: { seen: false, flagged: true, answered: false, draft: false },
		text: "Hi there,\n> quoted line\nsee you",
		html: "",
		attachments: [],
		messageId: "<m1@x>",
		headers: {},
		...over,
	};
}

describe("toEnvelopeRow", () => {
	test("maps the basics", () => {
		const row = toEnvelopeRow(message(), "inbox");
		expect(row).toMatchObject({
			id: "inbox:42",
			folder: "inbox",
			path: "INBOX",
			uid: 42,
			date: NOW - 3_600_000,
			subject: "Hello",
			messageId: "<m1@x>",
			seen: false,
			flagged: true,
			answered: false,
			hasAttachments: false,
			attachmentBytes: 0,
			hasCalendar: false,
			autoSubmitted: false,
			bulk: false,
			references: [],
			preview: "Hi there, see you",
		});
		expect(row.sentAt).toBeUndefined();
		expect(row.tzOffsetMin).toBeUndefined();
	});

	test("reads the Date: header's epoch and sender offset", () => {
		const row = toEnvelopeRow(message({ headers: { date: "Fri, 25 Sep 2026 07:00:00 -0400" } }), "inbox");
		expect(row.sentAt).toBe(Date.UTC(2026, 8, 25, 11));
		expect(row.tzOffsetMin).toBe(-240);
	});

	test("references: message field wins, else parsed from the header", () => {
		expect(toEnvelopeRow(message({ references: ["<a@x>"], headers: { references: "<b@x> <c@x>" } }), "inbox").references).toEqual([
			"<a@x>",
		]);
		expect(toEnvelopeRow(message({ headers: { references: "<b@x> <c@x>" } }), "inbox").references).toEqual(["<b@x>", "<c@x>"]);
	});

	test("calendar parts count as calendar, not attachments", () => {
		const row = toEnvelopeRow(
			message({
				text: "abc",
				attachments: [
					{ filename: "invite.ics", contentType: "text/calendar", size: 900 },
					{ filename: "a.pdf", contentType: "application/pdf", size: 1000 },
					{ filename: "b.png", contentType: "image/png", size: 24 },
				],
			}),
			"inbox",
		);
		expect(row.hasCalendar).toBe(true);
		expect(row.hasAttachments).toBe(true);
		expect(row.attachmentBytes).toBe(1024);
		expect(row.size).toBe(3 + 1024);
	});

	test("calendar-only mail has no attachments", () => {
		const row = toEnvelopeRow(message({ attachments: [{ filename: "i.ics", contentType: "text/calendar", size: 5 }] }), "inbox");
		expect([row.hasCalendar, row.hasAttachments]).toEqual([true, false]);
	});

	test.each([
		[undefined, false],
		["no", false],
		["No", false],
		["auto-generated", true],
		["auto-replied", true],
	])("Auto-Submitted %p → %p", (value, auto) => {
		const headers: Record<string, string> = value === undefined ? {} : { "auto-submitted": value };
		expect(toEnvelopeRow(message({ headers }), "inbox").autoSubmitted).toBe(auto);
	});

	test.each([
		[undefined, false],
		["bulk", true],
		["List", true],
		["junk", true],
		["first-class", false],
		["blacklisted", false],
	])("Precedence %p → bulk %p", (value, bulk) => {
		const headers: Record<string, string> = value === undefined ? {} : { precedence: value };
		expect(toEnvelopeRow(message({ headers }), "inbox").bulk).toBe(bulk);
	});

	test("carries list headers through raw", () => {
		const row = toEnvelopeRow(
			message({ headers: { "list-id": "<news.x.com>", "list-unsubscribe": "<https://x.com/u>" } }),
			"inbox",
		);
		expect(row.listId).toBe("<news.x.com>");
		expect(row.listUnsubscribe).toBe("<https://x.com/u>");
	});
});

describe("snapshotFromMessages", () => {
	const hour = 3_600_000;
	const at = (h: number) => new Date(NOW - h * hour).toISOString();

	const messages = [
		message({ uid: "1", folder: "INBOX", date: at(1), text: "12345" }),
		message({ uid: "2", folder: "Sent", date: at(2), text: "123" }),
		message({ uid: "3", folder: "Drafts", date: at(1) }),
		message({ uid: "4", folder: "Archive", date: at(1) }),
		message({ uid: "5", folder: "INBOX", date: at(24 * 8) }), // outside a 7-day window
		message({ uid: "6", folder: "INBOX", date: new Date(NOW + hour).toISOString() }), // future
		message({ uid: "7", folder: "INBOX", date: at(24 * 7) }), // exactly on the edge
	];

	const snap = snapshotFromMessages(messages, { now: NOW, days: 7, account: "me@x.com", inbox: { unseen: 3, total: 9 } });

	test("keeps INBOX and Sent within [now - days, now]", () => {
		expect(snap.rows.map((r) => r.id)).toEqual(["inbox:1", "sent:2", "inbox:7"]);
		expect(snap.rows.map((r) => r.folder)).toEqual(["inbox", "sent", "inbox"]);
	});

	test("snapshot envelope", () => {
		expect(snap).toMatchObject({
			v: 1,
			account: "me@x.com",
			fetchedAt: NOW,
			days: 7,
			inbox: { path: "INBOX", unseen: 3, total: 9 },
			sent: { path: "Sent" },
			truncated: false,
		});
	});

	test("quota adds the rows' size to a fixed base", () => {
		const used = snap.rows.reduce((s, r) => s + r.size, 0);
		expect(snap.quota).toEqual({ usedBytes: 6_200_000_000 + used, limitBytes: 15_000_000_000 });
		expect(snap.quota!.usedBytes).toBeLessThan(snap.quota!.limitBytes);
	});

	test("accepts any iterable and handles none", () => {
		const empty = snapshotFromMessages(new Set<MailMessage>(), { now: NOW, days: 1, account: "a", inbox: { unseen: 0, total: 0 } });
		expect(empty.rows).toEqual([]);
		expect(empty.quota!.usedBytes).toBe(6_200_000_000);
	});
});
