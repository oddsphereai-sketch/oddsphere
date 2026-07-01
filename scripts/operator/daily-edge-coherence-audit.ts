/**
 * Daily Edge Deep Audit Gate.
 *
 * Read-only release/refresh gate for member-facing Daily Edge cards.
 * Checks displayed odds sanity, source-chain integrity, Market Read direction,
 * stale current prices, strict Sharp Money display, consensus display, lock
 * freezes, and common copy contradictions.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/daily-edge-coherence-audit.ts
 *   npx tsx --env-file=.env.local scripts/operator/daily-edge-coherence-audit.ts --base-url https://www.oddsphereai.com
 */

import { readStringFlag } from "./_cliCommon";
import { signWhopSession, WHOP_SESSION_COOKIE_NAME } from "../../lib/auth/whopSession";
import { auditDailyEdgeBoards } from "../../lib/services/dailyEdgeDeepAudit";

type Row = Record<string, any>;

const SPORTS = ["mlb", "wnba", "soccer"] as const;
const argv = process.argv.slice(2);
const baseUrl = readStringFlag(argv, "--base-url")?.replace(/\/+$/, "") ?? null;
const failOnCritical = !argv.includes("--no-fail");

async function main(): Promise<void> {
  const boards = baseUrl
    ? await fetchProductionBoards(baseUrl)
    : await fetchLocalBoards();
  const result = auditDailyEdgeBoards(boards);
  console.log(JSON.stringify({
    ...result,
    baseUrl: baseUrl ?? "local-route",
  }, null, 2));
  if (failOnCritical && result.summary.criticalIssues > 0) {
    process.exit(2);
  }
}

async function fetchLocalBoards(): Promise<Record<string, Row>> {
  const { GET: dailyEdgeGet } = await import("../../app/api/lab/daily-edge/route");
  const out: Record<string, Row> = {};
  for (const sport of SPORTS) {
    const response = await dailyEdgeGet(new Request(`http://localhost/api/lab/daily-edge?sport=${sport}`));
    out[sport] = await response.json() as Row;
  }
  return out;
}

async function fetchProductionBoards(url: string): Promise<Record<string, Row>> {
  const token = process.env.DAILY_EDGE_AUDIT_TOKEN || process.env.CRON_SECRET || null;
  if (token) {
    const response = await fetch(`${url}/api/internal/daily-edge-deep-audit`, {
      headers: {
        "authorization": `Bearer ${token}`,
        "cache-control": "no-cache",
      },
    });
    if (response.ok) {
      const payload = await response.json() as { boards?: Record<string, Row>; result?: unknown };
      if (payload.boards) return payload.boards;
    }
  }

  const authCookie = await betaCookieForBaseUrl(url);
  const out: Record<string, Row> = {};
  for (const sport of SPORTS) {
    const response = await fetch(`${url}/api/lab/daily-edge?sport=${sport}`, {
      headers: {
        "cache-control": "no-cache",
        cookie: authCookie,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Production Daily Edge ${sport} failed: ${response.status} ${text.slice(0, 200)}`);
    }
    out[sport] = await response.json() as Row;
  }
  return out;
}

async function betaCookieForBaseUrl(url: string): Promise<string> {
  const password = process.env.LAB_BETA_PASSWORD;
  if (password && password !== "\"\"") {
    const res = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, next: "/lab/daily-edge" }),
    });
    const cookie = res.headers.get("set-cookie");
    if (cookie) return cookie.split(";")[0] ?? "";
  }
  const now = Math.floor(Date.now() / 1000);
  const whopCookie = await signWhopSession({
    v: 1,
    uid: "operator_daily_edge_audit",
    acl: "admin",
    iat: now,
    exp: now + 10 * 60,
  });
  if (!whopCookie) {
    throw new Error(
      "No audit token, beta session, or Whop session config is available for --base-url production audit.",
    );
  }
  return `${WHOP_SESSION_COOKIE_NAME}=${whopCookie}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
