/*
 * The Content Security Policy the main process adds to every response from
 * the local server (preview and installed builds; `next dev` needs eval and
 * a websocket, so dev runs without it).
 *
 * What it can't block yet: inline scripts (Next's RSC payload and the theme
 * and prefs scripts are inline, and nonces need middleware) and image
 * requests to any site (email bodies load remote images when you allow them,
 * and srcdoc frames inherit this policy). What it does block: scripts,
 * plugins and frames from anywhere else, fetch/XHR to other sites, a
 * planted <base>, forms posting off-site, and other pages framing Raven.
 */

const DIRECTIVES: readonly (readonly [string, ...string[]])[] = [
	["default-src", "'self'"],
	["script-src", "'self'", "'unsafe-inline'"],
	// Email bodies may pull styles and fonts from their sender's site.
	["style-src", "'self'", "'unsafe-inline'", "https:", "http:"],
	["font-src", "'self'", "data:", "https:", "http:"],
	["img-src", "'self'", "data:", "blob:", "https:", "http:"],
	// Attachment previews (audio, video, PDF) are blob: URLs.
	["media-src", "'self'", "blob:"],
	["frame-src", "'self'", "blob:"],
	["worker-src", "'self'", "blob:"],
	["connect-src", "'self'"],
	["object-src", "'none'"],
	["base-uri", "'self'"],
	["form-action", "'self'"],
	["frame-ancestors", "'none'"],
];

export const CSP_HEADER = "Content-Security-Policy";

export function contentSecurityPolicy(): string {
	return DIRECTIVES.map((directive) => directive.join(" ")).join("; ");
}

/**
 * Response headers with the policy added. Policies a response already sets
 * (attachments send their own, stricter one) stay: the browser enforces both.
 */
export function withCsp(headers: Record<string, string[]> | undefined, policy: string): Record<string, string[]> {
	const out: Record<string, string[]> = { ...headers };
	const key = Object.keys(out).find((name) => name.toLowerCase() === CSP_HEADER.toLowerCase()) ?? CSP_HEADER;
	out[key] = [...(out[key] ?? []), policy];
	return out;
}
