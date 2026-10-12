import { describe, expect, test } from "bun:test";
import { asctime, encodeMessage, exportFileName } from "@/lib/integrations/export/mbox";
import { planChunks } from "@/lib/integrations/export/plan";
import { advance, formatBytes, formatEta, percent, startProgress } from "@/lib/integrations/export/progress";
import { compressUids, parseUidSet } from "@/lib/integrations/export/uid-set";

const msg = (body: string) => Buffer.from(`From: a@x.io\r\nSubject: s\r\n\r\n${body}\r\n`, "latin1");

describe("mbox writer", () => {
	test("From_ line, LF endings, blank separator", () => {
		const out = encodeMessage(msg("Body"), { sender: "a@x.io", date: new Date(Date.UTC(2026, 8, 4, 9, 5, 7)) }).toString("latin1");
		expect(out).toBe("From a@x.io Fri Sep  4 09:05:07 2026\nFrom: a@x.io\nSubject: s\n\nBody\n\n");
	});

	test("mboxrd-quotes every ^>*From line in the body", () => {
		const out = encodeMessage(Buffer.from("Subject: x\r\n\r\nFrom here on\r\n>From quoted\r\n>>From deeper\r\nnot From\r\n"), {}).toString();
		expect(out).toContain("\n>From here on\n");
		expect(out).toContain("\n>>From quoted\n");
		expect(out).toContain("\n>>>From deeper\n");
		expect(out).toContain("\nnot From\n");
		expect(out.startsWith("From MAILER-DAEMON Thu Jan  1 00:00:00 1970\n")).toBe(true);
	});

	test("8-bit bytes survive; missing final newline is added; empty message stays valid", () => {
		const out = encodeMessage(Buffer.from([0x53, 0x3a, 0x20, 0xe9, 0xff]), {});
		expect(out.subarray(-4).equals(Buffer.from([0xe9, 0xff, 0x0a, 0x0a]))).toBe(true);
		expect(encodeMessage(new Uint8Array(0), {}).toString().endsWith("1970\n\n\n")).toBe(true);
	});

	test("asctime pads single-digit days; file names are slugged", () => {
		expect(asctime(new Date(Date.UTC(2026, 0, 5, 1, 2, 3)))).toBe("Mon Jan  5 01:02:03 2026");
		expect(exportFileName("INBOX", new Date("2026-09-24T12:00:00Z"))).toBe("raven-inbox-2026-09-24.mbox");
		expect(exportFileName("[Gmail]/Sent Mail", new Date("2026-09-24T12:00:00Z"))).toBe("raven-sent-mail-2026-09-24.mbox");
	});
});

describe("uid sets", () => {
	test("compress + parse round-trip", () => {
		const uids = [9, 1, 2, 3, 7, 10, 3];
		const set = compressUids(uids);
		expect(set).toBe("1:3,7,9:10");
		expect(parseUidSet(set, { max: 100 })).toEqual([1, 2, 3, 7, 9, 10]);
	});

	test("rejects wildcards, zero, reversed ranges and oversized sets", () => {
		for (const bad of ["1:*", "*", "0", "5:3", "1,,2", "1:2:3", "a", "", "4294967296"]) {
			expect(() => parseUidSet(bad, { max: 100 })).toThrow();
		}
		expect(() => parseUidSet("1:101", { max: 100 })).toThrow();
		expect(parseUidSet("1:100", { max: 100 })).toHaveLength(100);
	});
});

describe("planChunks", () => {
	test("caps count and bytes; oversized messages ride alone", () => {
		const messages = [
			...Array.from({ length: 250 }, (_, i) => ({ uid: i + 1, size: 1000 })),
			{ uid: 300, size: 9_000_000 },
			{ uid: 301, size: 10 },
		];
		const chunks = planChunks(messages, { maxCount: 100, maxBytes: 4 * 1024 * 1024 });
		expect(chunks.map((c) => c.count)).toEqual([100, 100, 50, 1, 1]);
		expect(chunks[0]!.uids).toBe("1:100");
		expect(chunks[3]).toEqual({ uids: "300", count: 1, bytes: 9_000_000 });
		expect(chunks.reduce((n, c) => n + c.count, 0)).toBe(252);
	});

	test("byte cap splits before overflowing; empty folder → no chunks", () => {
		const chunks = planChunks(
			[
				{ uid: 5, size: 3 },
				{ uid: 2, size: 3 },
				{ uid: 9, size: 3 },
			],
			{ maxBytes: 7 },
		);
		expect(chunks.map((c) => c.uids)).toEqual(["2,5", "9"]);
		expect(planChunks([])).toEqual([]);
	});
});

describe("progress", () => {
	test("monotonic, exact 100 at the end, rate and ETA from received bytes", () => {
		let p = startProgress({ total: 300, bytes: 3000, chunks: 3 });
		expect(percent(p)).toBe(0);
		p = advance(p, { plannedBytes: 1000, plannedCount: 100, count: 100, receivedBytes: 1100, missing: 0, ms: 1000 });
		expect(percent(p)).toBe(33);
		expect(p.rateBps).toBe(1100);
		expect(p.etaMs).toBe(Math.round((2000 / 1100) * 1000));
		p = advance(p, { plannedBytes: 1000, plannedCount: 100, count: 98, receivedBytes: 900, missing: 2, ms: 1000 });
		expect(p.done).toBe(198);
		expect(p.missing).toBe(2);
		p = advance(p, { plannedBytes: 1000, plannedCount: 100, count: 100, receivedBytes: 1000, missing: 0, ms: 1000 });
		expect(percent(p)).toBe(100);
		expect(p.etaMs).toBe(0);
	});

	test("formatting", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
		expect(formatBytes(184 * 1024 * 1024)).toBe("184 MB");
		expect(formatEta(42_000)).toBe("42s left");
		expect(formatEta(5 * 60_000)).toBe("5 min left");
		expect(formatEta(null)).toBeNull();
	});
});
