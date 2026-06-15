import type { MetadataRoute } from "next";

/**
 * robots.txt (App Router metadata route). Allows crawling of the public
 * marketing/proof pages and disallows the member app, admin, API, auth
 * utility, and the 308-redirect stubs.
 *
 * NOTE: robots.txt is a crawl directive, NOT an access control. The member
 * (`/lab/*`) and admin (`/admin/*`) trees are additionally protected by
 * middleware auth (redirect to /login) AND `robots: { index:false }`
 * metadata on their layouts — robots disallow here is defense-in-depth so
 * crawlers don't waste budget on them.
 */
const SITE_URL = "https://www.oddsphereai.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/lab/", // member Daily Edge product + premium picks
        "/admin/", // internal admin dashboards
        "/api/", // API routes (member data is auth-gated 401 anyway)
        "/login", // auth form — no SEO value
        "/join", // 308 redirect
        "/tools", // 308 redirect → /lab
        "/picks", // 308 redirect → premium /lab/daily-edge
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
