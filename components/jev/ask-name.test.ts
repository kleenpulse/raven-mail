import { describe, expect, test } from "bun:test";
import { askName } from "@/components/jev/ask-name";

describe("askName", () => {
  test("a user key or the server key keeps the Jev name", () => {
    expect(askName({ source: "user", hint: "abcd", kage: true })).toBe("Jev");
    expect(askName({ source: "server", hint: null, kage: true })).toBe("Jev");
  });

  test("no key with Kage on reads Ask Kage", () => {
    expect(askName({ source: null, hint: null, kage: true })).toBe("Kage");
  });

  test("no key with Kage off stays Jev, on its keyword rules", () => {
    expect(askName({ source: null, hint: null, kage: false })).toBe("Jev");
  });
});
