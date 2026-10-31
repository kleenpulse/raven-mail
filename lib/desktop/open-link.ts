/*
 * The public `/open` page hands links from shared cards to the desktop app.
 * It only passes on the links the app opens (the app checks them again,
 * desktop/links.ts), so the page can't be used to launch anything else.
 */

const RAVEN_OPEN = /^raven:\/\/open\/(?:mail|overview)\/?(?:\?[^#\s]*)?$/;

/** `to` if it's a raven:// link for the desktop app, else null. */
export function bounceTarget(to: string | null | undefined): string | null {
	if (!to || to.length > 4096) return null;
	return RAVEN_OPEN.test(to) ? to : null;
}

/** The same page in the web app, for someone signed in to Raven in this browser. */
export function webPath(target: string): string {
	return target.slice("raven://open".length).replace(/^\/(mail|overview)\/(?=\?|$)/, "/$1");
}
