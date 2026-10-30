/*
 * Where a URL may go when the page opens a window or navigates. Pages from
 * the local server (and blob: URLs they created) stay in the app; ordinary
 * web, mail and phone links go to the OS; everything else is dropped.
 */

export type Destination = { kind: "app" } | { kind: "external"; url: string } | { kind: "deny" };

const EXTERNAL = new Set(["http:", "https:", "mailto:", "tel:"]);

export function classifyUrl(raw: string, appOrigin: string | null): Destination {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { kind: "deny" };
	}
	// For blob: URLs, `origin` is the origin that created them.
	if (appOrigin && url.origin === appOrigin && (url.protocol === "http:" || url.protocol === "blob:")) {
		return { kind: "app" };
	}
	if (url.protocol === "blob:") return { kind: "deny" };
	if (EXTERNAL.has(url.protocol)) return { kind: "external", url: url.href };
	return { kind: "deny" };
}
