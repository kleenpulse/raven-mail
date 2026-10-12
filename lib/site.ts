import type { Metadata } from "next";

export const SITE_NAME = "raven";

/**
 * Indexing is opt-in: every self-hosted copy serves the same landing page, and
 * a personal /login shouldn't be searchable. Only the official deployment sets it.
 */
export const SEO_INDEX = process.env.SEO_INDEX === "true";

/** Public origin for canonical, Open Graph and sitemap URLs. */
export const SITE_URL = siteUrl();

/** Spread into every `openGraph`: a segment's object replaces its parent's whole. */
export const OPEN_GRAPH = { type: "website", siteName: SITE_NAME } satisfies Metadata["openGraph"];

function siteUrl(): URL {
	const configured = process.env.APP_URL?.trim();
	if (configured) {
		try {
			return new URL(configured);
		} catch {
			throw new Error(`APP_URL must be an absolute URL such as https://mail.example.com (got "${configured}")`);
		}
	}
	const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
	if (vercel) return new URL(`https://${vercel}`);
	return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
}

/**
 * Where this deployment's source lives (AGPL-3.0 §13). Forks that run modified
 * code set NEXT_PUBLIC_SOURCE_URL to their own repository.
 */
export const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL?.trim() || "https://github.com/kleenpulse/raven-mail";
