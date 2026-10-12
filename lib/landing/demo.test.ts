import { describe, expect, setSystemTime, test } from "bun:test";
import { INTENT_META } from "@/lib/jev/ask/catalog";
import { landingDemo } from "@/lib/landing/demo";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const demo = landingDemo(NOW);

/** Answer ids are per-render UUIDs (lib/jev/ask/answer.ts); everything else must be stable. */
const withoutIds = (d: ReturnType<typeof landingDemo>) => ({
	...d,
	asks: d.asks.map((a) => ({ ...a, answer: { ...a.answer, id: "" } })),
});

describe("landingDemo", () => {
	test("deterministic for a fixed now, whatever the wall clock says", () => {
		setSystemTime(new Date("2030-01-01T00:00:00Z"));
		const again = landingDemo(NOW);
		expect(withoutIds(again)).toEqual(withoutIds(demo));
		for (const a of again.asks) expect(a.answer.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("nine demo questions in a stable order", () => {
		expect(demo.asks.map((a) => a.intent)).toEqual([
			"needs_reply",
			"awaiting_others",
			"top_contacts",
			"newsletters",
			"volume_stats",
			"unread_summary",
			"security",
			"receipts",
			"help",
		]);
	});

	test("the first five are suggestion chips", () => {
		expect(demo.asks.map((a) => a.chip)).toEqual([true, true, true, true, true, false, false, false, false]);
	});

	test("questions default to the catalog example; unread_summary is custom", () => {
		for (const ask of demo.asks) {
			if (ask.intent === "unread_summary") expect(ask.question).toBe("What did people send me?");
			else expect(ask.question).toBe(INTENT_META[ask.intent].example);
		}
	});

	test("each answer shows at most 4 evidence rows", () => {
		for (const ask of demo.asks) expect(ask.answer.evidence.length).toBeLessThanOrEqual(4);
		expect(demo.asks.some((a) => a.answer.evidence.length > 0)).toBe(true);
	});

	test("each ask narrates understand → search", () => {
		for (const ask of demo.asks) {
			expect(ask.stages.map((s) => s.stage)).toEqual(["understand", "search"]);
			for (const s of ask.stages) expect(s.detail.length).toBeGreaterThan(0);
		}
	});

	test("answers stay on the intent that was asked", () => {
		for (const ask of demo.asks) {
			expect(ask.answer.plan.intent).toBe(ask.intent);
			expect(ask.answer.question).toBe(ask.question);
		}
	});

	test("an overview is built from the same mailbox", () => {
		expect(demo.overview).toBeDefined();
		expect(typeof demo.overview).toBe("object");
	});

	test("moving now changes the output (relative times stay current)", () => {
		expect(withoutIds(landingDemo(NOW + 3 * 86_400_000))).not.toEqual(withoutIds(demo));
	});

	test("JSON-safe (it's cached and shipped to the client)", () => {
		expect(JSON.parse(JSON.stringify(demo))).toEqual(demo);
	});
});
