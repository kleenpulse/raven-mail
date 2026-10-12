import { describe, expect, test } from "bun:test";
import { finalize, knownSenders, scanDetail, understoodDetail } from "@/lib/jev/ask/answer";
import { INTENT_META, SUGGESTED_INTENTS } from "@/lib/jev/ask/catalog";
import type { Composed } from "@/lib/jev/ask/retrieve";
import { INTENTS, type AskPlan } from "@/lib/jev/ask/types";
import type { EnrichedRow } from "@/lib/insights/metrics";

type Addr = { name?: string; address: string };

/** knownSenders only reads folder, from, to and bucket. */
function r(folder: "inbox" | "sent", from: Addr, opts: { to?: Addr[]; bucket?: EnrichedRow["bucket"] } = {}): EnrichedRow {
	return { folder, from, to: opts.to ?? [], bucket: opts.bucket ?? "people" } as unknown as EnrichedRow;
}

function plan(over: Partial<AskPlan> = {}): AskPlan {
	return {
		intent: "needs_reply",
		intentConfidence: 0.9,
		alternatives: [],
		timeframe: "any",
		scope: "inbox",
		unreadOnly: false,
		keywords: [],
		source: "jev",
		...over,
	};
}

const composed: Composed = { headline: "H", sentence: "S", evidence: [], empty: false };

describe("knownSenders", () => {
	const SELF = "Me@Raven.dev";

	test("people first, then by volume; self excluded case-insensitively", () => {
		const rows = [
			r("inbox", { name: "News", address: "news@list.example" }, { bucket: "newsletters" }),
			r("inbox", { name: "News", address: "news@list.example" }, { bucket: "newsletters" }),
			r("inbox", { name: "News", address: "news@list.example" }, { bucket: "newsletters" }),
			r("inbox", { name: "Maya Chen", address: "maya@nw.example" }),
			r("inbox", { name: "Sam Okafor", address: "sam@ok.example" }),
			r("inbox", { name: "Sam Okafor", address: "SAM@ok.example" }),
			r("inbox", { name: "Me", address: "me@raven.dev" }),
		];
		expect(knownSenders(rows, SELF).map((p) => p.address)).toEqual([
			"sam@ok.example",
			"maya@nw.example",
			"news@list.example",
		]);
	});

	test("sent mail contributes its recipients as people", () => {
		const rows = [
			r("inbox", { address: "alerts@bank.example" }, { bucket: "notifications" }),
			r("inbox", { address: "alerts@bank.example" }, { bucket: "notifications" }),
			r("sent", { address: "me@raven.dev" }, { to: [{ name: "Priya Raman", address: "priya@fw.example" }, { address: "me@raven.dev" }] }),
		];
		expect(knownSenders(rows, SELF)).toEqual([
			{ name: "Priya Raman", address: "priya@fw.example" },
			{ name: "Alerts", address: "alerts@bank.example" },
		]);
	});

	test("a full name upgrades a single-word or derived name, never the reverse", () => {
		const rows = [
			r("inbox", { address: "maya.chen@nw.example" }),
			r("inbox", { name: "Maya", address: "maya.chen@nw.example" }),
			r("inbox", { name: "Maya Chen", address: "maya.chen@nw.example" }),
			r("inbox", { name: "M", address: "maya.chen@nw.example" }),
		];
		expect(knownSenders(rows, SELF)).toEqual([{ name: "Maya Chen", address: "maya.chen@nw.example" }]);
	});

	test("rows without an address are skipped", () => {
		expect(knownSenders([r("inbox", { address: "" })], SELF)).toEqual([]);
	});
});

describe("stage details", () => {
	test("understoodDetail names the intent, confidence and source", () => {
		expect(understoodDetail(plan({ intentConfidence: 0.92 }))).toBe("Needs my reply · 92% via Jev");
		expect(understoodDetail(plan({ intent: "receipts", intentConfidence: 1, source: "forced" }))).toBe(
			"Receipts · 100% via suggestion",
		);
		expect(understoodDetail(plan({ intent: "find_topic", intentConfidence: 0.45, source: "heuristic" }))).toBe(
			"Find a topic · 45% via keyword match",
		);
	});

	test("scanDetail formats the count and range", () => {
		expect(scanDetail(plan({ timeframe: "last_7_days" }), 1234)).toBe("Scanning 1,234 messages · last 7 days");
		expect(scanDetail(plan({ timeframe: "any" }), 0)).toBe("Scanning 0 messages · any time");
	});
});

describe("finalize", () => {
	test("confident plan: composed fields, no clarify, related follow-ups", () => {
		const p = plan();
		const a = finalize(p, "who needs me", composed, false);
		expect(a).toMatchObject({ question: "who needs me", headline: "H", sentence: "S", empty: false, plan: p });
		expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(a.confidence).toBe(0.9);
		expect(a.clarify).toBeUndefined();
		expect(a.followUps).toEqual(["Who owes me a reply?", "What’s urgent today?"]);
		expect(a.narration).toBeNull();
	});

	test("“other” asks to clarify from the suggested intents (≤4, never itself)", () => {
		const a = finalize(plan({ intent: "other", intentConfidence: 0.9 }), "??", composed, false);
		const expected = SUGGESTED_INTENTS.slice(0, 4);
		expect(a.clarify).toEqual({
			question: "Not quite? Try one of these:",
			options: expected.map((i) => ({ label: INTENT_META[i].example, intent: i })),
		});
		expect(a.followUps).toEqual([]);
	});

	test("low confidence (<0.5) clarifies, skipping the chosen intent", () => {
		const a = finalize(plan({ intentConfidence: 0.49 }), "q", composed, false);
		expect(a.clarify!.options.map((o) => o.intent)).toEqual(["awaiting_others", "urgent", "unread_summary", "receipts"]);
	});

	test("exactly 0.5 confidence does not clarify", () => {
		expect(finalize(plan({ intentConfidence: 0.5 }), "q", composed, false).clarify).toBeUndefined();
	});

	test("alternatives drive the options; example-less intents are dropped; max 4", () => {
		const a = finalize(
			plan({
				intent: "find_topic",
				intentConfidence: 0.3,
				alternatives: [
					{ intent: "other", p: 0.3 },
					{ intent: "urgent", p: 0.2 },
					{ intent: "find_topic", p: 0.2 },
					{ intent: "receipts", p: 0.1 },
					{ intent: "meetings", p: 0.1 },
					{ intent: "security", p: 0.05 },
					{ intent: "attachments", p: 0.05 },
				],
			}),
			"q",
			composed,
			false,
		);
		expect(a.clarify!.options.map((o) => o.intent)).toEqual(["urgent", "receipts", "meetings", "security"]);
	});

	test("follow-ups are the related intents' examples, at most 3, never empty strings", () => {
		for (const intent of INTENTS) {
			const a = finalize(plan({ intent }), "q", composed, false);
			expect(a.followUps.length).toBeLessThanOrEqual(3);
			expect(a.followUps.every((f) => f.length > 0)).toBe(true);
			expect(a.followUps).toEqual(INTENT_META[intent].related.map((i) => INTENT_META[i].example).filter(Boolean).slice(0, 3));
		}
	});

	test("searched: scope, range, sender, unread", () => {
		const maya = { name: "Maya", address: "maya@nw.example" };
		expect(finalize(plan({ timeframe: "last_7_days" }), "q", composed, false).searched).toBe("Inbox · last 7 days");
		expect(finalize(plan({ scope: "sent", sender: maya }), "q", composed, false).searched).toBe(
			"Sent · any time · to maya@nw.example",
		);
		expect(finalize(plan({ scope: "inbox", sender: maya, unreadOnly: true }), "q", composed, false).searched).toBe(
			"Inbox · any time · from maya@nw.example · unread",
		);
		expect(finalize(plan({ scope: "all" }), "q", composed, false).searched).toBe("Inbox + Sent · any time");
	});

	test("searched: keywords only for topical intents; widened says Whole Inbox", () => {
		const kw = { keywords: ["q3", "roadmap"] };
		expect(finalize(plan({ intent: "find_topic", ...kw }), "q", composed, false).searched).toBe("Inbox · any time · “q3 roadmap”");
		expect(finalize(plan({ intent: "other", ...kw }), "q", composed, false).searched).toBe("Inbox · any time · “q3 roadmap”");
		expect(finalize(plan({ intent: "urgent", ...kw }), "q", composed, false).searched).toBe("Inbox · any time");
		expect(finalize(plan({ intent: "find_topic", scope: "sent", ...kw }), "q", composed, true).searched).toBe(
			"Whole Inbox · any time · “q3 roadmap”",
		);
	});

	test("composed openInMail/viz/stats pass through", () => {
		const extra: Composed = {
			...composed,
			openInMail: "/mail?q=x",
			stats: [{ label: "a", value: "b" }],
			viz: { kind: "bars", label: "v", points: [] },
		};
		const a = finalize(plan(), "q", extra, false);
		expect(a.openInMail).toBe("/mail?q=x");
		expect(a.stats).toEqual([{ label: "a", value: "b" }]);
		expect(a.viz).toEqual({ kind: "bars", label: "v", points: [] });
	});
});
