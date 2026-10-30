import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { APIConnectionError, APITimeoutError, AuthenticationError, InternalServerError, PermissionDeniedError, RateLimitError } from "@typesafe-ai/sdk";
import { fallbackCount, fallbackReason, fallbackStats, recordFallback, resetFallbackStats } from "@/lib/jev/fallbacks";

afterEach(() => resetFallbackStats());

describe("fallbackReason", () => {
  test("names the kind of failure", () => {
    const headers = new Headers();
    expect(fallbackReason(new PermissionDeniedError(403, {}, headers))).toBe("auth");
    expect(fallbackReason(new AuthenticationError(401, {}, headers))).toBe("auth");
    expect(fallbackReason(new RateLimitError(429, {}, headers))).toBe("rate_limit");
    expect(fallbackReason(new APITimeoutError(8_000))).toBe("timeout");
    expect(fallbackReason(new APIConnectionError())).toBe("network");
    expect(fallbackReason(new InternalServerError(503, {}, headers))).toBe("server");
    expect(fallbackReason(new Error("boom"))).toBe("other");
  });

  test("a missed deadline is a timeout, whatever the abort looked like", () => {
    expect(fallbackReason(new Error("The operation was aborted."), true)).toBe("timeout");
  });
});

describe("recordFallback", () => {
  test("counts per key and for the process, and logs each reason once", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      recordFallback("key-a", "server", "auth", new PermissionDeniedError(403, {}, new Headers()));
      recordFallback("key-a", "server", "auth");
      recordFallback("key-b", "user", "timeout");
      expect(fallbackCount("key-a")).toMatchObject({ count: 2, last: { reason: "auth" } });
      expect(fallbackCount("key-b")).toMatchObject({ count: 1, last: { reason: "timeout" } });
      expect(fallbackCount("key-c")).toEqual({ count: 0, last: null });
      expect(fallbackStats()).toMatchObject({ count: 3, reasons: { auth: 2, timeout: 1 }, last: { reason: "timeout" } });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("key-a");
    } finally {
      warn.mockRestore();
    }
  });
});
