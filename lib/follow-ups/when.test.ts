import { describe, expect, test } from "bun:test";
import { choiceLabel, dueAtFor, dueLabel, hasReply, isDue, recipientLine } from "@/lib/follow-ups/when";
import { followUpHref } from "@/lib/follow-ups/links";

const now = new Date("2026-10-22T10:00:00Z");
const DAY = 86_400_000;

describe("dueAtFor", () => {
	test("presets count days from now", () => {
		expect(dueAtFor({ days: 1 }, now)?.toISOString()).toBe("2026-10-23T10:00:00.000Z");
		expect(dueAtFor({ days: 7 }, now)?.toISOString()).toBe("2026-10-29T10:00:00.000Z");
	});

	test("a picked time is used as is", () => {
		expect(dueAtFor({ at: "2026-10-24T09:00:00.000Z" }, now)?.toISOString()).toBe("2026-10-24T09:00:00.000Z");
	});

	test.each([
		["in the past", { at: "2026-10-22T09:59:00.000Z" }],
		["right now", { at: now.toISOString() }],
		["over a year out", { days: 366 }],
		["not a date", { at: "soon" }],
	])("refuses a time %s", (_, choice) => {
		expect(dueAtFor(choice, now)).toBeNull();
	});
});

describe("isDue", () => {
	test("open and past its time", () => {
		expect(isDue({ dueAt: new Date(now.getTime() - 1).toISOString(), status: "open" }, now)).toBe(true);
		expect(isDue({ dueAt: now.toISOString(), status: "open" }, now)).toBe(true);
	});

	test("not before its time, and never once done", () => {
		expect(isDue({ dueAt: new Date(now.getTime() + DAY).toISOString(), status: "open" }, now)).toBe(false);
		expect(isDue({ dueAt: new Date(now.getTime() - DAY).toISOString(), status: "done" }, now)).toBe(false);
	});
});

describe("hasReply", () => {
	const id = "<sent-1@raven.example>";
	test("matches In-Reply-To", () => {
		expect(hasReply([{ inReplyTo: id }], id)).toBe(true);
	});

	test("matches anywhere in References", () => {
		expect(hasReply([{ references: ["<root@raven.example>", id] }], id)).toBe(true);
	});

	test("ignores mail about something else", () => {
		expect(hasReply([{ inReplyTo: "<other@raven.example>", references: ["<root@raven.example>"] }, {}], id)).toBe(false);
	});
});

describe("recipientLine", () => {
	test("names first, addresses when there's no name", () => {
		expect(recipientLine('"Chen, Maya" <maya@acme.example>, bob@acme.example')).toBe("Chen, Maya, bob@acme.example");
	});

	test("more than two become a count", () => {
		expect(
			recipientLine([
				{ name: "Maya", address: "maya@acme.example" },
				{ name: "Leo", address: "leo@acme.example" },
				{ address: "ana@acme.example" },
				{ address: "kai@acme.example" },
			]),
		).toBe("Maya, Leo +2");
	});
});

describe("labels", () => {
	test("choiceLabel reads like a sentence", () => {
		expect(choiceLabel({ days: 3 }, now)).toBe("in 3 days");
		expect(choiceLabel({ days: 7 }, now)).toBe("in 1 week");
		expect(choiceLabel({ at: "2026-10-23T09:00:00.000Z" }, now)).toBe("tomorrow");
		expect(choiceLabel({ at: "2026-10-30T09:00:00.000Z" }, now)).toBe("on Fri 30 Oct");
	});

	test("dueLabel: today with the time, then tomorrow, then the date", () => {
		expect(dueLabel("2026-10-22T15:30:00.000Z", now)).toBe("today at 15:30");
		expect(dueLabel("2026-10-23T08:00:00.000Z", now)).toBe("tomorrow");
		expect(dueLabel("2027-01-04T08:00:00.000Z", now)).toBe("4 Jan 2027");
	});
});

describe("followUpHref", () => {
	test("opens the sent message, with its Message-ID as a fallback", () => {
		expect(followUpHref({ folder: "Sent", uid: "12", messageId: "<a@b>", subject: "Plan" })).toBe(
			"/mail?folder=Sent&uid=12&mid=%3Ca%40b%3E",
		);
	});

	test("without a uid it searches Sent for the subject", () => {
		expect(followUpHref({ folder: "Sent", uid: "", messageId: "<a@b>", subject: "Q3 plan" })).toBe(
			"/mail?folder=Sent&q=Q3+plan",
		);
	});
});
