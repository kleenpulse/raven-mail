import { describe, expect, test } from "bun:test";
import { radarAsk } from "@/components/overview/threads-radar";
import { forcePlan } from "@/lib/jev/ask/heuristic-plan";

describe("radarAsk", () => {
	test("nothing typed, nothing chosen → no question", () => {
		expect(radarAsk("  ", null, false)).toBeNull();
	});

	test("free text goes through the normal planner", () => {
		expect(radarAsk("invoice", null, true)).toEqual(["invoice today"]);
	});

	test("a lens forces its intent and carries the typed text as a filter", () => {
		expect(radarAsk("invoice", "needs", true)).toEqual(["invoice · needs my reply today", { forcedIntent: "needs_reply", filter: "invoice" }]);
		expect(radarAsk("", "needs", false)).toEqual(["What needs my reply?", { forcedIntent: "needs_reply", filter: "" }]);
		expect(radarAsk("opay", "newsletters", false)).toEqual(["opay · newsletters", { forcedIntent: "newsletters", filter: "opay" }]);
	});

	test("Today alone asks what's new today", () => {
		const [question, options] = radarAsk("", null, true)!;
		expect(options?.forcedIntent).toBe("unread_summary");
		expect(forcePlan(question, "unread_summary", []).timeframe).toBe("today");
	});

	test("the Today chip reaches the needs-reply timeframe", () => {
		const [question] = radarAsk("", "needs", true)!;
		expect(forcePlan(question, "needs_reply", []).timeframe).toBe("today");
	});
});
