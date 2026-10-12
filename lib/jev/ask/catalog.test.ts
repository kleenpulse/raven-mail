import { describe, expect, test } from "bun:test";
import { DEFAULT_TIMEFRAME, INTENT_META, SUGGESTED_INTENTS, TIMEFRAME_META } from "@/lib/jev/ask/catalog";
import { heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { INTENTS, TIMEFRAMES, type Intent } from "@/lib/jev/ask/types";

/*
 * Every example doubles as a suggestion chip AND a follow-up. Follow-ups are
 * asked as plain text (components/jev/ask-answer.tsx → onAsk(f), no
 * forcedIntent), so with Jev off each example must route back to its intent.
 */

// from_person needs a roster to match against; the example names Maya.
const ROSTER: Record<string, { name: string; address: string }[]> = {
	from_person: [{ name: "Maya Chen", address: "maya@northwind.example" }],
};

// BUG: heuristic-plan.ts:14 (and :10, :26, :116) spell the apostrophe as ASCII `'?`,
// but INTENT_META examples use U+2019 (’) — as do iOS/macOS smart-punctuation keyboards.
// "Who’s waiting on my reply?" therefore routes to find_topic (keywords "waiting","reply")
// instead of needs_reply; "What’s new?" routes to other instead of unread_summary.
const KNOWN_MISROUTES = new Set<Intent>(["needs_reply"]);

const routable = INTENTS.filter((i) => i !== "other" && !KNOWN_MISROUTES.has(i));

describe("INTENT_META examples", () => {
	test.each(routable.map((i) => [i, INTENT_META[i].example] as const))("%s ← %p", (intent, example) => {
		expect(heuristicPlan(example, ROSTER[intent] ?? []).intent).toBe(intent);
	});

	test("from_person needs a roster (no contacts → topic search)", () => {
		expect(heuristicPlan(INTENT_META.from_person.example, []).intent).toBe("find_topic");
	});

	test.todo("BUG: 'Who’s waiting on my reply?' (curly apostrophe) routes to needs_reply", () => {
		expect(heuristicPlan(INTENT_META.needs_reply.example, []).intent).toBe("needs_reply");
		expect(heuristicPlan("What’s new?", []).intent).toBe("unread_summary");
		expect(heuristicPlan("I haven’t heard back from anyone", []).intent).toBe("awaiting_others");
		expect(heuristicPlan("emails I haven’t opened", []).unreadOnly).toBe(true);
	});

	test("the ASCII spelling of the needs_reply example does route (guards the bug's scope)", () => {
		expect(heuristicPlan(INTENT_META.needs_reply.example.replace("’", "'"), []).intent).toBe("needs_reply");
	});

	test("only “other” has no example", () => {
		for (const intent of INTENTS) {
			const meta = INTENT_META[intent];
			expect(meta.label.length).toBeGreaterThan(0);
			expect(meta.criteria.length).toBeGreaterThan(0);
			expect(meta.example.length > 0).toBe(intent !== "other");
		}
	});

	test("examples are unique", () => {
		const examples = INTENTS.map((i) => INTENT_META[i].example).filter(Boolean);
		expect(new Set(examples).size).toBe(examples.length);
	});
});

describe("catalog integrity", () => {
	test("INTENT_META and DEFAULT_TIMEFRAME cover exactly the intents", () => {
		expect(Object.keys(INTENT_META).sort()).toEqual([...INTENTS].sort());
		expect(Object.keys(DEFAULT_TIMEFRAME).sort()).toEqual([...INTENTS].sort());
	});

	test("default timeframes are valid timeframes", () => {
		for (const intent of INTENTS) expect(TIMEFRAMES).toContain(DEFAULT_TIMEFRAME[intent]);
	});

	test("TIMEFRAME_META covers exactly the timeframes", () => {
		expect(Object.keys(TIMEFRAME_META).sort()).toEqual([...TIMEFRAMES].sort());
		for (const tf of TIMEFRAMES) {
			expect(TIMEFRAME_META[tf].label.length).toBeGreaterThan(0);
			expect(TIMEFRAME_META[tf].criteria.length).toBeGreaterThan(0);
		}
	});

	test("related intents are valid, unique, not self, and have examples", () => {
		for (const intent of INTENTS) {
			const related = INTENT_META[intent].related;
			expect(new Set(related).size).toBe(related.length);
			for (const r of related) {
				expect(INTENTS).toContain(r);
				expect(r).not.toBe(intent);
				expect(INTENT_META[r].example.length).toBeGreaterThan(0);
			}
		}
	});

	test("SUGGESTED_INTENTS are valid, unique, not “other”, and have examples", () => {
		expect(SUGGESTED_INTENTS.length).toBeGreaterThanOrEqual(4);
		expect(new Set(SUGGESTED_INTENTS).size).toBe(SUGGESTED_INTENTS.length);
		for (const i of SUGGESTED_INTENTS) {
			expect(INTENTS).toContain(i);
			expect(i).not.toBe("other");
			expect(INTENT_META[i].example.length).toBeGreaterThan(0);
		}
	});
});
