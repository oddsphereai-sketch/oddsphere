/**
 * Slate-health audit cron — the universal cross-sport guardrail.
 *
 * Runs runSlateHealthAudit across MLB / NBA / NHL / soccer (WC) and reports
 * every coverage / card / line / lock / tracking integrity finding, with an
 * auto-fix-safe repair path. Built 2026-06-14 after the WC TUR@AUS miss so a
 * "game we should have covered isn't covered" never goes unnoticed again — and
 * it doubles as the live confirmation that the WC lookahead seeded/predicted
 * the next slate before kickoff.
 *
 * Auth: cronHandler validates the CRON_SECRET bearer token.
 * Gates:
 *   - SLATE_HEALTH_AUDIT_ENABLED=true  → run (else no-op).
 *   - apply is OFF by default (report only). Enable per-run with ?apply=true
 *     (auth-gated) or globally with SLATE_HEALTH_AUDIT_APPLY=true. Apply only
 *     runs the deterministic-safe repairs (reseed a slate missing games; rerun
 *     the soccer prediction writer for an upcoming game with odds + 0 preds).
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { runSlateHealthAudit, type Sport } from "@/lib/services/audit/slateHealthAuditor";
import { sendAuditAlert } from "@/lib/services/audit/auditAlert";

const CRON_ENV = "SLATE_HEALTH_AUDIT_ENABLED";
const APPLY_ENV = "SLATE_HEALTH_AUDIT_APPLY";

function currentEtSlateDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "slate_health_audit", async () => {
    if (process.env[CRON_ENV] !== "true") {
      return { records_updated: 0, details: { disabled: true, reason: `${CRON_ENV}!=true` } };
    }

    const url = new URL(request.url);
    const apply = url.searchParams.get("apply") === "true" || process.env[APPLY_ENV] === "true";
    const sportsParam = url.searchParams.get("sports");
    const sports = sportsParam
      ? (sportsParam.split(",").map((s) => s.trim()) as Sport[])
      : undefined;
    const today = currentEtSlateDate();

    const res = await runSlateHealthAudit({
      supabase,
      today,
      sports,
      apply,
      logger: (m) => console.log(`[slate-health-audit] ${m}`),
    });

    // Surface the actionable findings (errors + applied fixes) in the cron log.
    for (const f of res.findings) {
      if (f.severity === "error" || f.fixed) {
        console.log(`[slate-health-audit] ${f.severity.toUpperCase()}${f.fixed ? "/FIXED" : ""} ${f.sport} ${f.check} ${f.matchup ?? ""} — ${f.detail}`);
      }
    }

    // Active alert (webhook) on errors or applied fixes; no-op when unset.
    const alert = await sendAuditAlert(res);
    console.log(`[slate-health-audit] alert: ${alert.reason}`);

    return {
      records_updated: res.summary.fixed,
      partial: res.summary.errors > 0,
      details: {
        apply,
        today,
        alert: alert.reason,
        summary: res.summary,
        // Cap the inline findings payload; full detail is in the logs.
        findings: res.findings.slice(0, 100),
      },
    };
  });
}
