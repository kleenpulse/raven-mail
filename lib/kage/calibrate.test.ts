import { describe, expect, test } from "bun:test";
import { KAGE_MODEL, type DecisionClient } from "@/lib/kage";
import { sharpen } from "@/lib/kage/calibrate";
import { planAsk } from "@/lib/jev/ask/plan";
import type { Jev } from "@/lib/jev/client";

function fixed(model: string, answers: Record<string, unknown>): Jev {
  const client = { systemOne: async () => ({ model, answers }) } as unknown as DecisionClient;
  return { client, source: "kage" };
}

describe("sharpen", () => {
  test("power 1 changes nothing", () => {
    const p = { a: 0.6, b: 0.3, c: 0.1 };
    expect(sharpen(p, 1)).toBe(p);
  });

  test("above 1 sharpens, keeps the order, and still sums to 1", () => {
    const out = sharpen({ a: 0.6, b: 0.3, c: 0.1 }, 2);
    expect(out.a!).toBeGreaterThan(0.6);
    expect(out.a!).toBeGreaterThan(out.b!);
    expect(out.b!).toBeGreaterThan(out.c!);
    expect(out.a! + out.b! + out.c!).toBeCloseTo(1);
  });

  test("below 1 softens", () => {
    expect(sharpen({ a: 0.6, b: 0.4 }, 0.5).a!).toBeLessThan(0.6);
  });
});

describe("planAsk intent calibration", () => {
  const intent = { choice: "receipts", confidence: 0.6, probabilities: { receipts: 0.6, unread_summary: 0.3, other: 0.1 } };
  const answers = { intent, unreadOnly: { noul: 0.1 } };
  const q = "where is that bill";

  test("Kage's intent confidence is calibrated", async () => {
    const plan = await planAsk({ question: q }, [], fixed(KAGE_MODEL, answers), undefined, { intentPower: 2 });
    expect(plan.intent).toBe("receipts");
    expect(plan.intentConfidence).toBeCloseTo(sharpen(intent.probabilities, 2).receipts!, 2);
    expect(plan.intentConfidence).toBeGreaterThan(0.6);
  });

  test("Jev's answers are left alone", async () => {
    const plan = await planAsk({ question: q }, [], fixed("jev-1", answers), undefined, { intentPower: 2 });
    expect(plan.intentConfidence).toBe(0.6);
  });
});
