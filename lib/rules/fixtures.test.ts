import { describe, expect, test } from "bun:test";
import { kage } from "@/lib/kage";
import { decideMessage, readAnswers, ruleRequests } from "@/lib/rules/engine";
import { RULE_THRESHOLDS } from "@/lib/rules/types";
import { MAIL, RULES, type LabelledMail } from "@/test/fixtures/rules";

/*
 * Pins how Kage judges the labelled set (test/fixtures/rules) at the approved
 * thresholds: trash 0.85, the rest 0.70. A change in Kage or in how rules ask
 * shows up here first; retune with these numbers in front of you.
 */

async function judge(m: LabelledMail): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	for (const { ruleIds, request } of ruleRequests(RULES, m)) {
		const result = await kage.systemOne(request);
		for (const [id, p] of readAnswers(ruleIds, result.answers)) out.set(id, p);
	}
	return out;
}

const judged = await Promise.all(MAIL.map(async (m) => ({ m, p: await judge(m) })));

function score(ruleId: string) {
	const rule = RULES.find((r) => r.id === ruleId)!;
	const s = { tp: 0, fp: 0, fn: 0 };
	for (const { m, p } of judged) {
		const hit = p.get(ruleId)! >= RULE_THRESHOLDS[rule.action];
		const want = m.fits.includes(ruleId);
		if (hit && want) s.tp++;
		else if (hit) s.fp++;
		else if (want) s.fn++;
	}
	return s;
}

describe("Kage on the labelled rules set", () => {
	test("trash never fires on mail that isn't a promotion", () => {
		expect(score("promos")).toEqual({ tp: 4, fp: 0, fn: 1 });
	});

	test("per rule at its threshold", () => {
		expect(Object.fromEntries(RULES.map((r) => [r.id, score(r.id)]))).toEqual({
			receipts: { tp: 7, fp: 0, fn: 0 },
			newsletters: { tp: 5, fp: 0, fn: 0 },
			promos: { tp: 4, fp: 0, fn: 1 },
			// Travel wording overlaps little with real bookings: it misses rather than guesses.
			travel: { tp: 2, fp: 0, fn: 2 },
			security: { tp: 4, fp: 0, fn: 0 },
			// Kage reads "pull requests" as a person's request, so asks from people lean GitHub.
			// The rule archives, and protected senders hold that back for people you write to.
			github: { tp: 3, fp: 5, fn: 0 },
		});
	});

	test("emails dressed up as a match don't get one", () => {
		for (const id of ["e1", "e3"]) {
			const { p } = judged.find((j) => j.m.id === id)!;
			const cleared = RULES.filter((r) => p.get(r.id)! >= RULE_THRESHOLDS[r.action]).map((r) => r.id);
			expect({ id, cleared }).toEqual({ id, cleared: [] });
		}
	});

	test("a phishing invoice can still look like a receipt: it gets the rule's action, archive, nothing else", () => {
		const { p } = judged.find((j) => j.m.id === "e2")!;
		const decisions = decideMessage(RULES, p, { protectedSender: false, engine: "kage" });
		expect(decisions.filter((d) => d.outcome === "applied").map((d) => [d.rule.id, d.rule.action])).toEqual([["receipts", "archive"]]);
	});

	test("the GitHub misfires on people's mail are held back when you write to them", () => {
		const misfires = judged.filter(({ m, p }) => m.id.startsWith("h") && p.get("github")! >= 0.7);
		expect(misfires.length).toBeGreaterThan(0);
		for (const { p } of misfires) {
			const decisions = decideMessage(RULES, p, { protectedSender: true, engine: "kage" });
			expect(decisions.some((d) => d.outcome === "applied")).toBe(false);
		}
	});
});
