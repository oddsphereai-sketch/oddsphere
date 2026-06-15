import type { MetadataRoute } from "next";

/**
 * sitemap.xml (App Router metadata route). PUBLIC, indexable routes ONLY.
 *
 * Deliberately EXCLUDED:
 *   • /lab/* (member Daily Edge + premium picks) and /admin/* — private, must
 *     never be exposed; also noindex + auth-gated.
 *   • /login (auth form), /join, /tools, /picks — auth utility / 308 redirects
 *     with no standalone content.
 *   • any active-slate / premium pick URL.
 *
 * If a new PUBLIC marketing/proof page is added, add it here explicitly —
 * the sitemap is an allowlist, not a crawl of the route tree.
 */
const SITE_URL = "https://www.oddsphereai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });

  return [
    page("/", 1.0, "weekly"), // homepage — brand/value
    page("/pricing", 0.9, "monthly"), // premium conversion
    page("/track-record", 0.8, "daily"), // public proof / results (updates often)
    page("/legal/responsible-gambling", 0.3, "yearly"),
    page("/legal/privacy", 0.3, "yearly"),
    page("/legal/terms", 0.3, "yearly"),
  ];
}
