import { describe, expect, test } from "bun:test";
import { detectArrivals } from "@/lib/mail/arrivals";
import type { MailSummary } from "@/lib/mail/types";

const row = (uid: number, seen = false): MailSummary => ({
	uid: String(uid),
	folder: "INBOX",
	subject: `Message ${uid}`,
	from: { address: "a@example.com" },
	to: [],
	preview: "",
	date: new Date(2026, 8, 29).toISOString(),
	flags: { seen, flagged: false, answered: false, draft: false },
	hasAttachments: false,
});

const uids = (rows: MailSummary[]) => rows.map((m) => m.uid);

describe("detectArrivals", () => {
	test("first look sets a baseline and reports nothing", () => {
		expect(detectArrivals(null, [row(5), row(4)])).toEqual({ arrivals: [], watermark: 5 });
	});

	test("an empty inbox keeps the current mark", () => {
		expect(detectArrivals(null, [])).toEqual({ arrivals: [], watermark: null });
		expect(detectArrivals(7, [])).toEqual({ arrivals: [], watermark: 7 });
	});

	test("reports unread rows above the mark, newest first", () => {
		const next = detectArrivals(5, [row(6), row(8), row(5), row(7)]);
		expect(uids(next.arrivals)).toEqual(["8", "7", "6"]);
		expect(next.watermark).toBe(8);
	});

	test("a re-fetch of the same rows reports nothing", () => {
		expect(detectArrivals(8, [row(8), row(7)]).arrivals).toEqual([]);
	});

	test("mail already read elsewhere is skipped but still moves the mark", () => {
		const next = detectArrivals(5, [row(7, true), row(6)]);
		expect(uids(next.arrivals)).toEqual(["6"]);
		expect(next.watermark).toBe(7);
	});

	test("compares UIDs as numbers, not strings", () => {
		expect(uids(detectArrivals(9, [row(10), row(9)]).arrivals)).toEqual(["10"]);
	});

	test("a renumbered folder (UIDVALIDITY) re-baselines instead of going silent forever", () => {
		expect(detectArrivals(900, [row(3), row(2)])).toEqual({ arrivals: [], watermark: 3 });
	});
});
