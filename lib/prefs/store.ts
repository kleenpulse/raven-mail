import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
	DEFAULTS,
	fromLegacy,
	LEGACY_REMOTE_IMAGES_KEY,
	parseOverrides,
	type Overrides,
	type PrefKey,
	type Prefs,
} from "@/lib/prefs/schema";

export const PREFS_STORAGE_KEY = "raven-prefs";

type PrefsState = { overrides: Overrides };

function readLegacy(): Overrides {
	try {
		return fromLegacy(localStorage.getItem(LEGACY_REMOTE_IMAGES_KEY));
	} catch {
		return {};
	}
}

/**
 * Only what the user changed is stored. A setting is "modified" when its key
 * is present; reset deletes it, so a default changed in a later release still
 * reaches everyone who never touched it.
 */
export const usePrefsStore = create<PrefsState>()(
	persist(() => ({ overrides: {} }), {
		name: PREFS_STORAGE_KEY,
		version: 1,
		storage: createJSONStorage(() => localStorage),
		partialize: (s) => ({ overrides: s.overrides }),
		merge: (persisted, current) => ({
			...current,
			overrides: persisted
				? parseOverrides((persisted as Partial<PrefsState>).overrides)
				: readLegacy(),
		}),
	}),
);

if (typeof window !== "undefined") {
	// Another tab changed a setting: this one follows.
	window.addEventListener("storage", (e) => {
		if (e.key === PREFS_STORAGE_KEY) void usePrefsStore.persist.rehydrate();
	});
}

function resolve<K extends PrefKey>(overrides: Overrides, key: K): Prefs[K] {
	return key in overrides ? (overrides[key] as Prefs[K]) : DEFAULTS[key];
}

/** For code outside React (query options, timers, key handlers): always current. */
export function getPref<K extends PrefKey>(key: K): Prefs[K] {
	return resolve(usePrefsStore.getState().overrides, key);
}

/** Re-renders only when this one setting changes. Defaults during SSR and hydration. */
export function usePref<K extends PrefKey>(key: K): Prefs[K] {
	return usePrefsStore((s) => resolve(s.overrides, key));
}

export function useIsModified(key: PrefKey): boolean {
	return usePrefsStore((s) => key in s.overrides);
}

/** Lists (Inbox tabs) match by members, so turning every tab back on clears the dot. */
function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v) => b.includes(v));
	return a === b;
}

/** Keys where an explicit answer differs from never having been asked. */
const ANSWER_KEYS: ReadonlySet<PrefKey> = new Set(["mail.remoteImages"]);

export function setPref<K extends PrefKey>(key: K, value: Prefs[K]) {
	usePrefsStore.setState((s) => {
		const next = { ...s.overrides, [key]: value };
		// Choosing the default is the same as never changing it: no dot, and future default changes still apply.
		if (sameValue(value, DEFAULTS[key]) && !ANSWER_KEYS.has(key)) delete next[key];
		return { overrides: next };
	});
	try {
		localStorage.removeItem(LEGACY_REMOTE_IMAGES_KEY);
	} catch {
		/* storage blocked */
	}
}

export function resetPrefs(keys?: readonly PrefKey[]) {
	usePrefsStore.setState((s) => {
		if (!keys) return { overrides: {} };
		const next = { ...s.overrides };
		for (const key of keys) delete next[key];
		return { overrides: next };
	});
}
