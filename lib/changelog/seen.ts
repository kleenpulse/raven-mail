/** The running version: inlined by next.config `env`, so no package.json in the client bundle. */
export const APP_VERSION = process.env.APP_VERSION ?? "0.0.0";

/**
 * Which version's What's New card this browser has dismissed. Per device: Raven
 * keeps no per-user settings row, and a missed card on a second device costs nothing.
 * Kept out of the prefs store so Reset All Settings never replays the card.
 */
export const LAST_SEEN_KEY = "raven-last-seen-version";

/**
 * - `seed`: nothing recorded (first session, cleared storage) — record the version
 *   silently; a card about "changes" on day one would describe nothing the user knew.
 * - `show`: a real upgrade since the last dismissal.
 */
export function whatsNewAction(seen: string | null, current: string): "seed" | "show" | "none" {
	if (seen === null) return "seed";
	return seen === current ? "none" : "show";
}

export function readLastSeen(): string | null {
	try {
		return localStorage.getItem(LAST_SEEN_KEY);
	} catch {
		return null;
	}
}

export function writeLastSeen(version: string): void {
	try {
		localStorage.setItem(LAST_SEEN_KEY, version);
	} catch {
		/* storage unavailable: the card may show again next load */
	}
}
