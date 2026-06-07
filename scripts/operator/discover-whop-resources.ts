/**
 * Phase 6B.3a.1 — Whop resource discovery (read-only).
 *
 * Reads WHOP_API_KEY from .env.local (via tsx --env-file) and probes
 * the Whop REST API to find:
 *   1. Your company id  (biz_xxx)
 *   2. All products in that company (prod_xxx + title + route slug)
 *   3. All experiences (exp_xxx + name + product link)
 *
 * The output highlights the row that matches the public product slug
 * the user provided (default: "oddsphereai-premium") so the right
 * value for WHOP_RESOURCE_ID is unambiguous.
 *
 * STRICT READ-ONLY:
 *   • Only GET requests against https://api.whop.com/api/v1
 *   • Never prints the API key (masks to last 4 chars).
 *   • Never writes to .env or anywhere else.
 *   • Never POSTs / PATCHes / DELETEs.
 *
 * Endpoints used (verified against Whop docs, June 2026):
 *   GET /api/v1/companies                       (list-companies)
 *   GET /api/v1/products?company_id=biz_xxx     (list-products)
 *   GET /api/v1/experiences?company_id=biz_xxx  (list-experiences, optional)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/discover-whop-resources.ts
 *   npx tsx --env-file=.env.local scripts/operator/discover-whop-resources.ts --slug oddsphereai-premium
 *   npx tsx --env-file=.env.local scripts/operator/discover-whop-resources.ts --verbose
 */

const BASE = "https://api.whop.com/api/v1";
const DEFAULT_SLUG = "oddsphereai-premium";

type CliFlags = { slug: string; verbose: boolean; companyId: string | null };

function parseFlags(argv: string[]): CliFlags {
  let slug = DEFAULT_SLUG;
  let verbose = false;
  let companyId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug" && i + 1 < argv.length) {
      slug = argv[i + 1]!;
      i++;
    } else if (a === "--company-id" && i + 1 < argv.length) {
      companyId = argv[i + 1]!;
      i++;
    } else if (a === "--verbose") {
      verbose = true;
    } else if (a === "--apply") {
      console.error("ERROR: --apply not supported. This script is read-only.");
      process.exit(2);
    }
  }
  return { slug, verbose, companyId };
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
}

async function whopGet<T>(path: string, key: string, query?: Record<string, string>): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const url = new URL(`${BASE}${path}`);
  if (query !== undefined) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", headers });
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, status: 0, body: `Bad JSON: ${(e as Error).message}` };
  }
}

type Company = {
  id: string;
  title: string | null;
  route: string | null;
  member_count?: number;
  verified?: boolean;
  owner_user?: { username?: string };
};

type Product = {
  id: string;
  title: string | null;
  route: string | null;
  visibility?: string;
  member_count?: number;
  headline?: string | null;
  verified?: boolean;
};

type Experience = {
  id: string;
  name?: string | null;
  app?: { id?: string; name?: string | null } | null;
  product?: { id?: string; title?: string | null; route?: string | null } | null;
};

type Listing<T> = { data: T[]; page_info?: { has_next_page?: boolean } };

async function main() {
  const { slug, verbose, companyId } = parseFlags(process.argv.slice(2));

  console.log("\n━━━ Whop resource discovery (read-only) ━━━\n");

  const key = process.env.WHOP_API_KEY;
  if (!key || key.length === 0) {
    console.error(
      "ERROR: WHOP_API_KEY is not set. Run with:\n" +
        "  npx tsx --env-file=.env.local scripts/operator/discover-whop-resources.ts",
    );
    process.exit(1);
  }
  console.log(`  WHOP_API_KEY:      ${maskKey(key)}`);
  console.log(`  Target product slug: ${slug}`);
  console.log(`  Endpoint base:     ${BASE}`);
  if (companyId !== null) console.log(`  --company-id flag: ${companyId} (skipping /companies probe)`);
  console.log("");

  // ── 1. Resolve company id ────────────────────────────────────────────
  let preferredCompany: Company;
  if (companyId !== null) {
    preferredCompany = { id: companyId, title: null, route: null };
    console.log(`[1/3] Using --company-id ${companyId} (verifying access via /products call below).\n`);
  } else {
    console.log("[1/3] GET /companies — finding your company id (biz_xxx)…");
    const companies = await whopGet<Listing<Company>>("/companies", key, { first: "50" });
    if (!companies.ok) {
      const missingCompanyScope = /company:basic:read/i.test(companies.body);
      console.error(`  ✗ HTTP ${companies.status}: ${companies.body.slice(0, 500)}`);
      console.error("");
      if (missingCompanyScope) {
        console.error("  The API key has access_pass:basic:read (good — lists products) but");
        console.error("  is missing company:basic:read (can't list companies). Two ways forward:");
        console.error("");
        console.error("    a. RE-RUN with --company-id biz_xxxxxxxxxxxxxx");
        console.error("       Find your biz_xxx by viewing-source on your storefront,");
        console.error("       e.g. https://whop.com/oddsphereai/ — `biz_…` appears in the markup.");
        console.error("");
        console.error("    b. CREATE A NEW API KEY inside the paid company dashboard");
        console.error("       (not the Developer App) with both company:basic:read and");
        console.error("       access_pass:basic:read scopes, then re-run without --company-id.");
      } else {
        console.error("  If 401/403, the key may be from the OAuth Developer App rather");
        console.error("  than a COMPANY API key. Re-create it in the paid company dashboard.");
      }
      process.exit(1);
    }
    const compList = companies.data.data;
    if (compList.length === 0) {
      console.error("  ✗ No companies returned. The key has no company context.");
      process.exit(1);
    }
    console.log(`  ✓ ${compList.length} company${compList.length === 1 ? "" : " (matches)"}:`);
    for (const c of compList) {
      const owner = c.owner_user?.username ? ` · owner @${c.owner_user.username}` : "";
      const mem = c.member_count !== undefined ? ` · ${c.member_count} members` : "";
      console.log(`     ${c.id}   "${c.title ?? "(no title)"}"   route=${c.route ?? "—"}${mem}${owner}`);
    }
    console.log("");
    preferredCompany =
      compList.find((c) => (c.route ?? "").toLowerCase() === "oddsphereai") ?? compList[0]!;
    console.log(`  → Using company:   ${preferredCompany.id}  (route=${preferredCompany.route ?? "—"})\n`);
  }

  // ── 2. List products for that company ────────────────────────────────
  console.log(`[2/3] GET /products?company_id=${preferredCompany.id} — listing products…`);
  const products = await whopGet<Listing<Product>>("/products", key, {
    company_id: preferredCompany.id,
    first: "100",
  });
  if (!products.ok) {
    console.error(`  ✗ HTTP ${products.status}: ${products.body.slice(0, 500)}`);
    process.exit(1);
  }
  const prodList = products.data.data;
  if (prodList.length === 0) {
    console.error("  ✗ No products returned. The API key may not have the access_pass:basic:read scope.");
    console.error("    Re-create the key in Whop dashboard → Developer → API Keys with access-pass read scope.");
    process.exit(1);
  }
  console.log(`  ✓ ${prodList.length} product${prodList.length === 1 ? "" : "s"} returned:`);
  console.log("");
  const headerCols = ["id", "title", "route (slug)", "visibility", "members"];
  console.log("     " + ["%-22s", "%-40s", "%-30s", "%-12s", "%-7s"]
    .map((f, i) => f.replace("%-", "").replace("s", ""))
    .reduce<string[]>((acc, w, i) => { acc.push(headerCols[i]!.padEnd(parseInt(w, 10))); return acc; }, [])
    .join(" "));
  console.log("     " + "─".repeat(22 + 40 + 30 + 12 + 7 + 4));

  let match: Product | null = null;
  for (const p of prodList) {
    const isMatch = (p.route ?? "").toLowerCase() === slug.toLowerCase();
    if (isMatch && match === null) match = p;
    const marker = isMatch ? "→" : " ";
    console.log(
      `   ${marker} ` +
        `${(p.id ?? "").padEnd(22)} ` +
        `${(p.title ?? "(no title)").slice(0, 40).padEnd(40)} ` +
        `${(p.route ?? "—").slice(0, 30).padEnd(30)} ` +
        `${(p.visibility ?? "?").padEnd(12)} ` +
        `${String(p.member_count ?? "—").padEnd(7)}`,
    );
  }
  console.log("");

  // ── 3. List experiences (informational only) ─────────────────────────
  if (verbose) {
    console.log(`[3/3] GET /experiences?company_id=${preferredCompany.id} — listing experiences…`);
    const exps = await whopGet<Listing<Experience>>("/experiences", key, {
      company_id: preferredCompany.id,
      first: "100",
    });
    if (exps.ok) {
      const list = exps.data.data;
      console.log(`  ✓ ${list.length} experience${list.length === 1 ? "" : "s"}:`);
      for (const e of list) {
        const productLabel = e.product?.route ?? e.product?.id ?? "—";
        console.log(`     ${e.id}   name="${e.name ?? "(unnamed)"}"   product=${productLabel}`);
      }
    } else {
      console.log(`  ⓘ /experiences returned HTTP ${exps.status} — skipping (informational only).`);
    }
    console.log("");
  } else {
    console.log("[3/3] /experiences — skipped (pass --verbose to list).\n");
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("━━━ Summary ━━━");
  console.log("");
  if (match !== null) {
    console.log(`  ✓ FOUND a product with route="${slug}":`);
    console.log("");
    console.log(`      id:         ${match.id}`);
    console.log(`      title:      ${match.title ?? "(no title)"}`);
    console.log(`      route:      ${match.route}`);
    console.log(`      visibility: ${match.visibility ?? "?"}`);
    console.log(`      member_count: ${match.member_count ?? "—"}`);
    console.log("");
    console.log("  Use this for the resource id check. In Vercel set:");
    console.log("");
    console.log(`      WHOP_RESOURCE_ID=${match.id}`);
    console.log("");
    console.log("  Why this id and not the company (biz_xxx) id:");
    console.log("    • biz_xxx grants access to ANYONE who holds ANY product in your");
    console.log("      Whop store. If you ever ship a free or different paid product,");
    console.log("      those members would unlock the Lab too.");
    console.log("    • prod_xxx ties access strictly to OddSphereAI Premium subscribers.");
    console.log("      That's what we want for the $25/$35 membership gate.");
    console.log("");
  } else {
    console.log(`  ✗ No product matched route="${slug}" in company ${preferredCompany.id}.`);
    console.log("");
    console.log("  Possible causes:");
    console.log("    a. The slug is different — check Whop dashboard → Products → Edit URL.");
    console.log("    b. The product is under a DIFFERENT Whop company than the one this");
    console.log("       API key authorizes. Re-issue the API key inside the company that");
    console.log("       owns oddsphereai-premium.");
    console.log("    c. The product is archived/hidden — re-run with --verbose and check");
    console.log("       the visibility column above.");
    console.log("");
    console.log("  Pick the product from the table above whose title matches");
    console.log("  'OddSphereAI Premium' and copy its id into WHOP_RESOURCE_ID.");
    console.log("");
  }

  console.log("  Full Vercel env checklist for activation (Phase 6B.3a):");
  console.log("    WHOP_OAUTH_ENABLED=true");
  console.log("    WHOP_CLIENT_ID=app_xxx                 (from your Whop Developer App)");
  console.log("    WHOP_CLIENT_SECRET=...                  (from the same Developer App)");
  console.log("    WHOP_REDIRECT_URI=https://oddsphereai.com/api/auth/whop/callback");
  console.log("    WHOP_API_KEY=...                        (the COMPANY API key, this script's key)");
  console.log(`    WHOP_RESOURCE_ID=${match?.id ?? "prod_xxx — see above"}`);
  console.log("    WHOP_SESSION_SECRET=...                 (openssl rand -hex 32)");
  console.log("    WHOP_CHECKOUT_URL=https://whop.com/oddsphereai/oddsphereai-premium/");
  console.log("");
  console.log("  Read-only — no Whop writes performed.");
}

main().catch((e) => {
  console.error(`\n  ✗ Unhandled error: ${(e as Error).message}\n`);
  process.exit(1);
});
