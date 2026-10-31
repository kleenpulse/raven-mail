/*
 * What the desktop app's preload exposes (desktop/preload.ts). Undefined on
 * the web and anywhere outside the desktop window's own page.
 */

export type DesktopNewMail = { uid: string; from: string; subject: string };

export type RavenDesktop = {
	/** Asks for a system notification; the desktop app checks and caps the items. */
	notifyNewMail(items: DesktopNewMail[]): void;
	/** Paths in this app the desktop app wants shown (a notification or a link was clicked). Returns an unsubscribe. */
	onOpen(callback: (path: string) => void): () => void;
	/** Whether Raven opens email links, and a way to ask for it. */
	mailApp: {
		status(): Promise<DesktopMailAppStatus>;
		/** Makes Raven the email app, or on Windows opens the Settings page where the user picks it. */
		claim(): Promise<DesktopMailAppStatus>;
	};
};

/** `viaSettings`: the system's own settings decide (Windows), not Raven. */
export type DesktopMailAppStatus = { isDefault: boolean; viaSettings: boolean };

declare global {
	interface Window {
		ravenDesktop?: RavenDesktop;
	}
}

export function ravenDesktop(): RavenDesktop | undefined {
	return typeof window === "undefined" ? undefined : window.ravenDesktop;
}

/** Same-app paths only: the desktop app already checked it, this is a second lock. */
export function isAppPath(path: string): boolean {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		// The URL parser drops tabs and newlines, so "/\t/evil.test" would leave the app.
		return new URL(path, "http://raven.invalid").origin === "http://raven.invalid";
	} catch {
		return false;
	}
}

/** Most items the desktop app takes in one message. */
export const MAX_NOTIFY = 50;

type Arrival = { uid: string; subject: string; from: { name?: string; address: string } };

/**
 * What to hand the desktop app for a system notification, or null: only
 * when the setting is on and Raven isn't the window in use.
 */
export function newMailForDesktop(arrivals: readonly Arrival[], opts: { enabled: boolean; focused: boolean }): DesktopNewMail[] | null {
	if (!opts.enabled || opts.focused || arrivals.length === 0) return null;
	return arrivals.slice(0, MAX_NOTIFY).map((m) => ({ uid: m.uid, from: m.from.name || m.from.address, subject: m.subject }));
}
