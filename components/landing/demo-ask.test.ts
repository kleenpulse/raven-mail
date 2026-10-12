import { describe, expect, test } from "bun:test";
import { intentOf, useDemoAsk } from "@/components/landing/demo-ask";
import type { Intent } from "@/lib/jev/ask/types";

describe("intentOf", () => {
	test.each([
		["Who's waiting on me?", "needs_reply"],
		["Who owes me a reply?", "awaiting_others"],
		["Anything urgent today?", "urgent"],
		["Show my receipts from last month", "receipts"],
		["Which newsletters do I get?", "newsletters"],
		["Who emails me the most?", "top_contacts"],
		["How many emails did I get this week?", "volume_stats"],
		["Any suspicious sign-ins?", "security"],
		["What can you do?", "help"],
		["catch me up", "unread_summary"],
		["kubernetes migration", "find_topic"],
		["?", "other"],
		["", "other"],
	] as [string, Intent][])("%p → %s (free keyword planner)", (question, intent) => {
		expect(intentOf(question)).toBe(intent);
	});

	test("a chip's forced intent wins over the text", () => {
		expect(intentOf("Who owes me a reply?", { forcedIntent: "security" })).toBe("security");
	});

	test("options without a forced intent fall back to the planner", () => {
		expect(intentOf("Show my receipts", { context: { folder: "INBOX" } })).toBe("receipts");
	});
});

describe("useDemoAsk", () => {
	test("each ask bumps the nonce so repeats replay", () => {
		useDemoAsk.setState({ request: null });
		useDemoAsk.getState().ask("receipts");
		expect(useDemoAsk.getState().request).toEqual({ intent: "receipts", nonce: 1 });
		useDemoAsk.getState().ask("receipts");
		expect(useDemoAsk.getState().request).toEqual({ intent: "receipts", nonce: 2 });
	});
});
