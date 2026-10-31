/*
 * The public `/open` page hands links from shared cards to the desktop app.
 * It only passes on the links the app opens (the app checks them again,
 * desktop/links.ts), so the page can't be used to launch anything else.
 */

const RAVEN_OPEN = /^raven:\/\/open\/(mail|overview)\/?(\?[^#\s]*)?$/;

/** The query keys each page takes, as in the desktop app's own check. */
const KEYS: Record<string, ReadonlySet<string>> = {
	mail: new Set(["folder", "uid", "mid"]),
	overview: new Set(),
};

/** `to` if it's a raven:// link the desktop app opens, else null. */
export function bounceTarget(to: string | null | undefined): string | null {
	if (!to || to.length > 4096) return null;
	const match = RAVEN_OPEN.exec(to);
	if (!match) return null;
	const keys = [...new URLSearchParams(match[2] ?? "").keys()];
	const allowed = KEYS[match[1]!]!;
	if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return null;
	return to;
}

/** The same page in the web app, for someone signed in to Raven in this browser. */
export function webPath(target: string): string {
	return target.slice("raven://open".length).replace(/^\/(mail|overview)\/(?=\?|$)/, "/$1");
}
