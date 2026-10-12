import type { MetadataRoute } from "next";
import { SEO_INDEX, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
	return SEO_INDEX ? [{ url: SITE_URL.origin }] : [];
}
