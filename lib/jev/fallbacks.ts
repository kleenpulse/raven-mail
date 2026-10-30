import "server-only";
import { APIConnectionError, APIError, APITimeoutError, AuthenticationError, PermissionDeniedError, RateLimitError } from "@typesafe-ai/sdk";

/*
 * Fallbacks: every answer Kage gives because a key's Jev call failed, or
 * because the key was skipped as rejected. Counted per key (the UI only sees
 * its own key's count) and for the whole process (/dev/kage). Each reason is
 * logged once per process, so a dead key shows up in the logs on day one
 * without flooding them.
 */
export type FallbackReason = "auth" | "rate_limit" | "timeout" | "network" | "server" | "other";
export type FallbackCount = { count: number; last: { reason: FallbackReason; at: string } | null };
export type FallbackStats = FallbackCount & { reasons: Partial<Record<FallbackReason, number>> };

const MAX_FALLBACK_KEYS = 100;
const fallbacksByKey = new Map<string, FallbackCount>();
const fallbackTotals: FallbackStats = { count: 0, last: null, reasons: {} };
const loggedReasons = new Set<FallbackReason>();

export function fallbackReason(err: unknown, timedOut = false): FallbackReason {
  // A timeout is a kind of connection error, so it is checked first.
  if (timedOut || err instanceof APITimeoutError) return "timeout";
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return "auth";
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof APIConnectionError) return "network";
  if (err instanceof APIError && err.status >= 500) return "server";
  return "other";
}

export function recordFallback(apiKey: string, source: "user" | "server", reason: FallbackReason, err?: unknown) {
  const last = { reason, at: new Date().toISOString() };
  const entry = fallbacksByKey.get(apiKey) ?? { count: 0, last: null };
  fallbacksByKey.delete(apiKey);
  if (fallbacksByKey.size >= MAX_FALLBACK_KEYS) fallbacksByKey.delete(fallbacksByKey.keys().next().value!);
  fallbacksByKey.set(apiKey, { count: entry.count + 1, last });
  fallbackTotals.count++;
  fallbackTotals.reasons[reason] = (fallbackTotals.reasons[reason] ?? 0) + 1;
  fallbackTotals.last = last;
  if (loggedReasons.has(reason)) return;
  loggedReasons.add(reason);
  // Never the key or the request: only what kind of failure it was.
  const detail = err instanceof APIError ? `${err.name} ${err.status}` : err instanceof Error ? err.name : "key rejected earlier, Jev skipped";
  console.warn(`[jev] ${source} key: Jev failed (${reason}, ${detail}), Kage answered. Later "${reason}" failures are counted on /dev/kage, not logged.`);
}

/** One key's count, for its own JevStatus. */
export function fallbackCount(apiKey: string): FallbackCount {
  return fallbacksByKey.get(apiKey) ?? { count: 0, last: null };
}

/** Process-wide fallback counts, for /dev/kage. */
export function fallbackStats(): FallbackStats {
  return { ...fallbackTotals, reasons: { ...fallbackTotals.reasons } };
}

/** For tests only. */
export function resetFallbackStats() {
  fallbacksByKey.clear();
  loggedReasons.clear();
  Object.assign(fallbackTotals, { count: 0, last: null, reasons: {} });
}
