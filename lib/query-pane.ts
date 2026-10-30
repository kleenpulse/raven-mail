/*
 * Which state a pane shows for a query. Pure, so the list, the reader and
 * the tests agree on the order the checks run in.
 */

export type PaneInput = {
  hasData: boolean;
  isError: boolean;
  isRefetchError: boolean;
  isFetchNextPageError?: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
};

export type Pane = "loading" | "waiting" | "failed" | "ready";

export function paneOf(q: PaneInput): { pane: Pane; refreshFailed: boolean } {
  // Loaded mail stays on screen whatever a later fetch did.
  if (q.hasData) return { pane: "ready", refreshFailed: q.isRefetchError || Boolean(q.isFetchNextPageError) };
  // Paused before error: TanStack keeps status "error" while the next attempt waits for a connection.
  if (q.fetchStatus === "paused") return { pane: "waiting", refreshFailed: false };
  if (q.isError) return { pane: "failed", refreshFailed: false };
  return { pane: "loading", refreshFailed: false };
}
