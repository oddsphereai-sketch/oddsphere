/**
 * Whop access-check helper (Phase 6B.3a).
 *
 * Calls Whop's server access endpoint with the configured API key.
 * This is the single source of truth for "does this user have a paid,
 * active membership to my product/store right now?"
 *
 *   GET https://api.whop.com/api/v1/users/{userId}/access/{resourceId}
 *   Authorization: Bearer <WHOP_API_KEY>
 *
 *   200 → { has_access: boolean, access_level: "customer"|"admin"|"no_access" }
 *
 * Fail-closed posture:
 *   • Null config → "no access". Caller MUST treat as denied.
 *   • Network/HTTP error → "no access". We do NOT cache a positive
 *     result on transient failures.
 *   • Malformed body → "no access".
 *   • has_access === false OR access_level === "no_access" → denied.
 *
 * The "admin" access level is propagated to the caller but NEVER used
 * to grant admin-console access on its own. /admin/* uses its existing
 * validateAdminAuth path; Whop membership ≠ OddSphere admin role.
 */

import { readWhopConfig, WHOP_ENDPOINTS } from "./whopConfig";

export type WhopAccessResult =
  | { has_access: true; access_level: "customer" | "admin"; checked_at: number }
  | { has_access: false; reason: "denied" | "config_missing" | "api_error"; checked_at: number };

export async function checkWhopAccess(opts: { userId: string }): Promise<WhopAccessResult> {
  const cfg = readWhopConfig();
  const now = Math.floor(Date.now() / 1000);
  if (cfg === null) {
    return { has_access: false, reason: "config_missing", checked_at: now };
  }
  if (!opts.userId || opts.userId.length === 0) {
    return { has_access: false, reason: "denied", checked_at: now };
  }

  const url = WHOP_ENDPOINTS.accessTemplate
    .replace("{userId}", encodeURIComponent(opts.userId))
    .replace("{resourceId}", encodeURIComponent(cfg.resourceId));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
  } catch {
    return { has_access: false, reason: "api_error", checked_at: now };
  }
  if (!res.ok) {
    return { has_access: false, reason: "api_error", checked_at: now };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { has_access: false, reason: "api_error", checked_at: now };
  }
  if (typeof body !== "object" || body === null) {
    return { has_access: false, reason: "api_error", checked_at: now };
  }

  const obj = body as Record<string, unknown>;
  const hasAccess = obj["has_access"] === true;
  const levelRaw = obj["access_level"];
  const level =
    levelRaw === "admin" ? "admin"
    : levelRaw === "customer" ? "customer"
    : null;

  if (!hasAccess || level === null) {
    return { has_access: false, reason: "denied", checked_at: now };
  }
  return { has_access: true, access_level: level, checked_at: now };
}
