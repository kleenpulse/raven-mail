import { getPref } from "@/lib/prefs/store";

const FRESHNESS_FACTOR = { live: 0.5, balanced: 1, saver: 3 } as const;

/**
 * The one place prefs meet query config. TanStack evaluates function options
 * on every check, so a changed setting applies without re-rendering anything.
 */
export function stale(ms: number) {
	return () => ms * FRESHNESS_FACTOR[getPref("sync.freshness")];
}

export const focusRefetch = () => getPref("sync.focusRefetch");
