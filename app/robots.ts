import type { MetadataRoute } from "next";
import { SEO_INDEX, SITE_URL } from "@/lib/site";

/**
 * Crawlable everywhere, so unindexed deployments can show their `noindex`;
 * app routes only redirect to /login and the API only answers 401.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/api/", "/overview", "/mail", "/integrations", "/dev"],
		},
		sitemap: SEO_INDEX ? new URL("/sitemap.xml", SITE_URL).href : undefined,
	};
}
