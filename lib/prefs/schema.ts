import { z } from "zod";

/**
 * Every tunable in one flat map. Keys are a stable contract: never reuse one
 * for a different meaning — rename by adding a key and migrating.
 */
export const PREF_SCHEMAS = {
	"appearance.uiSize": z.enum(["default", "large", "larger"]),
	"appearance.density": z.enum(["comfortable", "compact"]),
	"appearance.motion": z.enum(["system", "reduce"]),
	"appearance.reduceTransparency": z.boolean(),
	/** Absent = never answered (the reader asks once); false = "just this once". */
	"mail.remoteImages": z.boolean(),
	"mail.undoMs": z.union([z.literal(5000), z.literal(10_000), z.literal(20_000), z.literal(30_000)]),
	/** How long Send waits so it can be undone; 0 sends at once. */
	"mail.undoSend": z.union([z.literal(0), z.literal(5000), z.literal(10_000), z.literal(20_000), z.literal(30_000)]),
	"mail.preload": z.boolean(),
	/** Group the list into conversations and show the rest of each one in the reader. */
	"mail.threading": z.boolean(),
	"sync.focusRefetch": z.boolean(),
	"sync.freshness": z.enum(["live", "balanced", "saver"]),
	"sync.offlineCache": z.boolean(),
	"keyboard.singleKey": z.boolean(),
	"notify.bannerPosition": z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
	/** Spoken tour narration on this device. The accent itself follows the account (lib/tour). */
	"tour.narration": z.boolean(),
} as const;

export type NotifyBannerPosition = Prefs["notify.bannerPosition"];

export type PrefKey = keyof typeof PREF_SCHEMAS;
export type Prefs = { [K in PrefKey]: z.infer<(typeof PREF_SCHEMAS)[K]> };
export type Overrides = Partial<Prefs>;

export const DEFAULTS: Prefs = {
	"appearance.uiSize": "default",
	"appearance.density": "comfortable",
	"appearance.motion": "system",
	"appearance.reduceTransparency": false,
	"mail.remoteImages": false,
	"mail.undoMs": 5000,
	"mail.undoSend": 10_000,
	"mail.preload": true,
	"mail.threading": true,
	"sync.focusRefetch": true,
	"sync.freshness": "balanced",
	"sync.offlineCache": true,
	"keyboard.singleKey": true,
	"notify.bannerPosition": "bottom-right",
	"tour.narration": true,
};

export const PREF_KEYS = Object.keys(PREF_SCHEMAS) as PrefKey[];

/** Keeps the valid known keys; one bad value drops that key, not the whole blob. */
export function parseOverrides(raw: unknown): Overrides {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, unknown> = {};
	for (const key of PREF_KEYS) {
		if (!(key in raw)) continue;
		const parsed = PREF_SCHEMAS[key].safeParse((raw as Record<string, unknown>)[key]);
		if (parsed.success) out[key] = parsed.data;
	}
	return out as Overrides;
}

/** Pre-settings answer to the reader's "Always load images?" prompt. */
export const LEGACY_REMOTE_IMAGES_KEY = "raven-remote-images";

export function fromLegacy(remoteImages: string | null): Overrides {
	if (remoteImages === "always") return { "mail.remoteImages": true };
	if (remoteImages === "once") return { "mail.remoteImages": false };
	return {};
}
