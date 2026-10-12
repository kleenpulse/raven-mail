import { describe, expect, test } from "bun:test";
import { extractKeywords, heuristicPlan, matchSender } from "@/lib/jev/ask/heuristic-plan";
import { explicitTimeframe, matchesTimeframe } from "@/lib/jev/ask/timeframe";
import type { PersonRef } from "@/lib/insights/types";
import type { Intent } from "@/lib/jev/ask/types";

const senders: PersonRef[] = [
  { name: "Maya Chen", address: "maya.chen@northwind.example" },
  { name: "Priya Raman", address: "priya@fieldwork.example" },
  { name: "Stripe", address: "receipts@stripe.example" },
];

describe("heuristicPlan routing", () => {
  test.each<[string, Intent]>([
    ["Who's waiting on my reply?", "needs_reply"],
    ["Who owes me a reply?", "awaiting_others"],
    ["Any follow-ups I should chase?", "awaiting_others"],
    ["What's urgent today?", "urgent"],
    ["Receipts from this month", "receipts"],
    ["Newsletters I never open", "newsletters"],
    ["Files I got this week", "attachments"],
    ["Any meeting invites this week?", "meetings"],
    ["Any security alerts?", "security"],
    ["How fast do I reply?", "response_time"],
    ["Who emails me most?", "top_contacts"],
    ["How much mail did I get this week?", "volume_stats"],
    ["What did I miss today?", "unread_summary"],
    ["Emails from Maya this week", "from_person"],
    ["anything about the roadmap", "find_topic"],
    ["??", "other"],
  ])("%s → %s", (question, intent) => {
    expect(heuristicPlan(question, senders).intent).toBe(intent);
  });

  test("timeframe + sender + keywords", () => {
    const plan = heuristicPlan("Emails from Maya about pricing this week", senders);
    expect(plan.timeframe).toBe("this_week");
    expect(plan.sender?.address).toBe("maya.chen@northwind.example");
    expect(plan.keywords).toEqual(["pricing"]);
  });

  test("defaults when no range is named", () => {
    expect(heuristicPlan("What did I miss?", senders).timeframe).toBe("today");
    expect(heuristicPlan("Who owes me a reply?", senders).scope).toBe("sent");
  });
});

describe("helpers", () => {
  test("sender matching by domain word", () => {
    expect(matchSender("any charges from stripe?", senders)?.sender.name).toBe("Stripe");
    expect(matchSender("nothing here", senders)).toBeNull();
  });

  test("keywords drop stopwords", () => {
    expect(extractKeywords("Anything about the Q3 roadmap launch?")).toEqual(["roadmap", "launch"]);
  });

  test("timeframes", () => {
    expect(explicitTimeframe("what came in yesterday")).toBe("yesterday");
    const today = { dateKey: "2026-09-24", hour: 15, minute: 0, weekday: 3 };
    expect(matchesTimeframe("2026-09-21", today, "this_week")).toBe(true);
    expect(matchesTimeframe("2026-09-20", today, "this_week")).toBe(false);
    expect(matchesTimeframe("2026-09-18", today, "last_7_days")).toBe(true);
    expect(matchesTimeframe("2026-09-17", today, "last_7_days")).toBe(false);
  });
});

describe("known misroutes", () => {
  // BUG: heuristic-plan.ts:14 — the needs_reply rule's "(reply|respond) to" fires before the
  // response_time rule (:23), so reply-speed questions naming a person route to needs_reply.
  test.todo("BUG: 'How fast do I reply to Maya?' routes to response_time", () => {
    expect(heuristicPlan("How fast do I reply to Maya?", senders).intent).toBe("response_time");
    expect(heuristicPlan("How long does Maya take to respond to me?", senders).intent).toBe("response_time");
  });
});
