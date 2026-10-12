import type { Tone } from "@/components/integrations/status-pill";
import type { TestStatus } from "@/lib/dev/test-report";

export const STATUS_TONE: Record<TestStatus, Tone> = { pass: "ok", fail: "attention", skip: "paused", todo: "idle" };
export const STATUS_LABEL: Record<TestStatus, string> = { pass: "Pass", fail: "Fail", skip: "Skip", todo: "Todo" };

export function formatMs(ms: number): string {
	if (ms < 1) return "<1ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

export function formatPct(n: number | null): string {
	return n === null ? "—" : `${n >= 99.95 || n === 0 ? n.toFixed(0) : n.toFixed(1)}%`;
}

/** ok ≥ 80, warn ≥ 50, critical below. */
export function coverageTone(n: number | null): "ok" | "warn" | "critical" | "none" {
	if (n === null) return "none";
	return n >= 80 ? "ok" : n >= 50 ? "warn" : "critical";
}
