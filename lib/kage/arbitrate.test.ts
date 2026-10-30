import { describe, expect, test } from "bun:test";
import { KAGE_MODEL, type DecisionClient } from "@/lib/kage";
import { arbitrate, noulConfidence } from "@/lib/kage/arbitrate";
import { heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { planAsk } from "@/lib/jev/ask/plan";
import type { Jev } from "@/lib/jev/client";
import { heuristicTriage } from "@/lib/triage/heuristic";
import { jevTriage } from "@/lib/triage/jev";

/** A client that answers with fixed answers, stamped as Kage or Jev. */
function fixed(model: string, answers: Record<string, unknown>): Jev {
  const client = { systemOne: async () => ({ model, answers }) } as unknown as DecisionClient;
  return { client, source: "kage" };
}

describe("arbitrate", () => {
  test("agreement keeps the label and the higher confidence", () => {
    expect(arbitrate({ label: "a", confidence: 0.4 }, { label: "a", confidence: 0.75 }, 0.5)).toEqual({ label: "a", confidence: 0.75, by: "kage" });
    expect(arbitrate({ label: "a", confidence: 0.9 }, { label: "a", confidence: 0.3 }, 0.5)).toEqual({ label: "a", confidence: 0.9, by: "kage" });
  });

  test("an unsure Kage gives way to a disagreeing heuristic", () => {
    expect(arbitrate({ label: "a", confidence: 0.4 }, { label: "b", confidence: 0.75 }, 0.5)).toEqual({ label: "b", confidence: 0.75, by: "heuristic" });
  });

  test("a sure Kage stands, and threshold 0 never overrules", () => {
    expect(arbitrate({ label: "a", confidence: 0.5 }, { label: "b", confidence: 0.75 }, 0.5).label).toBe("a");
    expect(arbitrate({ label: "a", confidence: 0.01 }, { label: "b", confidence: 0.99 }, 0).label).toBe("a");
  });

  test("a yes/no is as sure as its distance past the cut", () => {
    expect(noulConfidence(0.9, 0.6)).toBe(0.9);
    expect(noulConfidence(0.2, 0.6)).toBe(0.8);
    expect(noulConfidence(0.55, 0.6)).toBeCloseTo(0.45);
  });
});

describe("planAsk second opinion", () => {
  const q = "unread invoices";
  const unsure = { intent: { choice: "unread_summary", confidence: 0.4 }, unreadOnly: { noul: 0.9 } };
  const on = { intent: 0.5, category: 0, needsReply: 0 };

  test("the heuristic overrules an unsure Kage", async () => {
    expect(heuristicPlan(q, []).intent).toBe("receipts");
    const plan = await planAsk({ question: q }, [], fixed(KAGE_MODEL, unsure), undefined, { arbitration: on });
    expect(plan.intent).toBe("receipts");
    expect(plan.intentConfidence).toBe(0.75);
    expect(plan.source).toBe("kage");
  });

  test("Jev's answer and a sure Kage are left alone", async () => {
    expect((await planAsk({ question: q }, [], fixed("jev-1", unsure), undefined, { arbitration: on })).intent).toBe("unread_summary");
    const sure = { ...unsure, intent: { choice: "unread_summary", confidence: 0.9 } };
    expect((await planAsk({ question: q }, [], fixed(KAGE_MODEL, sure), undefined, { arbitration: on })).intent).toBe("unread_summary");
  });
});

describe("jevTriage second opinion", () => {
  const input = { subject: "Weekend plans?", from: "sara.lee@outlook.com", snippet: "Are you free on Saturday?" };
  const kageSays = (noul: number) => ({
    category: { choice: "other", confidence: 0.41 },
    urgency: { score: 0, confidence: 0.6 },
    needsReply: { noul },
  });
  const on = { intent: 0, category: 0.45, needsReply: 0.6 };

  test("an evidence-free category and an unsure yes/no give way", async () => {
    const keywords = heuristicTriage(input);
    expect(keywords.category).toBe("primary");
    expect(keywords.needsReply).toBe(true);
    const t = await jevTriage(input, { jev: fixed(KAGE_MODEL, kageSays(0.5)), arbitration: on });
    expect(t).toMatchObject({ category: "primary", confidence: keywords.confidence, needsReply: true, source: "kage" });
  });

  test("a sure no stands, and Jev is never overruled", async () => {
    expect((await jevTriage(input, { jev: fixed(KAGE_MODEL, kageSays(0.2)), arbitration: on })).needsReply).toBe(false);
    const jev = await jevTriage(input, { jev: fixed("jev-1", kageSays(0.5)), arbitration: on });
    expect(jev).toMatchObject({ category: "other", confidence: 0.41, needsReply: false, source: "jev" });
  });
});
