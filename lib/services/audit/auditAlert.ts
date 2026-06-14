/**
 * Active alerting for the slate-health auditor.
 *
 * Posts a compact summary to an incoming webhook (Slack OR Discord — the
 * payload carries both `text` and `content` so either accepts it) whenever a
 * run has ERRORS or applied FIXES. Clean runs stay silent. Configured by the
 * SLATE_HEALTH_ALERT_WEBHOOK env var; when unset, alerting is a no-op and the
 * findings still land in the cron logs.
 *
 * Never throws — alerting must never break the cron it reports on.
 */

import type { AuditResult } from "./slateHealthAuditor";

const WEBHOOK_ENV = "SLATE_HEALTH_ALERT_WEBHOOK";

export type AlertOutcome = { sent: boolean; reason: string };

export async function sendAuditAlert(res: AuditResult): Promise<AlertOutcome> {
  const url = process.env[WEBHOOK_ENV];
  if (!url) return { sent: false, reason: `${WEBHOOK_ENV} unset (logs only)` };

  const errors = res.findings.filter((f) => f.severity === "error");
  const fixed = res.findings.filter((f) => f.fixed && (f.check === "missing_games" || f.check === "odds_no_predictions"));
  // Only ping on something actionable: a real error or an actual mutating fix.
  if (errors.length === 0 && fixed.length === 0) {
    return { sent: false, reason: "nothing actionable (no errors, no mutating fixes)" };
  }

  const lines: string[] = [];
  lines.push(`🩺 *Slate-health audit* — ${res.as_of.slice(0, 16)}Z (apply=${res.apply})`);
  lines.push(`errors=${res.summary.errors} fixed=${res.summary.fixed} warns=${res.summary.warns}`);
  if (fixed.length) {
    lines.push("", "✅ Auto-fixed:");
    for (const f of fixed.slice(0, 10)) lines.push(`• ${f.sport} ${f.check} ${f.matchup ?? f.slate_date ?? ""} — ${f.detail}`);
  }
  if (errors.length) {
    lines.push("", "❌ Errors:");
    for (const f of errors.slice(0, 15)) lines.push(`• ${f.sport} ${f.check} ${f.matchup ?? f.slate_date ?? ""} — ${f.detail}${f.reason ? ` (${f.reason})` : ""}`);
    if (errors.length > 15) lines.push(`…and ${errors.length - 15} more`);
  }
  const message = lines.join("\n");

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
    });
    if (!resp.ok) return { sent: false, reason: `webhook HTTP ${resp.status}` };
    return { sent: true, reason: `alerted (${errors.length} errors, ${fixed.length} fixes)` };
  } catch (e) {
    return { sent: false, reason: `webhook error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
