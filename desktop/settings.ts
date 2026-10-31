import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Settings the desktop shell owns (the page's own settings live in the
 * page), kept in settings.json next to window-state.json.
 */

export type DesktopSettings = {
	/** Closing the window hides it, and Raven keeps checking for mail. */
	keepRunning: boolean;
	/** The "Raven is still running" notice was shown once already. */
	trayHintShown: boolean;
};

export const DEFAULT_SETTINGS: DesktopSettings = { keepRunning: true, trayHintShown: false };

/** Known keys with the right type win; anything else falls back to the default. */
export function parseSettings(text: string | null): DesktopSettings {
	if (!text) return { ...DEFAULT_SETTINGS };
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
	const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const flag = (key: keyof DesktopSettings) => (typeof record[key] === "boolean" ? (record[key] as boolean) : DEFAULT_SETTINGS[key]);
	return { keepRunning: flag("keepRunning"), trayHintShown: flag("trayHintShown") };
}

function settingsFile(userData: string): string {
	return join(userData, "settings.json");
}

export function loadSettings(userData: string): DesktopSettings {
	try {
		return parseSettings(readFileSync(settingsFile(userData), "utf8"));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(userData: string, settings: DesktopSettings): void {
	const path = settingsFile(userData);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
	renameSync(tmp, path);
}
