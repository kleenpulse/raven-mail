import { describe, expect, test } from "bun:test";
import { paneOf, type PaneInput } from "@/lib/query-pane";

const q = (over: Partial<PaneInput>): PaneInput => ({
  hasData: false,
  isError: false,
  isRefetchError: false,
  fetchStatus: "idle",
  ...over,
});

describe("paneOf", () => {
  test("loaded data stays on screen after a failed refetch", () => {
    expect(paneOf(q({ hasData: true, isError: true, isRefetchError: true }))).toEqual({ pane: "ready", refreshFailed: true });
  });

  test("a failed next page keeps the rows too", () => {
    expect(paneOf(q({ hasData: true, isError: true, isFetchNextPageError: true }))).toEqual({ pane: "ready", refreshFailed: true });
  });

  test("loaded data with no error is plain ready", () => {
    expect(paneOf(q({ hasData: true, fetchStatus: "fetching" }))).toEqual({ pane: "ready", refreshFailed: false });
  });

  test("nothing loaded and paused is waiting", () => {
    expect(paneOf(q({ fetchStatus: "paused" })).pane).toBe("waiting");
  });

  test("a cached failure reopened offline is waiting, not failed", () => {
    expect(paneOf(q({ isError: true, fetchStatus: "paused" })).pane).toBe("waiting");
  });

  test("nothing loaded and an error is failed", () => {
    expect(paneOf(q({ isError: true })).pane).toBe("failed");
  });

  test("nothing loaded yet is loading", () => {
    expect(paneOf(q({ fetchStatus: "fetching" })).pane).toBe("loading");
  });
});
