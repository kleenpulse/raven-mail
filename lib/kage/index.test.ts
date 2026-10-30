import { afterEach, describe, expect, mock, test } from "bun:test";
import { choice } from "@typesafe-ai/sdk";
import { answeredBy, kage, kageEnabled, KAGE_MODEL, withKageFallback, type DecisionClient } from "@/lib/kage";
import { heuristicPlan } from "@/lib/jev/ask/heuristic-plan";
import { planAsk } from "@/lib/jev/ask/plan";
import type { Jev } from "@/lib/jev/client";
import { jevTriage } from "@/lib/triage/jev";
import type { PersonRef } from "@/lib/insights/types";

const request = { state: { question: "receipts" }, questions: { pick: choice("Which?", { receipts: "Receipts", other: "None of these" }) } };
const failing = (err: Error): DecisionClient => ({ systemOne: mock(async () => Promise.reject(err)) as DecisionClient["systemOne"] });
const kageJev: Jev = { client: kage, source: "kage" };

afterEach(() => {
  delete process.env.KAGE;
});

describe("kageEnabled", () => {
  test("on unless KAGE says off", () => {
    expect(kageEnabled()).toBe(true);
    for (const off of ["off", "false", "0", " OFF "]) {
      process.env.KAGE = off;
      expect(kageEnabled()).toBe(false);
    }
    process.env.KAGE = "on";
    expect(kageEnabled()).toBe(true);
  });
});

describe("kage client", () => {
  test("answers like Jev and names itself", async () => {
    const res = await kage.systemOne(request);
    expect(res.model).toBe(KAGE_MODEL);
    expect(answeredBy(res)).toBe("kage");
    expect(answeredBy({ model: "jev-1.13.0" })).toBe("jev");
  });

  test("an aborted signal aborts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(kage.systemOne(request, { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("withKageFallback", () => {
  test("a failed Jev call is answered by Kage", async () => {
    const res = await withKageFallback(failing(new Error("403 Cannot authenticate"))).systemOne(request);
    expect(res.model).toBe(KAGE_MODEL);
    expect(res.answers.pick.choice).toBe("receipts");
  });

  test("a successful Jev call passes through untouched", async () => {
    const jevResult = { model: "jev-1.13.0", answers: { pick: { choice: "other" } }, usage: { input_tokens: 1, output_tokens: 1 } };
    const client = { systemOne: mock(async () => jevResult) } as unknown as DecisionClient;
    expect(await withKageFallback(client).systemOne(request)).toBe(jevResult as never);
  });

  test("aborts and KAGE=off still throw, so callers fall back to heuristics", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const err = new Error("boom");
    await expect(withKageFallback(failing(err)).systemOne(request, { signal: ctrl.signal })).rejects.toBe(err);
    process.env.KAGE = "off";
    await expect(withKageFallback(failing(err)).systemOne(request)).rejects.toBe(err);
  });

  test("onFallback hears each failure, and a plain failure is not a missed deadline", async () => {
    const err = new Error("429");
    const heard: [unknown, boolean][] = [];
    await withKageFallback(failing(err), { onFallback: (e, timedOut) => heard.push([e, timedOut]) }).systemOne(request);
    expect(heard).toEqual([[err, false]]);
  });
});

describe("withKageFallback deadline", () => {
  /** Never answers; rejects only when its signal aborts, like the SDK. */
  const hanging = () => {
    const calls: AbortSignal[] = [];
    const client: DecisionClient = {
      systemOne: ((_req: unknown, options?: { signal?: AbortSignal }) => {
        const signal = options!.signal!;
        calls.push(signal);
        if (signal.aborted) return Promise.reject(new Error("aborted"));
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }) as DecisionClient["systemOne"],
    };
    return { client, calls };
  };

  test("Kage answers once the deadline passes, and the same client skips Jev after that", async () => {
    const { client, calls } = hanging();
    const timedOut: boolean[] = [];
    const jev = withKageFallback(client, { deadlineMs: 30, onFallback: (_, t) => timedOut.push(t) });
    const started = performance.now();
    const res = await jev.systemOne(request);
    expect(res.model).toBe(KAGE_MODEL);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(timedOut).toEqual([true]);
    expect((await jev.systemOne(request)).model).toBe(KAGE_MODEL);
    expect(calls).toHaveLength(1);
  });

  test("the caller's own abort still throws, and doesn't count as a miss", async () => {
    const { client, calls } = hanging();
    const heard: boolean[] = [];
    const jev = withKageFallback(client, { deadlineMs: 5_000, onFallback: (_, t) => heard.push(t) });
    const ctrl = new AbortController();
    const pending = jev.systemOne(request, { signal: ctrl.signal });
    ctrl.abort();
    // Not `rejects`: bun spins forever on it after an abort (see tooling notes).
    expect(await pending.catch((e: Error) => e.message)).toBe("aborted");
    expect(heard).toEqual([]);
    expect(await jev.systemOne(request, { signal: AbortSignal.abort() }).catch((e: Error) => e.message)).toBe("aborted");
    expect(calls).toHaveLength(2);
  });
});

const CONTACTS: PersonRef[] = [
  { name: "Maya Chen", address: "maya@acme.com" },
  { name: "Stripe", address: "receipts@stripe.com" },
  { name: "Amazon", address: "auto-confirm@amazon.com" },
];

describe("planAsk on Kage", () => {
  test("labels the plan as Kage's", async () => {
    const plan = await planAsk({ question: "Who owes me a reply?" }, CONTACTS, kageJev);
    expect(plan.source).toBe("kage");
    expect(plan.intent).toBe("awaiting_others");
    expect(plan.scope).toBe("sent");
  });

  test("a named contact turns a generic guess into from_person", async () => {
    const plan = await planAsk({ question: "show unread emails from Maya" }, CONTACTS, kageJev);
    expect(plan.intent).toBe("from_person");
    expect(plan.sender?.address).toBe("maya@acme.com");
    expect(plan.unreadOnly).toBe(true);
  });

  test("a word that happens to be in a mailbox name is not a contact", async () => {
    // "?" used to meet auto-confirm@amazon.com, and "receipts" meets receipts@stripe.com.
    const missed = await planAsk({ question: "What did I miss today?" }, CONTACTS, kageJev);
    expect(missed.intent).toBe("unread_summary");
    expect(missed.sender).toBeUndefined();
    const receipts = await planAsk({ question: "unread receipts" }, CONTACTS, kageJev);
    expect(receipts.intent).not.toBe("from_person");
  });

  test("questions keyword rules miss still land", async () => {
    for (const [q, intent] of [
      ["catch me up on my inbox", "unread_summary"],
      ["where's my package", "receipts"],
      ["anything time-sensitive I should know about", "urgent"],
    ] as const) {
      expect((await planAsk({ question: q }, CONTACTS, kageJev)).intent).toBe(intent);
    }
    expect(heuristicPlan("where's my package", CONTACTS).intent).not.toBe("receipts");
  });
});

describe("jevTriage on Kage", () => {
  test("labels the result as Kage's and keeps it in range", async () => {
    const t = await jevTriage(
      { subject: "Production is down", from: "jonas@northwind.io", snippet: "Blocked until you approve the rollback. Please call me immediately." },
      { jev: kageJev },
    );
    expect(t.source).toBe("kage");
    expect(t.urgency).toBeGreaterThan(0.5);
    expect(t.urgency).toBeLessThanOrEqual(1);
    expect(t.needsReply).toBe(true);
  });
});
