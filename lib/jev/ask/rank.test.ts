import { describe, expect, mock, test } from "bun:test";
import { answers, fakeJev, testJev } from "@/test/helpers/jev";
import { jevRank } from "@/lib/jev/ask/rank";
import { enrichSnapshot, type EnrichedRow } from "@/lib/insights/metrics";
import type { EnvelopeRow, Snapshot } from "@/lib/insights/types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 15, 0);
const ME = { address: "me@raven.dev", name: "Me" };

function rows(n: number, over: (i: number) => Partial<EnvelopeRow> = () => ({})): EnrichedRow[] {
	const raw: EnvelopeRow[] = Array.from({ length: n }, (_, i) => ({
		id: `inbox:${i + 1}`,
		folder: "inbox",
		path: "INBOX",
		uid: i + 1,
		date: NOW - (i + 1) * HOUR,
		from: { name: `Sender ${i}`, address: `s${i}@example.com` },
		to: [ME],
		cc: [],
		subject: `Subject ${i}`,
		references: [],
		seen: true,
		flagged: false,
		answered: false,
		size: 1000,
		hasAttachments: false,
		attachmentBytes: 0,
		hasCalendar: false,
		autoSubmitted: false,
		bulk: false,
		...over(i),
	}));
	const snapshot: Snapshot = {
		v: 1,
		account: ME.address,
		fetchedAt: NOW,
		days: 30,
		inbox: { path: "INBOX", unseen: 0, total: n },
		sent: { path: "Sent" },
		truncated: false,
		rows: raw,
	};
	// enrichSnapshot sorts oldest-first; callers hand jevRank rows in their own order, so restore it.
	return enrichSnapshot(snapshot, { now: NOW, tz: "UTC" }).rows.sort((a, b) => a.uid - b.uid);
}

function rankWith(best: Record<string, unknown>) {
	fakeJev.enabled = true;
	fakeJev.systemOne = mock(async () => answers({ best }));
}

type Call = { state: { question: string }; questions: { best: { type: string; criteria: Record<string, string> } } };
const firstCall = () => fakeJev.systemOne.mock.calls[0] as unknown as [Call, { signal?: AbortSignal }];

describe("jevRank guards", () => {
	test("disabled → null without calling Jev", async () => {
		expect(await jevRank("q", rows(3), NOW, testJev())).toBeNull();
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("no rows → null without calling Jev", async () => {
		fakeJev.enabled = true;
		expect(await jevRank("q", [], NOW, testJev())).toBeNull();
		expect(fakeJev.systemOne).not.toHaveBeenCalled();
	});

	test("systemOne throws → null", async () => {
		fakeJev.enabled = true;
		fakeJev.systemOne = mock(async () => {
			throw new Error("boom");
		});
		expect(await jevRank("q", rows(3), NOW, testJev())).toBeNull();
	});
});

describe("jevRank request", () => {
	test("one choice over mN labels + none; email text only in label descriptions", async () => {
		rankWith({ choice: "m0", probabilities: { m0: 1 } });
		const controller = new AbortController();
		const list = rows(2, (i) => (i === 0 ? { preview: "x".repeat(400) } : { from: { address: "bot@example.com" } }));
		await jevRank("where is the contract", list, NOW, testJev(), controller.signal);
		const [input, opts] = firstCall();
		expect(opts.signal).toBe(controller.signal);
		expect(input.state).toEqual({ question: "where is the contract" });
		expect(input.questions.best.type).toBe("choice");
		const criteria = input.questions.best.criteria;
		expect(Object.keys(criteria)).toEqual(["m0", "m1", "none"]);
		expect(criteria.none).toBe("None of these emails answer the question");
		// name · subject · age · preview (preview ≤160, whole label ≤320)
		expect(criteria.m0).toBe(`Sender 0 · Subject 0 · 1h ago · ${"x".repeat(160)}`);
		// No display name → address; no preview → no trailing separator.
		expect(criteria.m1).toBe("bot@example.com · Subject 1 · 2h ago");
	});

	test("labels are capped at 320 characters", async () => {
		rankWith({ choice: "m0", probabilities: { m0: 1 } });
		await jevRank("q", rows(1, () => ({ subject: "S".repeat(400), preview: "p" })), NOW, testJev());
		expect(firstCall()[0].questions.best.criteria.m0).toHaveLength(320);
	});

	test("pool is capped at 120 candidates", async () => {
		rankWith({ choice: "m119", probabilities: { m119: 0.9, m0: 0.1 } });
		const list = rows(130);
		const ranked = await jevRank("q", list, NOW, testJev());
		const criteria = firstCall()[0].questions.best.criteria;
		expect(Object.keys(criteria)).toHaveLength(121);
		expect(criteria.m119).toBeDefined();
		expect(criteria.m120).toBeUndefined();
		expect(ranked!.map((r) => r.row.uid)).toEqual([list[119]!.uid, list[0]!.uid]);
	});
});

describe("jevRank ordering", () => {
	test("orders by probability, rounded to 3 decimals", async () => {
		rankWith({ choice: "m2", probabilities: { m0: 0.2, m1: 0.1234, m2: 0.6666 } });
		const list = rows(3);
		const ranked = await jevRank("q", list, NOW, testJev());
		expect(ranked!.map((r) => [r.row.uid, r.score])).toEqual([
			[list[2]!.uid, 0.667],
			[list[0]!.uid, 0.2],
			[list[1]!.uid, 0.123],
		]);
		expect(ranked!.every((r) => r.low === undefined)).toBe(true);
	});

	test("drops candidates under 10% of the top score", async () => {
		rankWith({ choice: "m0", probabilities: { m0: 0.5, m1: 0.05, m2: 0.049, m3: 0.03 } });
		const list = rows(5);
		const ranked = await jevRank("q", list, NOW, testJev());
		// 0.05 is exactly 10% of 0.5 → kept; 0.049, 0.03 and the missing m4 (0) → dropped.
		expect(ranked!.map((r) => r.row.uid)).toEqual([list[0]!.uid, list[1]!.uid]);
	});

	test("caps the result at 8", async () => {
		const probabilities = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, 0.08]));
		rankWith({ choice: "m0", probabilities });
		const ranked = await jevRank("q", rows(12), NOW, testJev());
		expect(ranked).toHaveLength(8);
	});

	test("“none” → the top 3 flagged low", async () => {
		rankWith({ choice: "none", probabilities: { none: 0.7, m3: 0.2, m1: 0.06, m0: 0.04 } });
		const list = rows(5);
		const ranked = await jevRank("q", list, NOW, testJev());
		expect(ranked).toEqual([
			{ row: list[3]!, score: 0.2, low: true },
			{ row: list[1]!, score: 0.06, low: true },
			{ row: list[0]!, score: 0.04, low: true },
		]);
	});

	test("“none” with fewer than 3 candidates returns them all, low", async () => {
		rankWith({ choice: "none", probabilities: { none: 1 } });
		const ranked = await jevRank("q", rows(2), NOW, testJev());
		expect(ranked).toHaveLength(2);
		expect(ranked!.every((r) => r.low && r.score === 0)).toBe(true);
	});
});
