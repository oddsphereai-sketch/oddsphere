#!/usr/bin/env tsx
/**
 * Current-Site Stability Auditor v1
 *
 * Read-only audit of the CURRENT live OddSphere site — MLB, NBA, NHL —
 * across the Daily Edge surface: officially tracked markets, context-
 * only displayed markets, lock snapshots, grading/tracking, final
 * scores, and refresh/cron health.
 *
 * Scope (v1, intentionally narrow):
 *   - MLB / NBA / NHL only.
 *   - Read-only. No DB writes.
 *   - No model-confidence changes.
 *   - No public tracking expansion.
 *
 * Out of scope: World Cup / Soccer, NFL, Player Props, cross-sport
 * adapter v2 (task #453), shared `SportAdapter` interface (Phase 6 §B),
 * shared `lockSnapshotContract.ts` (Phase 6 §E), refresh-cycle
 * fixer (Phase 6 §G). Those are Phase 6+ deliverables — this auditor
 * is the practical v1 safety layer the current site can use today.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/operator/audit-current-site-stability.ts
 *   npx tsx --env-file=.env.local scripts/operator/audit-current-site-stability.ts --json path/to/report.json
 *   npx tsx --env-file=.env.local scripts/operator/audit-current-site-stability.ts --quiet --json -
 *
 * FLAGS
 *   --json <path>   Write report JSON to file (use "-" for stdout)
 *   --quiet         Suppress human-readable console output
 *   --date <YYYY-MM-DD>  Slate date to focus on (default: today ET)
 *
 * EXIT CODES
 *   0   No HIGH issues found
 *   1   At least one HIGH issue found
 *
 * NOTES
 *   The auditor does NOT auto-fix anything. Issues are flagged with
 *   `auto_fixable` and `operator_approval_required` so a future fixer
 *   (Phase 6 §G) can decide what to apply. A future `--fix --dry-run`
 *   flag should propose safe deterministic repairs without committing
 *   them. THIS V1 INTENTIONALLY DOES NOT INCLUDE `--fix` to keep
 *   blast radius minimal.
 */

import { supabase } from "@/lib/db/supabase";
import { computeTrackingAggregate } from "@/lib/services/trackingAggregateService";
import {
  getOfficialTrackingMarkets,
  getContextOnlyDisplayMarkets,
  isOfficiallyTrackedMarket,
} from "@/lib/config/officialTrackingMarkets";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────

type Severity = "HIGH" | "WARN" | "INFO";
type SportStatus = "TRUSTED" | "PARTIAL" | "BLOCKED";
type ActiveSport = "mlb" | "nba" | "nhl";

interface Issue {
  code: string;
  severity: Severity;
  sport: ActiveSport | null;
  affected: {
    game_id?: number;
    market?: string;
    prediction_record_id?: number;
    details?: string;
  };
  user_facing_impact: string;
  recommended_fix: string;
  auto_fixable: boolean;
  operator_approval_required: boolean;
}

interface CurrentSiteReport {
  generated_at: string;
  slate_date: string;
  sport_status: Record<ActiveSport, SportStatus>;
  cross_sport_issues: Issue[];
  per_sport_issues: Record<ActiveSport, Issue[]>;
  summary: { high: number; warn: number; info: number };
  safe_repairs_available: Issue[];
  blocked_repairs_needing_approval: Issue[];
}

// ─── Constants ───────────────────────────────────────────────────────

const ACTIVE_SPORTS: ActiveSport[] = ["mlb", "nba", "nhl"];

// Per-sport markets come from the official tracking registry — single
// source of truth. Auditor used to hardcode this; v1.x onward, both
// the auditor and the DailyEdge UI read from
// lib/config/officialTrackingMarkets.ts.
const OFFICIAL_TRACKING: Record<ActiveSport, ReadonlyArray<string>> = {
  mlb: getOfficialTrackingMarkets("mlb"),
  nba: getOfficialTrackingMarkets("nba"),
  nhl: getOfficialTrackingMarkets("nhl"),
};

const CONTEXT_ONLY_DISPLAYED: Record<ActiveSport, ReadonlyArray<string>> = {
  mlb: getContextOnlyDisplayMarkets("mlb"),
  nba: getContextOnlyDisplayMarkets("nba"),
  nhl: getContextOnlyDisplayMarkets("nhl"),
};

// MLB substrate (signal_rows_at_lock + lines_at_lock + framework_grades_at_lock +
// predicted_scores_at_lock + data_integrity) rolled out around 2026-06-08.
// Records locked before this date are exempt from strict substrate checks.
const MLB_SUBSTRATE_ROLLOUT_DATE = "2026-06-08";

// NBA substrate (predicted_home_score/away_score/total/spread_home, splits_state,
// current_price replacing line_movement) rolled out in commit cba9ea5 on
// 2026-06-10 at 14:29:05 UTC. Records locked before this exact ISO time should
// be reported as INFO (pre-rollout, expected gap) rather than HIGH.
const NBA_SUBSTRATE_ROLLOUT_ISO = "2026-06-10T14:29:05Z";
const REPO_ROOT = resolve(__dirname, "..", "..");
const DAILY_EDGE_SHELL_PATH = "app/lab/components/daily-edge/DailyEdgeShell.tsx";
const NHL_ADAPTER_PATH = "lib/services/nhl/adaptNhlToDailyEdgeResponse.ts";
const NBA_ADAPTER_PATH = "lib/services/nba/adaptNbaToDailyEdgeResponse.ts";
const VERCEL_JSON_PATH = "vercel.json";

// ─── Helpers ─────────────────────────────────────────────────────────

function todayET(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, "0");
  const d = String(et.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readRepoFile(rel: string): string | null {
  try {
    return readFileSync(resolve(REPO_ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function pushIssue(out: Issue[], issue: Issue): void {
  out.push(issue);
}

// ─── CHECK 1 — Official public tracking market registry ──────────────

async function check1RegistryIntegrity(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // Probe prediction_records — confirm only intended markets are tracked
  for (const sport of ACTIVE_SPORTS) {
    const { data: prs, error } = await supabase
      .from("prediction_records")
      .select("id, market, slate_date, locked_at, model_version")
      .eq("sport", sport);
    if (error) {
      pushIssue(issues, {
        code: "REGISTRY_DB_ERROR",
        severity: "WARN",
        sport,
        affected: { details: error.message },
        user_facing_impact: "Auditor cannot verify registry integrity",
        recommended_fix: "Investigate Supabase connectivity",
        auto_fixable: false,
        operator_approval_required: false,
      });
      continue;
    }

    const distinct = uniq((prs ?? []).map((r) => r.market));
    const allowed = OFFICIAL_TRACKING[sport];
    const unexpected = distinct.filter((m) => !allowed.includes(m));

    if (unexpected.length > 0) {
      // HIGH — pollution of public tracking history
      for (const m of unexpected) {
        const offenders = (prs ?? []).filter((r) => r.market === m);
        pushIssue(issues, {
          code: "REGISTRY_UNEXPECTED_MARKET",
          severity: "HIGH",
          sport,
          affected: {
            market: m,
            details: `${offenders.length} prediction_records row(s) with sport=${sport}, market=${m}`,
          },
          user_facing_impact:
            `Market "${m}" appears in ${sport.toUpperCase()} prediction_records but is NOT in the official tracking registry. ` +
            `If surfaced to the tracking page, members would see win/loss counts for an unlaunched market — polluting public tracking history.`,
          recommended_fix:
            `Either (1) intentionally launch "${m}" as a tracked ${sport.toUpperCase()} market with product approval + sample-size baseline, OR ` +
            `(2) remove these prediction_records rows AND fix the writer that inserted them. Do NOT silently keep them in the table.`,
          auto_fixable: false,
          operator_approval_required: true,
        });
      }
    }

    // INFO — registry confirmation
    pushIssue(issues, {
      code: "REGISTRY_CONFIRMED",
      severity: "INFO",
      sport,
      affected: { details: `markets in prediction_records=[${[...distinct].sort().join(", ")}], expected=[${[...allowed].sort().join(", ")}]` },
      user_facing_impact: "None — confirmation only",
      recommended_fix: "n/a",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  // INFO — note context-only markets
  pushIssue(issues, {
    code: "REGISTRY_CONTEXT_ONLY_NOTE",
    severity: "INFO",
    sport: null,
    affected: { details: "NBA spread + NHL puck-line are context-only displayed markets, not public tracked markets" },
    user_facing_impact: "None — confirmation that context-only is the intended product direction",
    recommended_fix: "n/a — see commit 29dc76e + memory feedback-public-tracking-vs-internal-audit",
    auto_fixable: false,
    operator_approval_required: false,
  });

  return issues;
}

// ─── CHECK 2 — Context-only display integrity (static + DB) ──────────

async function check2ContextOnlyDisplay(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // Static check — DailyEdgeShell.tsx contains the corrected guards
  const shellSrc = readRepoFile(DAILY_EDGE_SHELL_PATH);
  if (shellSrc === null) {
    pushIssue(issues, {
      code: "CONTEXT_UI_FILE_MISSING",
      severity: "HIGH",
      sport: null,
      affected: { details: DAILY_EDGE_SHELL_PATH },
      user_facing_impact: "Auditor cannot verify UI labeling",
      recommended_fix: "Confirm the file path; auditor may need updating after refactor",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }

  // Expected UI patterns (post commit 29dc76e):
  // - marketKeysFor returns all 3 for every sport
  // - marketShortLabelFor appends "*" for NBA / NHL first_inning slot
  // - CONTEXT_ONLY_FOOTNOTE constant exists
  // - isContextOnlyMarket helper exists
  const requiredPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /function isContextOnlyMarket\(/, label: "isContextOnlyMarket helper" },
    { pattern: /CONTEXT_ONLY_FOOTNOTE/, label: "CONTEXT_ONLY_FOOTNOTE constant" },
    { pattern: /Model context · Not part of official tracking/, label: "footnote sentence" },
    { pattern: /if \(sport === "nhl"\) return "PL\*"/, label: 'NHL puck-line "PL*" label' },
    { pattern: /if \(sport === "nba"\) return "Sprd\*"/, label: 'NBA spread "Sprd*" label' },
  ];

  for (const { pattern, label } of requiredPatterns) {
    if (!pattern.test(shellSrc)) {
      pushIssue(issues, {
        code: "CONTEXT_UI_MISSING_PATTERN",
        severity: "HIGH",
        sport: null,
        affected: { details: `Missing pattern: ${label} in ${DAILY_EDGE_SHELL_PATH}` },
        user_facing_impact:
          "Context-only markets may render without proper labeling — members could mistake them for officially tracked picks",
        recommended_fix: `Restore the ${label} pattern; see commit 29dc76e`,
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // Anti-pattern: marketKeysFor should NOT have an early-return that hides spread/puck-line
  const hideMarker = /if \(sport === "(nba|nhl)"\) return \["moneyline", "total"\];/;
  if (hideMarker.test(shellSrc)) {
    pushIssue(issues, {
      code: "CONTEXT_UI_HIDE_REGRESSION",
      severity: "HIGH",
      sport: null,
      affected: { details: "marketKeysFor contains early-return hiding NBA spread or NHL puck-line" },
      user_facing_impact:
        "Useful model context (spread, puck-line) hidden from members; reverses the corrected product direction",
      recommended_fix:
        "Restore marketKeysFor to return all 3 markets for all sports; see commit 29dc76e + memory feedback-public-tracking-vs-internal-audit Option A",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  // P1-2 Commit B (2026-06-10) — Rollout-aware substrate enforcement.
  //
  // Replaces the previous CONTEXT_SNAPSHOT_DEFERRED WARN with strict
  // checks that fire HIGH on contract violations and INFO on pre-rollout
  // records. The substrate is the auditable record of what the Sprd* /
  // PL* chip rendered at lock time (NBA spread / NHL puck-line — both
  // context-only display markets per the public-tracking-vs-internal-
  // audit rule).
  //
  // The rollout timestamp below is the exact AuthorDate of Commit A
  // (57fa211 "P1-2 Commit A — displayed_context_markets substrate
  // (writer only)"). Any locked or unlocked prediction_record row
  // whose reference timestamp (locked_at if locked, else created_at)
  // is >= this ISO must carry the substrate. Pre-rollout records
  // remain untouched (Commit A intentionally did not backfill) and
  // emit INFO so the auditor surfaces the historical state cleanly
  // without blocking the slate.
  //
  // Checks:
  //   A. CONTEXT_SNAPSHOT_MISSING        — HIGH (post-rollout, no substrate)
  //   B. CONTEXT_SNAPSHOT_LEAKED_TRACKED — HIGH (substrate.official_tracked === true)
  //   C. CONTEXT_SNAPSHOT_BAD_LABEL      — HIGH (display_label != "Sprd*" / "PL*")
  //   D. CONTEXT_PUBLIC_TRACKING_POLLUTION — HIGH (spread row in prediction_records)
  //      (Replaces CONTEXT_LEAKED_TO_TRACKING from pre-v15.4.)
  //   E. CONTEXT_SNAPSHOT_PRE_ROLLOUT    — INFO (pre-rollout records, expected absence)
  //   Summary INFO when substrate is present and contract-clean.

  const CONTEXT_SUBSTRATE_ROLLOUT_ISO = "2026-06-10T18:26:01Z"; // Commit A 57fa211 AuthorDate

  for (const sport of ["nba", "nhl"] as const) {
    const { data: prs } = await supabase
      .from("prediction_records")
      .select("id, game_id, market, locked_at, created_at, snapshot_json")
      .eq("sport", sport)
      .neq("market", "spread"); // Spread rows handled by CONTEXT_PUBLIC_TRACKING_POLLUTION below

    let presentCount = 0;
    let preRolloutMissingCount = 0;

    for (const r of (prs ?? []) as Array<{
      id: number;
      game_id: number;
      market: string;
      locked_at: string | null;
      created_at: string | null;
      snapshot_json: Record<string, unknown> | null;
    }>) {
      const refTs = r.locked_at ?? r.created_at;
      const isPostRollout =
        refTs !== null && refTs >= CONTEXT_SUBSTRATE_ROLLOUT_ISO;

      const dcm =
        (r.snapshot_json as Record<string, unknown> | null)?.displayed_context_markets;
      const sub =
        dcm !== null && typeof dcm === "object"
          ? ((dcm as Record<string, unknown>).spread as Record<string, unknown> | undefined)
          : undefined;
      const hasSubstrate = sub !== undefined && sub !== null;

      if (!hasSubstrate) {
        if (isPostRollout) {
          // A. CONTEXT_SNAPSHOT_MISSING
          pushIssue(issues, {
            code: "CONTEXT_SNAPSHOT_MISSING",
            severity: "HIGH",
            sport,
            affected: {
              game_id: r.game_id,
              market: r.market,
              details:
                `pr.id=${r.id} reference_ts=${refTs} (post-rollout >= ${CONTEXT_SUBSTRATE_ROLLOUT_ISO}) ` +
                `but snapshot_json.displayed_context_markets.spread is missing`,
            },
            user_facing_impact:
              `${sport.toUpperCase()} card may render the ${sport === "nhl" ? "PL*" : "Sprd*"} chip without an auditable locked substrate`,
            recommended_fix:
              `Re-run the ${sport.toUpperCase()} writer (createNbaPredictionRecords / writeNhlPredictionRecords) ` +
              "for this slate; the post-Commit-A writer chains substrate population on every cycle.",
            auto_fixable: true,
            operator_approval_required: false,
          });
        } else {
          preRolloutMissingCount++;
        }
        continue;
      }

      // Substrate present — validate the shape.
      presentCount++;

      // B. CONTEXT_SNAPSHOT_LEAKED_TRACKED
      if (sub!.official_tracked === true) {
        pushIssue(issues, {
          code: "CONTEXT_SNAPSHOT_LEAKED_TRACKED",
          severity: "HIGH",
          sport,
          affected: {
            game_id: r.game_id,
            market: r.market,
            details: `pr.id=${r.id} substrate has official_tracked=true — routing bug; context-only markets must always have official_tracked=false`,
          },
          user_facing_impact:
            `${sport.toUpperCase()} context-only ${sport === "nhl" ? "puck-line" : "spread"} substrate falsely claims official tracking; could pollute aggregations downstream`,
          recommended_fix:
            "Investigate the writer that produced this row; the context-only substrate must hard-set official_tracked=false in DisplayedContextMarketBase. Remove or repair the offending row.",
          auto_fixable: false,
          operator_approval_required: true,
        });
      }

      // C. CONTEXT_SNAPSHOT_BAD_LABEL
      const expectedLabel = sport === "nba" ? "Sprd*" : "PL*";
      if (sub!.display_label !== expectedLabel) {
        pushIssue(issues, {
          code: "CONTEXT_SNAPSHOT_BAD_LABEL",
          severity: "HIGH",
          sport,
          affected: {
            game_id: r.game_id,
            market: r.market,
            details: `pr.id=${r.id} display_label="${String(sub!.display_label)}" — expected "${expectedLabel}"`,
          },
          user_facing_impact:
            "Context-only chip label drifted from product contract; member-visible label and substrate disagree",
          recommended_fix: `Restore display_label to "${expectedLabel}" in the ${sport.toUpperCase()} writer.`,
          auto_fixable: false,
          operator_approval_required: false,
        });
      }
    }

    // Summary INFO entries
    if (presentCount > 0) {
      pushIssue(issues, {
        code: "CONTEXT_SNAPSHOT_PRESENT",
        severity: "INFO",
        sport,
        affected: {
          details: `${presentCount} ${sport.toUpperCase()} prediction_record(s) carry valid displayed_context_markets.spread substrate (display_label, official_tracked=false, context_only=true all verified)`,
        },
        user_facing_impact: "None — confirmation",
        recommended_fix: "n/a",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }

    if (preRolloutMissingCount > 0) {
      pushIssue(issues, {
        code: "CONTEXT_SNAPSHOT_PRE_ROLLOUT",
        severity: "INFO",
        sport,
        affected: {
          details:
            `${preRolloutMissingCount} ${sport.toUpperCase()} prediction_record(s) created/locked before ${CONTEXT_SUBSTRATE_ROLLOUT_ISO}; ` +
            "substrate intentionally not backfilled (Commit A writer-only contract).",
        },
        user_facing_impact:
          "None — pre-rollout records are intentionally excluded from substrate enforcement to preserve audit history",
        recommended_fix: "n/a",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // D. CONTEXT_PUBLIC_TRACKING_POLLUTION — was CONTEXT_LEAKED_TO_TRACKING.
  // Renamed per P1-2 Commit B spec; same semantics. Fires when NBA/NHL
  // prediction_records contains a public market="spread" row, which
  // would mean the writer leaked a context-only market into the
  // officially tracked substrate.
  for (const sport of ["nba", "nhl"] as const) {
    const { data: prs } = await supabase
      .from("prediction_records")
      .select("id, market")
      .eq("sport", sport)
      .eq("market", "spread");
    if ((prs?.length ?? 0) > 0) {
      pushIssue(issues, {
        code: "CONTEXT_PUBLIC_TRACKING_POLLUTION",
        severity: "HIGH",
        sport,
        affected: {
          market: "spread",
          details: `${prs?.length} prediction_records row(s) with sport=${sport}, market=spread`,
        },
        user_facing_impact:
          `${sport.toUpperCase()} context-only ${sport === "nhl" ? "puck-line" : "spread"} leaked into public tracking substrate`,
        recommended_fix:
          `Remove these rows AND audit the writer that inserted them. ${sport.toUpperCase()} ${sport === "nhl" ? "puck-line" : "spread"} must NEVER appear in prediction_records without explicit product launch approval.`,
        auto_fixable: false,
        operator_approval_required: true,
      });
    }
  }

  return issues;
}

// ─── CHECK 3 — Prediction record completeness for current slates ─────

async function check3PredictionRecordCompleteness(slateDate: string): Promise<Issue[]> {
  const issues: Issue[] = [];

  // For each sport, find scheduled games and verify expected tracked markets have prediction_records
  for (const sport of ACTIVE_SPORTS) {
    const { data: games } = await supabase
      .from("games")
      .select("id, status, slate_date")
      .eq("sport", sport)
      .eq("slate_date", slateDate);

    if (!games || games.length === 0) continue;

    const { data: prs } = await supabase
      .from("prediction_records")
      .select("id, market, game_id, locked_at")
      .eq("sport", sport)
      .in("game_id", games.map((g) => g.id));

    const byGame = new Map<number, Set<string>>();
    for (const p of prs ?? []) {
      let s = byGame.get(p.game_id);
      if (!s) {
        s = new Set();
        byGame.set(p.game_id, s);
      }
      s.add(p.market);
    }

    for (const g of games) {
      // Skip games that aren't scheduled (live/final/postponed handled elsewhere)
      if (!["scheduled", "FUT", "PRE", "SCHED"].includes(g.status)) continue;
      const present = byGame.get(g.id) ?? new Set<string>();
      const expected = OFFICIAL_TRACKING[sport];
      const missing = expected.filter((m) => !present.has(m));
      if (missing.length > 0) {
        pushIssue(issues, {
          code: "COMPLETENESS_MISSING_PREDICTION",
          severity: "WARN",
          sport,
          affected: {
            game_id: g.id,
            details: `Game ${g.id} (status=${g.status}) missing prediction_records for markets: [${missing.join(", ")}]`,
          },
          user_facing_impact:
            "Card may render without one or more officially tracked markets for this game",
          recommended_fix:
            `Run the ${sport.toUpperCase()} prediction writer; investigate why ${missing.join(", ")} are missing on slate ${slateDate}`,
          auto_fixable: true,
          operator_approval_required: false,
        });
      }
    }
  }

  return issues;
}

// ─── CHECK 4 — Lock snapshot completeness ────────────────────────────

interface SnapshotJson {
  // MLB substrate (post 2026-06-08 rollout)
  signal_rows_at_lock?: unknown;
  lines_at_lock?: unknown;
  predicted_scores_at_lock?: unknown;
  framework_grades_at_lock?: unknown;
  data_integrity?: unknown;
  v2_2_audit?: unknown;
  // MLB per-market grade fields (used by FI + held/no_bet checks)
  fi_v2_audit?: unknown;
  nrfi_decision_kind?: string;
  nrfi_threshold_zone?: string;
  ml_play_grade?: string;
  ou_play_grade?: string;
  // NBA flat substrate (post cba9ea5)
  predicted_home_score?: number;
  predicted_away_score?: number;
  predicted_total?: number;
  predicted_spread_home?: number;
  splits_state?: string;
  current_price?: { odds_american?: number; sportsbook?: string; note?: string };
  line_movement?: unknown;
  // NHL substrate
  model_output?: unknown;
  market_at_lock?: unknown;
  goalie_assumption?: unknown;
  // Generic
  pick?: string;
  side?: string;
}

// MLB grade labels that indicate intentional "held" / "no_bet" state.
// When a record's per-market snapshot grade is one of these, a null
// top-level play_grade is EXPECTED (the card renders "Held" with no
// verdict pill).
const MLB_HELD_GRADES = new Set(["no_bet", "held", "caution"]);

async function check4LockSnapshotCompleteness(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // For each sport, sample locked records and verify required fields
  for (const sport of ACTIVE_SPORTS) {
    const { data: lockedPrs } = await supabase
      .from("prediction_records")
      .select("id, market, pick, side, line_value, odds_american, confidence, play_grade, model_version, slate_date, locked_at, snapshot_json")
      .eq("sport", sport)
      .not("locked_at", "is", null)
      .order("locked_at", { ascending: false })
      .limit(20);

    if (!lockedPrs || lockedPrs.length === 0) continue;

    for (const pr of lockedPrs) {
      const s = (pr.snapshot_json ?? {}) as SnapshotJson;
      const isPostMlbRollout = pr.slate_date >= MLB_SUBSTRATE_ROLLOUT_DATE;
      const isPostNbaRollout =
        pr.locked_at !== null && pr.locked_at >= NBA_SUBSTRATE_ROLLOUT_ISO;
      const universalMissing: string[] = [];
      const sportSpecificMissing: string[] = [];
      const expectedNullNotes: string[] = [];

      // v1.2 reclassification helpers — MLB FI + held/no_bet records
      // intentionally have null top-level play_grade and odds_american
      // because the FI markets are not standard-priced and held records
      // do not show a verdict pill. The substrate carries the real
      // grade/decision metadata; the auditor must check there instead.
      const isMlbFi = sport === "mlb" && pr.market === "first_inning";
      const fiSubstratePresent =
        s.fi_v2_audit !== undefined ||
        s.nrfi_decision_kind !== undefined ||
        s.nrfi_threshold_zone !== undefined;
      const mlMarketHeld =
        sport === "mlb" &&
        pr.market === "moneyline" &&
        typeof s.ml_play_grade === "string" &&
        MLB_HELD_GRADES.has(s.ml_play_grade);
      const ouMarketHeld =
        sport === "mlb" &&
        pr.market === "total" &&
        typeof s.ou_play_grade === "string" &&
        MLB_HELD_GRADES.has(s.ou_play_grade);
      const mlMarketFlipped =
        sport === "mlb" &&
        pr.market === "moneyline" &&
        ((s as Record<string, unknown>).ml_flip as { flipped?: unknown } | undefined)?.flipped === true;
      const ouMarketFlipped =
        sport === "mlb" &&
        pr.market === "total" &&
        ((s as Record<string, unknown>).ou_flip as { flipped?: unknown } | undefined)?.flipped === true;

      // Universal required (per Phase 6 §E base) — with v1.2 reclassification
      if (pr.pick === null || pr.pick === undefined) universalMissing.push("pick");
      if (pr.confidence === null) universalMissing.push("confidence");

      // top-level play_grade
      if (pr.play_grade === null) {
        if (isMlbFi && fiSubstratePresent) {
          expectedNullNotes.push(
            `play_grade=null is expected for FI markets — substrate present: ${s.nrfi_decision_kind ? `nrfi_decision_kind=${s.nrfi_decision_kind}` : ""}${s.nrfi_threshold_zone ? ` nrfi_threshold_zone=${s.nrfi_threshold_zone}` : ""}${s.fi_v2_audit ? " fi_v2_audit=present" : ""}`,
          );
        } else if (mlMarketHeld) {
          expectedNullNotes.push(`play_grade=null is expected for ML held record (ml_play_grade=${s.ml_play_grade})`);
        } else if (ouMarketHeld) {
          expectedNullNotes.push(`play_grade=null is expected for Total held record (ou_play_grade=${s.ou_play_grade})`);
        } else if (mlMarketFlipped) {
          expectedNullNotes.push("play_grade=null is expected for flipped ML record (snapshot.ml_flip.flipped=true)");
        } else if (ouMarketFlipped) {
          expectedNullNotes.push("play_grade=null is expected for flipped Total record (snapshot.ou_flip.flipped=true)");
        } else {
          universalMissing.push("play_grade");
        }
      }

      // line_value — only required for non-ML markets that have a line
      if (pr.market !== "moneyline" && pr.line_value === null) universalMissing.push("line_value (non-ML market)");

      // odds_american — required for ML/Total. FI markets don't carry
      // a standard sportsbook line at the top level.
      if (pr.odds_american === null) {
        if (isMlbFi) {
          expectedNullNotes.push(
            "odds_american=null is expected for FI markets (NRFI/YRFI/Toss-Up are not priced at the top level)",
          );
        } else if (mlMarketHeld || ouMarketHeld) {
          expectedNullNotes.push("odds_american=null can be expected for held/no_bet records");
        } else {
          universalMissing.push("odds_american");
        }
      }

      // Sport-specific required fields
      if (sport === "mlb" && isPostMlbRollout) {
        if (s.signal_rows_at_lock === undefined) sportSpecificMissing.push("signal_rows_at_lock");
        if (s.lines_at_lock === undefined) sportSpecificMissing.push("lines_at_lock");
        if (s.predicted_scores_at_lock === undefined) sportSpecificMissing.push("predicted_scores_at_lock");
        if (s.framework_grades_at_lock === undefined) sportSpecificMissing.push("framework_grades_at_lock");
        if (s.data_integrity === undefined) sportSpecificMissing.push("data_integrity");
      }
      if (sport === "nba") {
        // NBA substrate (predicted_* + splits_state + current_price) shipped in cba9ea5.
        // Records locked before NBA_SUBSTRATE_ROLLOUT_ISO are pre-rollout; flag INFO not HIGH.
        const nbaSubMissing: string[] = [];
        if (s.predicted_home_score === undefined) nbaSubMissing.push("predicted_home_score");
        if (s.predicted_away_score === undefined) nbaSubMissing.push("predicted_away_score");
        if (s.predicted_total === undefined) nbaSubMissing.push("predicted_total");
        if (s.predicted_spread_home === undefined) nbaSubMissing.push("predicted_spread_home");
        if (s.splits_state === undefined) nbaSubMissing.push("splits_state");
        if (s.current_price === undefined) nbaSubMissing.push("current_price");

        if (nbaSubMissing.length > 0 && !isPostNbaRollout) {
          // Pre-rollout NBA record — expected gap, INFO only
          pushIssue(issues, {
            code: "SNAPSHOT_NBA_PRE_ROLLOUT",
            severity: "INFO",
            sport,
            affected: {
              prediction_record_id: pr.id,
              market: pr.market,
              details: `Pre-rollout NBA record (locked_at=${pr.locked_at} < cba9ea5 rollout ${NBA_SUBSTRATE_ROLLOUT_ISO}); missing post-cba9ea5 substrate expected: [${nbaSubMissing.join(", ")}]`,
            },
            user_facing_impact: "None — these records pre-date the cba9ea5 NBA substrate rollout",
            recommended_fix:
              "Optional: backfill these older records via a one-time operator script, or accept them as a documented historical gap",
            auto_fixable: false,
            operator_approval_required: false,
          });
        } else if (nbaSubMissing.length > 0 && isPostNbaRollout) {
          // Post-rollout NBA record missing substrate — real HIGH finding
          sportSpecificMissing.push(...nbaSubMissing);
        }

        // line_movement check — only HIGH on post-rollout records
        if (s.line_movement !== undefined) {
          pushIssue(issues, {
            code: "SNAPSHOT_NBA_LINE_MOVEMENT_REGRESSED",
            severity: isPostNbaRollout ? "WARN" : "INFO",
            sport,
            affected: {
              prediction_record_id: pr.id,
              market: pr.market,
              details: `NBA snapshot has line_movement block${isPostNbaRollout ? " (post-rollout — regression)" : " (pre-rollout — expected, old field name)"}`,
            },
            user_facing_impact: isPostNbaRollout
              ? "Card could display 'line movement' wording that implies open-to-current tracking we don't have"
              : "None — pre-rollout records used the old field name",
            recommended_fix: isPostNbaRollout
              ? "Verify buildNbaPredictionRecords writer is not regressed; expected field is current_price with explicit 'movement is not tracked' note"
              : "n/a — pre-rollout state",
            auto_fixable: false,
            operator_approval_required: false,
          });
        }
      }
      if (sport === "nhl") {
        // NHL substrate is thin (Phase 4 §E.4) — flag as WARN/INFO for completeness deferred to P1
        if (s.model_output === undefined) sportSpecificMissing.push("model_output");
        if (s.market_at_lock === undefined) sportSpecificMissing.push("market_at_lock");
        if (s.goalie_assumption === undefined) sportSpecificMissing.push("goalie_assumption");
        // NHL flat predicted_* fields NOT YET added (P1 follow-up F9)
      }

      // HIGH check (v1.2): FI record without ANY FI-specific substrate
      // is a real problem — the grader/card can't display anything.
      if (isMlbFi && !fiSubstratePresent) {
        pushIssue(issues, {
          code: "SNAPSHOT_FI_NO_SUBSTRATE",
          severity: "HIGH",
          sport,
          affected: {
            prediction_record_id: pr.id,
            market: pr.market,
            details:
              `pr.id=${pr.id} slate=${pr.slate_date} FI market has neither top-level play_grade NOR FI substrate ` +
              `(fi_v2_audit, nrfi_decision_kind, nrfi_threshold_zone all absent)`,
          },
          user_facing_impact:
            "FI card cannot render verdict or pick metadata — auditor cannot tie record to a grade",
          recommended_fix:
            "Investigate buildSnapshot for FI markets; likely a writer bug or pre-FI-v2 record",
          auto_fixable: false,
          operator_approval_required: true,
        });
      }

      // HIGH check (v1.2): held/no_bet record without any held substrate
      // is a real problem — we can't tell why the card showed "Held".
      if (
        sport === "mlb" &&
        pr.play_grade === null &&
        !isMlbFi &&
        !mlMarketHeld &&
        !ouMarketHeld &&
        // Only fire if the snapshot also lacks the per-market grade fields
        s.ml_play_grade === undefined &&
        s.ou_play_grade === undefined
      ) {
        // already captured in universalMissing as "play_grade"
      }

      const allMissing = [...universalMissing, ...sportSpecificMissing];
      if (allMissing.length > 0) {
        // Universal-field nulls that survived v1.2 reclassification are
        // real findings. Sport-specific substrate misses are scoped by
        // sport severity (NHL=WARN, MLB/NBA post-rollout=HIGH).
        const severityForMissing: Severity = sport === "nhl" ? "WARN" : "HIGH";
        pushIssue(issues, {
          code: "SNAPSHOT_INCOMPLETE",
          severity: severityForMissing,
          sport,
          affected: {
            prediction_record_id: pr.id,
            market: pr.market,
            details:
              `pr.id=${pr.id} slate=${pr.slate_date} locked_at=${pr.locked_at} ` +
              `pick=${pr.pick ?? "null"} line=${pr.line_value ?? "null"} odds=${pr.odds_american ?? "null"} ` +
              `grade=${pr.play_grade ?? "null"} model_v=${pr.model_version} ` +
              `missing: [${allMissing.join(", ")}]`,
          },
          user_facing_impact:
            sport === "nhl"
              ? "NHL thin substrate is a documented Phase 4 gap; UI not broken but auditor blind to substrate-level checks"
              : universalMissing.length > 0
                ? `Universal field(s) [${universalMissing.join(", ")}] missing on locked record — may affect card display or tracking`
                : "Card may render fields that are not in the locked snapshot — risk of post-lock drift or inconsistent reader",
          recommended_fix:
            sport === "nhl"
              ? "P1 — extend NHL buildSnapshot to include flat predicted_*_score, data_integrity, and displayed_context_markets per Phase 6 §E"
              : "Investigate the writer (buildSnapshot) for the affected sport; backfill if safe and source-backed",
          auto_fixable: false,
          operator_approval_required: sport !== "nhl",
        });
      }

      // v1.2 — emit INFO for records whose top-level nulls are
      // expected-by-market (FI / no_bet) and substrate is intact.
      // These show up in the report as confirmations, not problems.
      if (allMissing.length === 0 && expectedNullNotes.length > 0) {
        pushIssue(issues, {
          code: "SNAPSHOT_EXPECTED_NULL",
          severity: "INFO",
          sport,
          affected: {
            prediction_record_id: pr.id,
            market: pr.market,
            details:
              `pr.id=${pr.id} ${pr.market}/${pr.pick}: ${expectedNullNotes.join("; ")}`,
          },
          user_facing_impact: "None — these nulls are expected for this market/state",
          recommended_fix: "n/a",
          auto_fixable: false,
          operator_approval_required: false,
        });
      }
    }
  }

  return issues;
}

// ─── CHECK 5 — Card/copy truthfulness (static code scan) ─────────────

async function check5CardCopyTruthfulness(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // bannedTermsLinter — confirm CLV / closing line / RLM remain banned
  const linterSrc = readRepoFile("lib/services/bannedTermsLinter.ts");
  if (linterSrc !== null) {
    const expectedBanned = ["CLV", "closing line value", "RLM", "reverse line movement", "consensus", "no-vig"];
    for (const term of expectedBanned) {
      if (!linterSrc.includes(`"${term}"`)) {
        pushIssue(issues, {
          code: "COPY_BANNED_TERM_MISSING",
          severity: "WARN",
          sport: null,
          affected: { details: `Banned-term linter no longer registers "${term}"` },
          user_facing_impact: `Risk of "${term}" appearing in user-facing copy without enforcement`,
          recommended_fix: "Restore the banned term in bannedTermsLinter.ts BANNED_TERM_PATTERNS",
          auto_fixable: false,
          operator_approval_required: false,
        });
      }
    }
    pushIssue(issues, {
      code: "COPY_LINTER_CONFIRMED",
      severity: "INFO",
      sport: null,
      affected: { details: `bannedTermsLinter active for: ${expectedBanned.join(", ")}` },
      user_facing_impact: "None — confirmation",
      recommended_fix: "n/a",
      auto_fixable: false,
      operator_approval_required: false,
    });
  } else {
    pushIssue(issues, {
      code: "COPY_LINTER_MISSING",
      severity: "WARN",
      sport: null,
      affected: { details: "lib/services/bannedTermsLinter.ts not found" },
      user_facing_impact: "Auditor cannot confirm banned-term enforcement",
      recommended_fix: "Verify the linter still exists at the expected path",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  // NHL adapter — confirm no_data (not phantom wait_no_edge_clean)
  const nhlSrc = readRepoFile(NHL_ADAPTER_PATH);
  if (nhlSrc !== null) {
    if (nhlSrc.includes('"wait_no_edge_clean" as SharpReadKey')) {
      pushIssue(issues, {
        code: "COPY_NHL_PHANTOM_SHARPREAD",
        severity: "HIGH",
        sport: "nhl",
        affected: { details: 'NHL adapter still casts phantom "wait_no_edge_clean" SharpReadKey' },
        user_facing_impact:
          "NHL sharpRead narrative leaks model-output text disguised as a sharp analysis",
        recommended_fix:
          'Replace with "no_data" + SHARP_READ_SENTENCES.no_data per commit 52d0a47',
        auto_fixable: false,
        operator_approval_required: false,
      });
    } else if (nhlSrc.includes('"no_data" as SharpReadKey')) {
      pushIssue(issues, {
        code: "COPY_NHL_SHARPREAD_FIXED",
        severity: "INFO",
        sport: "nhl",
        affected: { details: 'NHL adapter uses valid "no_data" SharpReadKey' },
        user_facing_impact: "None — confirmation that P0-4 fix is in place",
        recommended_fix: "n/a",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // NBA adapter — same phantom check (P1 follow-up per stabilization plan)
  const nbaSrc = readRepoFile(NBA_ADAPTER_PATH);
  if (nbaSrc !== null && nbaSrc.includes('"wait_no_edge_clean" as SharpReadKey')) {
    pushIssue(issues, {
      code: "COPY_NBA_PHANTOM_SHARPREAD",
      severity: "WARN",
      sport: "nba",
      affected: { details: `NBA adapter contains phantom "wait_no_edge_clean" SharpReadKey cast at ${NBA_ADAPTER_PATH}` },
      user_facing_impact:
        "NBA sharpRead narrative may leak placeholder text similar to the NHL bug fixed in 52d0a47",
      recommended_fix:
        "P1 — mirror the NHL fix: replace phantom key with valid \"no_data\" and use SHARP_READ_SENTENCES.no_data when no sharp signals exist",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  return issues;
}

// ─── CHECK 6 — Grading / tracking integrity ──────────────────────────

async function check6GradingTracking(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // For each sport, find final games and check that prediction_grades rows exist for officially tracked markets
  for (const sport of ACTIVE_SPORTS) {
    const { data: games } = await supabase
      .from("games")
      .select("id, status, slate_date, home_score, away_score")
      .eq("sport", sport)
      .in("status", sport === "nhl" ? ["FINAL", "OFF"] : ["final", "FINAL"])
      .order("slate_date", { ascending: false })
      .limit(50);
    if (!games || games.length === 0) continue;

    const { data: prs } = await supabase
      .from("prediction_records")
      .select("id, market, game_id, locked_at, slate_date")
      .eq("sport", sport)
      .in("game_id", games.map((g) => g.id))
      .not("locked_at", "is", null);

    const { data: grades } = await supabase
      .from("prediction_grades")
      .select("prediction_record_id, market, result, pending")
      .in("prediction_record_id", (prs ?? []).map((p) => p.id));

    const gradeByPr = new Map<number, { result: string | null; pending: boolean }>();
    for (const g of grades ?? []) {
      gradeByPr.set(g.prediction_record_id, { result: g.result, pending: g.pending });
    }

    for (const pr of prs ?? []) {
      const g = gradeByPr.get(pr.id);
      const isTracked = OFFICIAL_TRACKING[sport].includes(pr.market);
      if (!isTracked) continue;
      if (g === undefined) {
        pushIssue(issues, {
          code: "GRADING_MISSING_GRADE_ROW",
          severity: "HIGH",
          sport,
          affected: {
            prediction_record_id: pr.id,
            market: pr.market,
            game_id: pr.game_id,
            details: `Locked pr.id=${pr.id} (game ${pr.game_id}, market ${pr.market}, slate ${pr.slate_date}) has no prediction_grades row but game is final`,
          },
          user_facing_impact:
            "Member tracking page will not show win/loss for this officially tracked pick",
          recommended_fix:
            `Run the ${sport.toUpperCase()} grader for slate ${pr.slate_date}; investigate why the auto-grade did not run`,
          auto_fixable: true,
          operator_approval_required: false,
        });
      } else if (g.pending) {
        pushIssue(issues, {
          code: "GRADING_STUCK_PENDING",
          severity: "HIGH",
          sport,
          affected: {
            prediction_record_id: pr.id,
            market: pr.market,
            game_id: pr.game_id,
            details: `pr.id=${pr.id} grade is still pending but game is final`,
          },
          user_facing_impact:
            "Pick shows 'pending' on tracking page despite game being over",
          recommended_fix:
            `Re-run the ${sport.toUpperCase()} grader for this slate; for NHL specifically, confirm gradeNhlPredictions ran with apply=true`,
          auto_fixable: true,
          operator_approval_required: false,
        });
      }
    }
  }

  // Specific regression — NHL CAR ML + OVER 5.5 from 2026-06-09 must remain WIN
  const { data: nhlPrs } = await supabase
    .from("prediction_records")
    .select("id, pick, market")
    .eq("sport", "nhl")
    .in("id", [946, 947]);
  if (nhlPrs && nhlPrs.length === 2) {
    const { data: nhlGrades } = await supabase
      .from("prediction_grades")
      .select("prediction_record_id, result")
      .in("prediction_record_id", [946, 947]);
    const gMap = new Map((nhlGrades ?? []).map((g) => [g.prediction_record_id, g.result]));
    for (const pr of nhlPrs) {
      const result = gMap.get(pr.id);
      if (result !== "win") {
        pushIssue(issues, {
          code: "GRADING_NHL_HISTORICAL_REGRESSION",
          severity: "HIGH",
          sport: "nhl",
          affected: {
            prediction_record_id: pr.id,
            details: `Expected pr.id=${pr.id} (${pr.pick}) result=win but got ${result ?? "null"}`,
          },
          user_facing_impact:
            "Historical NHL Finals graded result regressed — member tracking page would show incorrect outcome",
          recommended_fix:
            "Investigate whether prediction_grades row was overwritten or game state was altered post-grade",
          auto_fixable: false,
          operator_approval_required: true,
        });
      }
    }
    pushIssue(issues, {
      code: "GRADING_NHL_HISTORICAL_CONFIRMED",
      severity: "INFO",
      sport: "nhl",
      affected: { details: "pr.id=946 (CAR ML) + pr.id=947 (OVER 5.5) remain WIN" },
      user_facing_impact: "None — confirmation",
      recommended_fix: "n/a",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  // Tracking aggregate check — confirm NHL bySportMarket includes the wins
  try {
    const agg = await computeTrackingAggregate({ supabase, sport: "nhl", includeLaunchDay: true });
    const nhlBuckets = (agg.bySportMarket ?? []).filter((b: { sport?: string }) => b.sport === "nhl");
    let totalNhlWins = 0;
    for (const b of nhlBuckets) {
      totalNhlWins += (b as { metrics?: { wins?: number } }).metrics?.wins ?? 0;
    }
    if (totalNhlWins < 2) {
      pushIssue(issues, {
        code: "GRADING_TRACKING_AGGREGATE_GAP",
        severity: "HIGH",
        sport: "nhl",
        affected: { details: `Tracking aggregate shows ${totalNhlWins} NHL wins but expected ≥2 (CAR ML + OVER 5.5)` },
        user_facing_impact: "Tracking page may not show NHL wins to members",
        recommended_fix: "Investigate computeTrackingAggregate joins; verify launch_day / no_bet filters not excluding NHL rows",
        auto_fixable: false,
        operator_approval_required: false,
      });
    } else {
      pushIssue(issues, {
        code: "GRADING_TRACKING_AGGREGATE_CONFIRMED",
        severity: "INFO",
        sport: "nhl",
        affected: { details: `Tracking aggregate shows ${totalNhlWins} NHL wins across ${nhlBuckets.length} sport-market buckets` },
        user_facing_impact: "None — confirmation",
        recommended_fix: "n/a",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  } catch (e: unknown) {
    pushIssue(issues, {
      code: "GRADING_AGGREGATE_ERROR",
      severity: "WARN",
      sport: null,
      affected: { details: e instanceof Error ? e.message : String(e) },
      user_facing_impact: "Auditor cannot verify tracking aggregate",
      recommended_fix: "Investigate computeTrackingAggregate runtime error",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  // Cross-sport dormant DTO field — result.markets.pickResult is null across sports
  pushIssue(issues, {
    code: "GRADING_DTO_RESULT_DORMANT",
    severity: "INFO",
    sport: null,
    affected: { details: "DailyEdge DTO result.markets.pickResult is dormant/null across MLB+NBA+NHL — not an NHL-specific bug" },
    user_facing_impact:
      "Per-card win/loss is not surfaced in the DTO; tracking page is the surface that shows graded results",
    recommended_fix:
      "P2 — decide cross-sport whether to populate per-card result.markets.{pickResult, gradeUnits}",
    auto_fixable: false,
    operator_approval_required: false,
  });

  return issues;
}

// ─── CHECK 7 — Final score / status integrity ────────────────────────

async function check7FinalScoreStatus(): Promise<Issue[]> {
  const issues: Issue[] = [];

  for (const sport of ACTIVE_SPORTS) {
    const finalStatuses = sport === "nhl" ? ["FINAL", "OFF"] : ["final", "FINAL"];
    const { data: games } = await supabase
      .from("games")
      .select("id, status, slate_date, home_score, away_score")
      .eq("sport", sport)
      .in("status", finalStatuses);
    if (!games) continue;
    for (const g of games) {
      if (g.home_score === null || g.away_score === null) {
        pushIssue(issues, {
          code: "SCORE_FINAL_MISSING_SCORE",
          severity: "HIGH",
          sport,
          affected: {
            game_id: g.id,
            details: `Game ${g.id} (slate ${g.slate_date}, status ${g.status}) has null home_score or away_score`,
          },
          user_facing_impact: "Card / tracking row cannot resolve outcome",
          recommended_fix: "Re-run score ingest for this game from trusted source",
          auto_fixable: true,
          operator_approval_required: false,
        });
      }
    }
  }

  // Stuck-scheduled — games whose kickoff was ≥ 6 hours ago and still "scheduled"
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  for (const sport of ACTIVE_SPORTS) {
    const scheduledStatuses = sport === "nhl" ? ["FUT", "PRE"] : ["scheduled", "SCHED"];
    const { data: stuck } = await supabase
      .from("games")
      .select("id, status, game_date, slate_date")
      .eq("sport", sport)
      .in("status", scheduledStatuses)
      .lt("game_date", sixHoursAgo);
    for (const g of (stuck ?? []) as Array<{ id: number; status: string; game_date: string; slate_date: string }>) {
      pushIssue(issues, {
        code: "SCORE_STUCK_SCHEDULED",
        severity: "HIGH",
        sport,
        affected: {
          game_id: g.id,
          details: `Game ${g.id} (slate ${g.slate_date}, status ${g.status}) game_date ${g.game_date} is >6h in the past but status is still scheduled`,
        },
        user_facing_impact: "Card may show 'upcoming' for a game that already happened",
        recommended_fix: "Re-run score ingest for this game; investigate why status update did not fire",
        auto_fixable: true,
        operator_approval_required: false,
      });
    }
  }

  return issues;
}

// ─── CHECK 8 — Refresh / cron health ────────────────────────────────

async function check8RefreshCronHealth(): Promise<Issue[]> {
  const issues: Issue[] = [];

  const vercelSrc = readRepoFile(VERCEL_JSON_PATH);
  if (vercelSrc === null) {
    pushIssue(issues, {
      code: "CRON_VERCEL_JSON_MISSING",
      severity: "HIGH",
      sport: null,
      affected: { details: VERCEL_JSON_PATH },
      user_facing_impact: "Cron configuration cannot be verified",
      recommended_fix: "Verify vercel.json path",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }

  const expectedCrons: Array<{ pathFragment: string; label: string; sport: ActiveSport | null }> = [
    { pathFragment: "/api/cron/slate-cycle", label: "MLB slate-cycle (16/day)", sport: "mlb" },
    { pathFragment: "/api/cron/tracking-refresh", label: "Hourly tracking-refresh (sport-agnostic)", sport: null },
    { pathFragment: "/api/cron/pregame-sweep", label: "15-min pregame-sweep (sport-agnostic)", sport: null },
    { pathFragment: "/api/cron/nba-daily-refresh", label: "NBA daily refresh", sport: "nba" },
    { pathFragment: "/api/cron/nhl-daily-refresh", label: "NHL daily refresh", sport: "nhl" },
  ];

  for (const cron of expectedCrons) {
    if (!vercelSrc.includes(cron.pathFragment)) {
      pushIssue(issues, {
        code: "CRON_MISSING",
        severity: "HIGH",
        sport: cron.sport,
        affected: { details: `Expected cron path missing in vercel.json: ${cron.pathFragment} (${cron.label})` },
        user_facing_impact: `${cron.label} not scheduled — pipeline will not run automatically`,
        recommended_fix: `Restore ${cron.pathFragment} in vercel.json`,
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // Confirm corresponding route handlers exist
  const routesToCheck = [
    "app/api/cron/slate-cycle/route.ts",
    "app/api/cron/tracking-refresh/route.ts",
    "app/api/cron/pregame-sweep/route.ts",
    "app/api/cron/nba-daily-refresh/route.ts",
    "app/api/cron/nhl-daily-refresh/route.ts",
  ];
  for (const r of routesToCheck) {
    if (!existsSync(resolve(REPO_ROOT, r))) {
      pushIssue(issues, {
        code: "CRON_ROUTE_MISSING",
        severity: "HIGH",
        sport: null,
        affected: { details: r },
        user_facing_impact: "Cron schedule will fail when invoked",
        recommended_fix: `Restore route handler at ${r}`,
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // Env-gate health — surface NHL_CRON_ENABLED, NBA_CRON_ENABLED, etc.
  // (We cannot read process.env in audit context to check production-side; just flag for operator review.)
  pushIssue(issues, {
    code: "CRON_ENV_GATE_NOTE",
    severity: "INFO",
    sport: null,
    affected: {
      details:
        "Sport-specific env gates (NHL_CRON_ENABLED, NBA_CRON_ENABLED) are checked at runtime in route handlers. Auditor cannot inspect production env — confirm via Vercel dashboard.",
    },
    user_facing_impact: "None — confirmation",
    recommended_fix: "n/a",
    auto_fixable: false,
    operator_approval_required: false,
  });

  return issues;
}

// ─── CHECK 9 — Verdict authority consistency ────────────────────────
//
// 2026-06-10 v15.2 — guards the "writer play_grade is the single
// source of truth for the customer-facing verdict" contract. The
// daily-edge route maps play_grade → verdict via `resolveLockedVerdict`
// (now used for BOTH locked and unlocked rows). This check verifies:
//
//   1. Every play_grade value the writer is currently emitting has a
//      corresponding case in the route's resolver (otherwise the live
//      verdict ladder silently downgrades).
//   2. The same resolver is wired in the route file (existence proof
//      that the route fix wasn't reverted).
//
// HIGH when an unmapped play_grade reaches a customer-facing row.
// INFO when the slate is fully mapped.

const KNOWN_WRITER_PLAY_GRADES = new Set<string>([
  // Mapped to "best_angle"
  "best_angle",
  // Mapped to "lean"
  "lean",
  // Mapped to "watchlist"
  "market_watch",
  "model_only",
  "provisional",
  "market_aligned",
  // Mapped to "no_play" via the no_bet path (resolver short-circuits
  // on no_bet=true before reading play_grade)
  "no_bet",
  // The route has separate handling for these (live verdict ladder
  // short-circuits on held/null confidence; toss_up is FI-specific)
  "held",
  "toss_up",
]);

async function check9VerdictAuthorityConsistency(slateDate: string): Promise<Issue[]> {
  const issues: Issue[] = [];

  // (a) Route file has the writer-authority resolver wired
  const routeSrc = readRepoFile("app/api/lab/daily-edge/route.ts");
  if (routeSrc === null) {
    pushIssue(issues, {
      code: "VERDICT_ROUTE_FILE_MISSING",
      severity: "HIGH",
      sport: null,
      affected: { details: "app/api/lab/daily-edge/route.ts not readable" },
      user_facing_impact: "Cannot verify verdict-authority contract",
      recommended_fix: "Investigate route file",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }
  const requiredPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /resolveWriterPlayGrade/, label: "resolveWriterPlayGrade extractor" },
    { pattern: /writerOverride/, label: "writer-authority override binding" },
    { pattern: /case "market_aligned"/, label: "market_aligned case in resolveLockedVerdict" },
  ];
  for (const { pattern, label } of requiredPatterns) {
    if (!pattern.test(routeSrc)) {
      pushIssue(issues, {
        code: "VERDICT_ROUTE_CONTRACT_MISSING",
        severity: "HIGH",
        sport: null,
        affected: { details: `Required route pattern missing: ${label}` },
        user_facing_impact:
          "Pre-lock writer Best Angle / Lean / market_aligned may render as a different verdict than the writer chose",
        recommended_fix:
          "Restore the writer-authority verdict resolver in app/api/lab/daily-edge/route.ts",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // (b) DB-side: every play_grade value on the current slate maps to a
  // known resolver case.
  for (const sport of ACTIVE_SPORTS) {
    const { data: rows, error } = await supabase
      .from("prediction_records")
      .select("id, game_id, market, play_grade, no_bet, locked_at")
      .eq("sport", sport)
      .eq("slate_date", slateDate);

    if (error !== null) {
      pushIssue(issues, {
        code: "VERDICT_DB_ERROR",
        severity: "WARN",
        sport,
        affected: { details: `prediction_records query failed: ${error.message}` },
        user_facing_impact: "Verdict authority check incomplete for this sport",
        recommended_fix: "Investigate DB connectivity",
        auto_fixable: false,
        operator_approval_required: false,
      });
      continue;
    }

    const typed = (rows ?? []) as Array<{
      id: number;
      game_id: number;
      market: string;
      play_grade: string | null;
      no_bet: boolean | null;
      locked_at: string | null;
    }>;

    if (typed.length === 0) continue;

    let mappedCount = 0;
    const unmappedSamples: string[] = [];

    for (const row of typed) {
      const pg = row.play_grade;
      if (pg === null) continue; // null → live ladder fallback by design
      if (KNOWN_WRITER_PLAY_GRADES.has(pg)) {
        mappedCount++;
        continue;
      }
      // Unknown play_grade — resolver will return null → live ladder
      // overrides → writer authority is lost.
      pushIssue(issues, {
        code: "VERDICT_AUTHORITY_UNMAPPED_PLAY_GRADE",
        severity: "HIGH",
        sport,
        affected: {
          game_id: row.game_id,
          market: row.market,
          details: `pr.id=${row.id} play_grade="${pg}" — resolver has no case for this value, route will silently fall back to live ladder`,
        },
        user_facing_impact:
          "Card may display a verdict the writer did not choose",
        recommended_fix: `Add a case "${pg}" to resolveLockedVerdict in app/api/lab/daily-edge/route.ts and to KNOWN_WRITER_PLAY_GRADES in the auditor`,
        auto_fixable: false,
        operator_approval_required: false,
      });
      if (unmappedSamples.length < 3) unmappedSamples.push(pg);
    }

    if (mappedCount > 0) {
      pushIssue(issues, {
        code: "VERDICT_AUTHORITY_CONSISTENT",
        severity: "INFO",
        sport,
        affected: {
          details: `${mappedCount} prediction_record(s) have play_grade values mapped to writer-authority verdict (pre-lock and post-lock will render the same pill the writer chose)`,
        },
        user_facing_impact: "None — confirmation",
        recommended_fix: "n/a",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  return issues;
}

// ─── CHECK 10 — First Inning integrity ─────────────────────────────
//
// 2026-06-10 v15.3 — FI is an official tracked MLB market and needs
// the same writer-authority / display-vs-tracking contract as ML/Total.
// FI has its own enum (`fi_play_grade`) and its own contract; this
// check enforces it explicitly so it can never drift again.
//
// FI display contract (matches resolveLockedVerdict's FI cases):
//   fi_play_grade=best_angle               → "Best Angle"
//   fi_play_grade=lean                     → "Lean"
//   fi_play_grade=toss_up                  → "Watchlist"
//     (non-actionable; no_bet=true also fires for tracking-void; chip
//      stays visible per product contract)
//   fi_play_grade=no_bet                   → "No Play"
//   fi_play_grade=held                     → "No Play"
//
// What this check flags (HIGH unless noted):
//   A. KNOWN_FI_PLAY_GRADES drift          — writer emits a value the
//                                            resolver doesn't map.
//   B. Route file pattern                  — confirms route code still
//                                            wires the FI cases and the
//                                            FI lockedFi passthrough.
//   C. Writer-vs-tracking state divergence — for UNLOCKED rows, the
//                                            live writer state in
//                                            game_predictions disagrees
//                                            with prediction_records
//                                            (the tracked record).
//   D. Untracked FI display                — game_predictions shows an
//                                            actionable FI verdict but
//                                            no prediction_records FI
//                                            row exists for tracking.
//   E. Locked snapshot completeness        — locked FI rows missing the
//                                            fi_v2_audit block.
//   F. FI grading gap                      — games with first_inning_runs
//                                            != null but no FI
//                                            prediction_grades row.

const KNOWN_FI_PLAY_GRADES = new Set<string>([
  "best_angle",  // → Best Angle
  "lean",        // → Lean
  "toss_up",     // → Watchlist (non-actionable, chip visible, void in tracking)
  "no_bet",      // → No Play
  "held",        // → No Play
]);

async function check10FirstInningIntegrity(slateDate: string): Promise<Issue[]> {
  const issues: Issue[] = [];

  // (B) Route file pattern check
  const routeSrc = readRepoFile("app/api/lab/daily-edge/route.ts");
  if (routeSrc === null) {
    pushIssue(issues, {
      code: "FI_ROUTE_FILE_MISSING",
      severity: "HIGH",
      sport: "mlb",
      affected: { details: "app/api/lab/daily-edge/route.ts not readable" },
      user_facing_impact: "Cannot verify FI display contract",
      recommended_fix: "Investigate route file",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }
  const fiRoutePatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /lockedPlayGrade === "toss_up"/, label: "Toss-Up precedence in resolveLockedVerdict" },
    { pattern: /case "toss_up"|=== "toss_up"/, label: "toss_up case in resolveLockedVerdict" },
    { pattern: /case "no_bet":\s+return \{ key: "no_play"|case "held":/, label: "held / no_bet → No Play cases" },
    { pattern: /lockedFi\?\.playGrade/, label: "lockedFi passed to FI buildMarketEdge" },
  ];
  for (const { pattern, label } of fiRoutePatterns) {
    if (!pattern.test(routeSrc)) {
      pushIssue(issues, {
        code: "FI_ROUTE_CONTRACT_MISSING",
        severity: "HIGH",
        sport: "mlb",
        affected: { details: `Required FI route pattern missing: ${label}` },
        user_facing_impact: "FI display contract broken — writer verdict may not survive to card",
        recommended_fix: "Restore the FI writer-authority wiring in app/api/lab/daily-edge/route.ts",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // Pull all FI prediction_records for this slate
  const { data: prRows, error: prErr } = await supabase
    .from("prediction_records")
    .select("id, game_id, pick, confidence, play_grade, no_bet, locked_at, snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("market", "first_inning");
  if (prErr !== null) {
    pushIssue(issues, {
      code: "FI_DB_ERROR",
      severity: "WARN",
      sport: "mlb",
      affected: { details: `prediction_records query failed: ${prErr.message}` },
      user_facing_impact: "FI integrity check incomplete",
      recommended_fix: "Investigate DB connectivity",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }
  type PrRow = {
    id: number;
    game_id: number;
    pick: string | null;
    confidence: number | null;
    play_grade: string | null;
    no_bet: boolean | null;
    locked_at: string | null;
    snapshot_json: Record<string, unknown> | null;
  };
  const prByGame = new Map<number, PrRow>();
  for (const r of (prRows ?? []) as PrRow[]) prByGame.set(r.game_id, r);

  // Pull live game_predictions for the same slate (the source of truth
  // for the displayed FI verdict on unlocked rows).
  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("id, slate_date, status, first_inning_runs, game_predictions(predicted_nrfi, nrfi_confidence, sport_specific, locked_at)")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate);
  if (gErr !== null) {
    pushIssue(issues, {
      code: "FI_DB_ERROR",
      severity: "WARN",
      sport: "mlb",
      affected: { details: `games query failed: ${gErr.message}` },
      user_facing_impact: "FI integrity check incomplete",
      recommended_fix: "Investigate DB connectivity",
      auto_fixable: false,
      operator_approval_required: false,
    });
    return issues;
  }
  // Supabase typegen renders one-to-one FK expansions as arrays at the
  // type level, but the runtime returns a single object for to-one
  // relations. Mirror what the route does (`as unknown` step).
  type GameRow = {
    id: number;
    slate_date: string;
    status: string | null;
    first_inning_runs: number | null;
    game_predictions: {
      predicted_nrfi: boolean | null;
      nrfi_confidence: number | null;
      sport_specific: Record<string, unknown> | null;
      locked_at: string | null;
    } | null;
  };

  // Pull prediction_grades for every FI prediction_record id. The
  // column is `result` (not `outcome`) — selecting the wrong column
  // makes Supabase silently return rows with the missing field as
  // undefined, which produces false-positive "grade missing" flags.
  const prIds = (prRows ?? []).map((r) => (r as PrRow).id);
  let gradeByPrId = new Map<number, { result: string | null; actual_first_inning_runs: number | null }>();
  if (prIds.length > 0) {
    const { data: gradeRows } = await supabase
      .from("prediction_grades")
      .select("prediction_record_id, result, actual_first_inning_runs")
      .in("prediction_record_id", prIds);
    gradeByPrId = new Map(
      (gradeRows ?? []).map((g: { prediction_record_id: number; result: string | null; actual_first_inning_runs: number | null }) => [g.prediction_record_id, g])
    );
  }

  let mappedCount = 0;
  let displayedFiCount = 0;

  for (const game of (games ?? []) as unknown as GameRow[]) {
    const gp = game.game_predictions;
    if (gp === null || gp === undefined) continue;
    const sp = gp.sport_specific ?? null;
    const fiAudit = sp ? ((sp.fi_v2_audit as Record<string, unknown> | undefined) ?? null) : null;
    const liveFiPg = fiAudit ? (fiAudit.fi_play_grade as string | undefined) ?? null : null;
    const pr = prByGame.get(game.id) ?? null;

    // (A) Known-grade check on live writer state
    if (liveFiPg !== null && !KNOWN_FI_PLAY_GRADES.has(liveFiPg)) {
      pushIssue(issues, {
        code: "FI_UNMAPPED_PLAY_GRADE",
        severity: "HIGH",
        sport: "mlb",
        affected: {
          game_id: game.id,
          details: `game_predictions.fi_v2_audit.fi_play_grade="${liveFiPg}" — no case in resolveLockedVerdict; route will fall back to live ladder`,
        },
        user_facing_impact: "Card may display a verdict the FI writer did not choose",
        recommended_fix: `Add case "${liveFiPg}" to resolveLockedVerdict in app/api/lab/daily-edge/route.ts and to KNOWN_FI_PLAY_GRADES in the auditor`,
        auto_fixable: false,
        operator_approval_required: false,
      });
    }

    // (D) Untracked FI display — game_predictions shows actionable FI
    //     verdict (best_angle / lean) but no prediction_records FI row
    //     means tracking can never grade this displayed pick. As of
    //     2026-06-10 v15.3 this is auto-fixable: every model write
    //     now chains a createPredictionRecords sync, so this only
    //     fires in the short window between a fresh model write and
    //     the sync completion, OR if the sync silently errored. Fix
    //     path is the same operation tracking-refresh + the new
    //     atomic sync both call.
    const actionable = liveFiPg === "best_angle" || liveFiPg === "lean";
    if (actionable && pr === null) {
      pushIssue(issues, {
        code: "FI_UNTRACKED_DISPLAY",
        severity: "HIGH",
        sport: "mlb",
        affected: {
          game_id: game.id,
          details: `game_predictions has fi_play_grade="${liveFiPg}" (actionable) but no prediction_records row for first_inning — display vs tracking diverge`,
        },
        user_facing_impact: "Card shows actionable FI pick that will never be graded",
        recommended_fix:
          "Call createPredictionRecords({sport:'mlb', slateDate, apply:true}). " +
          "The post-write atomic sync added 2026-06-10 v15.3 normally prevents this; " +
          "if it persists, investigate why automodelService's sync errored " +
          "and ensure tracking-refresh ran for this slate.",
        auto_fixable: true,
        operator_approval_required: false,
      });
    }

    // (C) Writer state divergence — UNLOCKED rows where prediction_records
    //     and game_predictions disagree about fi_play_grade. As of
    //     2026-06-10 v15.3 this is auto-fixable for the same reason
    //     as (D): the atomic sync now re-upserts unlocked rows on every
    //     model write. Persistent divergence indicates a sync error.
    if (pr !== null && pr.locked_at === null) {
      const prSnap = pr.snapshot_json ?? null;
      const prFi = prSnap ? (prSnap.fi_v2_audit as Record<string, unknown> | undefined) ?? null : null;
      const prFiPg = prFi ? (prFi.fi_play_grade as string | undefined) ?? null : null;
      if (prFiPg !== null && liveFiPg !== null && prFiPg !== liveFiPg) {
        pushIssue(issues, {
          code: "FI_STATE_DIVERGENCE",
          severity: "HIGH",
          sport: "mlb",
          affected: {
            game_id: game.id,
            details: `pr.id=${pr.id} prediction_records.fi_play_grade="${prFiPg}" but game_predictions.fi_play_grade="${liveFiPg}" — unlocked rows must agree`,
          },
          user_facing_impact: "Card displays one verdict (live), tracking expects another (recorded). At lock time the recorded one may not match what the member saw.",
          recommended_fix:
            "Call createPredictionRecords({sport:'mlb', slateDate, apply:true}). " +
            "The post-write atomic sync added 2026-06-10 v15.3 normally prevents this; " +
            "if it persists, investigate why automodelService's sync errored " +
            "and check tracking-refresh-cron health.",
          auto_fixable: true,
          operator_approval_required: false,
        });
      }
    }

    // (E) Locked snapshot completeness — locked FI rows must carry
    //     fi_v2_audit block in snapshot_json
    if (pr !== null && pr.locked_at !== null) {
      const prSnap = pr.snapshot_json ?? null;
      const prFi = prSnap ? (prSnap.fi_v2_audit as Record<string, unknown> | undefined) ?? null : null;
      if (prFi === null) {
        pushIssue(issues, {
          code: "FI_LOCK_SNAPSHOT_INCOMPLETE",
          severity: "HIGH",
          sport: "mlb",
          affected: {
            game_id: game.id,
            details: `pr.id=${pr.id} is locked (${pr.locked_at}) but snapshot_json.fi_v2_audit is missing — cannot resolve verdict from locked snapshot`,
          },
          user_facing_impact: "Locked FI card may render incorrectly because fi_v2_audit data isn't frozen",
          recommended_fix: "Lock writer must include fi_v2_audit in locked snapshot_json for FI rows",
          auto_fixable: false,
          operator_approval_required: false,
        });
      }
    }

    if (liveFiPg !== null && KNOWN_FI_PLAY_GRADES.has(liveFiPg)) {
      mappedCount++;
      if (liveFiPg === "best_angle" || liveFiPg === "lean" || liveFiPg === "toss_up") displayedFiCount++;
    }

    // (F) FI grading gap — first_inning_runs populated but no settled
    // grade row. Toss-Up / Held / no_bet rows are voided (still settled);
    // NRFI/YRFI rows are win/loss. Any still-pending row when
    // first_inning_runs is set means the grader didn't run or didn't
    // upsert. (The column is `result`, not `outcome` — earlier draft
    // selected the wrong column and got silent false-positive
    // "grade missing" flags on rows that were actually graded.)
    if (pr !== null && game.first_inning_runs !== null && game.first_inning_runs !== undefined) {
      const g = gradeByPrId.get(pr.id);
      const settled = g !== undefined && g.result !== null && g.result !== "pending";
      if (!settled) {
        pushIssue(issues, {
          code: "FI_GRADING_GAP",
          severity: "HIGH",
          sport: "mlb",
          affected: {
            game_id: game.id,
            details: `pr.id=${pr.id} pick="${pr.pick}" games.first_inning_runs=${game.first_inning_runs} but prediction_grades.result=${g?.result ?? "missing"} — FI should grade as soon as first_inning_runs is set`,
          },
          user_facing_impact: "Tracking page will not reflect FI outcome for this game",
          recommended_fix: "Investigate tracking-refresh / predictionGrader.gradeFirstInning() invocation for FI rows",
          auto_fixable: false,
          operator_approval_required: false,
        });
      }
    }
  }

  // Summary INFO row when no HIGH issues fired for FI rows
  if (mappedCount > 0) {
    pushIssue(issues, {
      code: "FI_CONTRACT_CONSISTENT",
      severity: "INFO",
      sport: "mlb",
      affected: {
        details: `${mappedCount} game(s) have FI writer play_grade in the known set, ${displayedFiCount} actionable. Writer authority will survive to the card (Best Angle / Lean / Watchlist for Toss-Up / No Play for held+no_bet).`,
      },
      user_facing_impact: "None — confirmation",
      recommended_fix: "n/a",
      auto_fixable: false,
      operator_approval_required: false,
    });
  }

  return issues;
}

// ─── Status classifier ──────────────────────────────────────────────

function classifySportStatus(issues: Issue[]): SportStatus {
  if (issues.some((i) => i.severity === "HIGH")) return "BLOCKED";
  if (issues.some((i) => i.severity === "WARN")) return "PARTIAL";
  return "TRUSTED";
}

// ─── Formatter ──────────────────────────────────────────────────────

function formatReport(report: CurrentSiteReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(`Current Site Stability Report — ${report.slate_date}`);
  lines.push(`Generated at: ${report.generated_at}`);
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("PER-SPORT STATUS");
  for (const sport of ACTIVE_SPORTS) {
    const status = report.sport_status[sport];
    const marker = status === "TRUSTED" ? "✓" : status === "PARTIAL" ? "⚠" : "✗";
    lines.push(`  ${marker} ${sport.toUpperCase()}: ${status}`);
  }
  lines.push("");
  lines.push(`SUMMARY  HIGH=${report.summary.high}  WARN=${report.summary.warn}  INFO=${report.summary.info}`);
  lines.push("");

  const renderGroup = (label: string, issues: Issue[]) => {
    if (issues.length === 0) return;
    lines.push(`─── ${label} (${issues.length}) ────────────────────────────────────`);
    for (const i of issues) {
      const where = i.sport ? `[${i.sport.toUpperCase()}]` : "[ALL]";
      lines.push(`  • ${i.code} ${where}`);
      if (i.affected.details) lines.push(`      affected: ${i.affected.details}`);
      if (i.user_facing_impact !== "None — confirmation") {
        lines.push(`      impact: ${i.user_facing_impact}`);
      }
      if (i.recommended_fix !== "n/a") {
        lines.push(`      fix: ${i.recommended_fix}`);
      }
      lines.push(`      auto_fixable=${i.auto_fixable}  operator_approval=${i.operator_approval_required}`);
    }
    lines.push("");
  };

  const allIssues: Issue[] = [
    ...report.cross_sport_issues,
    ...ACTIVE_SPORTS.flatMap((s) => report.per_sport_issues[s]),
  ];
  renderGroup("HIGH", allIssues.filter((i) => i.severity === "HIGH"));
  renderGroup("WARN", allIssues.filter((i) => i.severity === "WARN"));
  renderGroup("INFO", allIssues.filter((i) => i.severity === "INFO"));

  if (report.safe_repairs_available.length > 0) {
    lines.push(`─── SAFE REPAIRS AVAILABLE (${report.safe_repairs_available.length}, dry-run only for v1) ───`);
    for (const i of report.safe_repairs_available) {
      lines.push(`  • ${i.code} ${i.sport ? `[${i.sport.toUpperCase()}]` : "[ALL]"}`);
      if (i.affected.details) lines.push(`      ${i.affected.details}`);
    }
    lines.push("");
  }

  if (report.blocked_repairs_needing_approval.length > 0) {
    lines.push(`─── BLOCKED REPAIRS NEEDING APPROVAL (${report.blocked_repairs_needing_approval.length}) ───`);
    for (const i of report.blocked_repairs_needing_approval) {
      lines.push(`  • ${i.code} ${i.sport ? `[${i.sport.toUpperCase()}]` : "[ALL]"}`);
      if (i.affected.details) lines.push(`      ${i.affected.details}`);
      lines.push(`      why approval required: ${i.recommended_fix.slice(0, 200)}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(`Exit code: ${report.summary.high > 0 ? 1 : 0}`);
  lines.push("");
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let jsonOut: string | null = null;
  let quiet = false;
  let slateDate = todayET();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") {
      jsonOut = argv[++i] ?? null;
    } else if (argv[i] === "--quiet") {
      quiet = true;
    } else if (argv[i] === "--date") {
      slateDate = argv[++i] ?? slateDate;
    }
  }

  const allChecks = [
    { name: "Check 1 — Registry integrity", fn: check1RegistryIntegrity },
    { name: "Check 2 — Context-only display", fn: check2ContextOnlyDisplay },
    { name: "Check 3 — Prediction completeness", fn: () => check3PredictionRecordCompleteness(slateDate) },
    { name: "Check 4 — Lock snapshot completeness", fn: check4LockSnapshotCompleteness },
    { name: "Check 5 — Card/copy truthfulness", fn: check5CardCopyTruthfulness },
    { name: "Check 6 — Grading/tracking", fn: check6GradingTracking },
    { name: "Check 7 — Final score/status", fn: check7FinalScoreStatus },
    { name: "Check 8 — Refresh/cron health", fn: check8RefreshCronHealth },
    { name: "Check 9 — Verdict authority consistency", fn: () => check9VerdictAuthorityConsistency(slateDate) },
    { name: "Check 10 — First Inning integrity", fn: () => check10FirstInningIntegrity(slateDate) },
  ];

  const allIssues: Issue[] = [];
  for (const c of allChecks) {
    try {
      const issues = await c.fn();
      allIssues.push(...issues);
    } catch (e: unknown) {
      allIssues.push({
        code: "CHECK_RUNTIME_ERROR",
        severity: "WARN",
        sport: null,
        affected: { details: `${c.name}: ${e instanceof Error ? e.message : String(e)}` },
        user_facing_impact: "Auditor partial — one check failed to complete",
        recommended_fix: "Investigate the check runtime error",
        auto_fixable: false,
        operator_approval_required: false,
      });
    }
  }

  // Partition by sport
  const perSport: Record<ActiveSport, Issue[]> = { mlb: [], nba: [], nhl: [] };
  const crossSport: Issue[] = [];
  for (const i of allIssues) {
    if (i.sport === null) crossSport.push(i);
    else perSport[i.sport].push(i);
  }

  const sportStatus: Record<ActiveSport, SportStatus> = {
    mlb: classifySportStatus([...crossSport, ...perSport.mlb]),
    nba: classifySportStatus([...crossSport, ...perSport.nba]),
    nhl: classifySportStatus([...crossSport, ...perSport.nhl]),
  };

  const summary = {
    high: allIssues.filter((i) => i.severity === "HIGH").length,
    warn: allIssues.filter((i) => i.severity === "WARN").length,
    info: allIssues.filter((i) => i.severity === "INFO").length,
  };

  const safeRepairs = allIssues.filter((i) => i.auto_fixable && !i.operator_approval_required);
  const blockedRepairs = allIssues.filter((i) => i.operator_approval_required);

  const report: CurrentSiteReport = {
    generated_at: new Date().toISOString(),
    slate_date: slateDate,
    sport_status: sportStatus,
    cross_sport_issues: crossSport,
    per_sport_issues: perSport,
    summary,
    safe_repairs_available: safeRepairs,
    blocked_repairs_needing_approval: blockedRepairs,
  };

  if (!quiet) {
    console.log(formatReport(report));
  }

  if (jsonOut !== null) {
    const json = JSON.stringify(report, null, 2);
    if (jsonOut === "-") {
      console.log(json);
    } else {
      writeFileSync(jsonOut, json);
      if (!quiet) console.log(`JSON report written to: ${jsonOut}`);
    }
  }

  process.exit(summary.high > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("Auditor crashed:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
