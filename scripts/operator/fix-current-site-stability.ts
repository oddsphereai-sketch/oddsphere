/**
 * scripts/operator/fix-current-site-stability.ts
 *
 * Automated Daily Edge integrity repair planner — DRY-RUN v1.
 *
 * Reads the current-site auditor output and produces a structured
 * repair plan describing what safe deterministic fixes would do.
 * This script never mutates the DB. There is no apply mode.
 *
 * USAGE
 *   # Run the auditor in-process, print plan to stdout:
 *   npx tsx --env-file=.env.local scripts/operator/fix-current-site-stability.ts
 *
 *   # Save JSON plan:
 *   npx tsx --env-file=.env.local scripts/operator/fix-current-site-stability.ts --json /tmp/plan.json
 *
 *   # Pipe JSON to stdout (suppress human-readable):
 *   npx tsx --env-file=.env.local scripts/operator/fix-current-site-stability.ts --json - --quiet
 *
 *   # Re-use a previously saved auditor JSON (no auditor subprocess):
 *   npx tsx --env-file=.env.local scripts/operator/fix-current-site-stability.ts --audit-json /tmp/audit.json
 *
 * EXIT CODES
 *   0 — no HIGH issues remain unrepaired (either site is clean OR every HIGH
 *       has a safe repair candidate planned)
 *   1 — at least one HIGH issue has no safe repair candidate (operator action required)
 *   2 — fixer itself crashed
 *
 * SAFETY GUARANTEES
 *   - This script does not open a writable Supabase client.
 *   - It does not import any service that mutates the DB.
 *   - It refuses to plan repairs that touch locked picks/confidence/lines/odds/
 *     play_grade/model_probability/edge/rationale.
 *   - It refuses to plan DELETE on prediction_records.
 *   - It refuses to add NBA spread or NHL puck-line rows to prediction_records.
 *   - "No safe repair candidate exists" is a valid, normal output.
 *
 * FUTURE APPLY-MODE GATING (NOT IMPLEMENTED, recommendation only)
 *   When apply mode lands, recommend gating it behind:
 *     1. Explicit --apply flag (no default-true).
 *     2. Operator env: FIXER_APPLY_ENABLED=true (defense-in-depth, mirroring
 *        the AUTOMODEL_DB_WRITES_ENABLED pattern).
 *     3. Per-issue allowlist via --apply-codes=FI_UNTRACKED_DISPLAY,...
 *     4. A second confirmation prompt printing the rows_that_would_change
 *        summary, requiring "yes" before each write.
 *     5. A pre-apply DB lock snapshot so a failed apply can be reverted.
 *     6. operator_approval_required:true refusals NEVER auto-applied.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planRepairs,
  type AuditorReport,
  type FixerReport,
  type RepairPlan,
} from "../../lib/services/repairPlanner";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const AUDITOR_PATH = "scripts/operator/audit-current-site-stability.ts";

function runAuditor(): AuditorReport {
  const tmp = `/tmp/fixer-audit-${Date.now()}.json`;
  execFileSync(
    "npx",
    ["tsx", "--env-file=.env.local", AUDITOR_PATH, "--json", tmp, "--quiet"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
    },
  );
  const raw = readFileSync(tmp, "utf8");
  return JSON.parse(raw) as AuditorReport;
}

function loadAuditorJson(path: string): AuditorReport {
  if (!existsSync(path)) {
    throw new Error(`Auditor JSON not found at ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as AuditorReport;
}

function formatPlan(report: FixerReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(`Fixer Dry-Run v1 — ${report.slate_date}`);
  lines.push(`Generated at:        ${report.generated_at}`);
  lines.push(`Auditor generated at: ${report.audit_generated_at}`);
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("APPLY MODE: not yet supported. This output is observation-only.");
  lines.push("");
  lines.push("AUDIT SNAPSHOT");
  for (const sport of ["mlb", "nba", "nhl"] as const) {
    const status = report.sport_status[sport];
    const marker = status === "TRUSTED" ? "✓" : status === "PARTIAL" ? "⚠" : "✗";
    lines.push(`  ${marker} ${sport.toUpperCase()}: ${status}`);
  }
  lines.push(
    `  Severities: HIGH=${report.audit_summary.high}  WARN=${report.audit_summary.warn}  INFO=${report.audit_summary.info}`,
  );
  lines.push("");
  lines.push("FIXER SUMMARY");
  lines.push(`  Repair candidates planned:          ${report.fixer_summary.repair_candidates}`);
  lines.push(`  Refused repairs (unsafe / needs op): ${report.fixer_summary.refused_repairs}`);
  lines.push(`  Unrepaired HIGH issues:             ${report.fixer_summary.unrepaired_high}`);
  lines.push("");

  if (report.notes.length > 0) {
    lines.push("NOTES");
    for (const n of report.notes) {
      lines.push(`  • ${n}`);
    }
    lines.push("");
  }

  const renderPlan = (label: string, list: RepairPlan[]) => {
    if (list.length === 0) return;
    lines.push(`─── ${label} (${list.length}) ───────────────────────────`);
    for (const c of list) {
      const where = c.sport ? `[${c.sport.toUpperCase()}]` : "[ALL]";
      lines.push(`  • ${c.issue_code} ${where} severity=${c.severity}`);
      if (c.affected.game_id !== undefined) {
        lines.push(`      game_id: ${c.affected.game_id}`);
      }
      if (c.affected.market !== undefined) {
        lines.push(`      market: ${c.affected.market}`);
      }
      lines.push(`      current_state:       ${c.current_state}`);
      lines.push(`      proposed_state:      ${c.proposed_state}`);
      lines.push(`      why_safe:            ${c.why_safe}`);
      lines.push(`      exact_repair:        ${c.exact_repair_function}`);
      lines.push(`      rows:                ${c.rows_that_would_change}`);
      lines.push(`      columns:             ${c.columns_that_would_change}`);
      lines.push(`      locked_impact:       ${c.locked_record_impact}`);
      lines.push(`      tracking_impact:     ${c.tracking_grading_impact}`);
      lines.push(`      source_evidence:     ${c.source_evidence}`);
      lines.push(
        `      auto_fixable=${c.auto_fixable}  operator_approval=${c.operator_approval_required}  apply_supported=${c.apply_supported}`,
      );
      if (c.refusal_reason !== null) {
        lines.push(`      refusal_reason: ${c.refusal_reason}`);
      }
      lines.push("");
    }
  };

  renderPlan("REPAIR CANDIDATES", report.repair_candidates);
  renderPlan("REFUSED REPAIRS", report.refused_repairs);

  lines.push("═══════════════════════════════════════════════════════════════════════");
  const exitCode = report.fixer_summary.unrepaired_high > 0 ? 1 : 0;
  const exitLabel =
    exitCode === 0
      ? "no unrepaired HIGH issues remain — apply candidates manually or via future apply mode"
      : "HIGH issues remain without a safe repair candidate — operator action required";
  lines.push(`Exit code: ${exitCode}  (${exitLabel})`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let jsonOut: string | null = null;
  let quiet = false;
  let auditJsonIn: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") {
      jsonOut = argv[++i] ?? null;
    } else if (argv[i] === "--quiet") {
      quiet = true;
    } else if (argv[i] === "--audit-json") {
      auditJsonIn = argv[++i] ?? null;
    } else if (argv[i] === "--apply") {
      console.error(
        "fix-current-site-stability: --apply is not supported in v1. " +
          "This script is dry-run only. Aborting.",
      );
      process.exit(2);
    }
  }

  let audit: AuditorReport;
  if (auditJsonIn !== null) {
    audit = loadAuditorJson(auditJsonIn);
  } else {
    audit = runAuditor();
  }

  const plan = planRepairs(audit);

  if (!quiet) {
    console.log(formatPlan(plan));
  }

  if (jsonOut !== null) {
    const json = JSON.stringify(plan, null, 2);
    if (jsonOut === "-") {
      console.log(json);
    } else {
      writeFileSync(jsonOut, json);
      if (!quiet) console.log(`JSON plan written to: ${jsonOut}`);
    }
  }

  process.exit(plan.fixer_summary.unrepaired_high > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(
    "Fixer crashed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(2);
});
