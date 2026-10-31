/*
 * What the desktop app's preload exposes (desktop/preload.ts). Undefined on
 * the web and anywhere outside the desktop window's own page.
 */

export type DesktopNewMail = { uid: string; from: string; subject: string };

export type RavenDesktop = {
	/** Asks for a system notification; the desktop app checks and caps the items. */
	notifyNewMail(items: DesktopNewMail[]): void;
	/** Paths in this app the desktop app wants shown (a notification was clicked). Returns an unsubscribe. */
	onOpen(callback: (path: string) => void): () => void;
};

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
	return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
