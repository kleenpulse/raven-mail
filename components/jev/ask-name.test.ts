import { describe, expect, test } from "bun:test";
import { answeredBy, askName } from "@/components/jev/ask-name";
import type { AskTurn } from "@/components/jev/ask-store";

describe("askName", () => {
  test("a live user key or server key keeps the Jev name", () => {
    expect(askName({ source: "user", hint: "abcd", kage: true, live: true })).toBe("Jev");
    expect(askName({ source: "server", hint: null, kage: true, live: true })).toBe("Jev");
  });

  test("a key TypeSafe rejected reads Ask Kage", () => {
    expect(askName({ source: "server", hint: null, kage: true, live: false })).toBe("Kage");
    expect(askName({ source: "user", hint: "abcd", kage: true, live: false })).toBe("Kage");
  });

  test("no key with Kage on reads Ask Kage", () => {
    expect(askName({ source: null, hint: null, kage: true, live: false })).toBe("Kage");
  });

  test("with Kage off it stays Jev, on its keyword rules", () => {
    expect(askName({ source: null, hint: null, kage: false, live: false })).toBe("Jev");
    expect(askName({ source: "server", hint: null, kage: false, live: false })).toBe("Jev");
  });
});

const turn = (source?: string): AskTurn =>
  ({ id: source ?? "x", question: "q", status: "done", stages: [], at: 0, answer: source ? { plan: { source } } : undefined }) as AskTurn;

describe("answeredBy", () => {
  test("no answers yet names nobody, so the key's guess stands", () => {
    expect(answeredBy([])).toBeNull();
    expect(answeredBy([turn()])).toBeNull();
  });

  test("a dead key that fell back to Kage reads Kage", () => {
    expect(answeredBy([turn("kage")])).toBe("Kage");
  });

  test("the latest engine answer wins; keyword and suggested answers are skipped", () => {
    expect(answeredBy([turn("kage"), turn("jev")])).toBe("Jev");
    expect(answeredBy([turn("jev"), turn("kage"), turn("heuristic"), turn("forced")])).toBe("Kage");
  });
});
