/**
 * Tracking/display correction audit.
 *
 * Read-only by default. Compares prediction_records tracking grade against the
 * latest captured member-facing AI shadow grade before lock, and replays the
 * deterministic MLB Best Angle guard that should keep tracking aligned with
 * what members saw.
 *
 * Apply mode writes snapshot_json.tracking_display_grade_override for rows where
 * the captured member-facing grade disagrees with tracking, and keeps
 * prediction_records.best_angle consistent with that override. It never changes
 * picks, lines, prices, outcomes, or no_bet.
 */
import { supabase } from "@/lib/db/supabase";
import {
  GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB,
  GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB,
  resolveMlbBestAngle,
} from "@/lib/services/predictionRecordService";

type Args = {
  sport: string;
  from: string;
  to: string;
  market: string | null;
  json: boolean;
  apply: boolean;
  includeDeterministic: boolean;
};

type GradeLabel = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play" | "Unknown";

type RecordRow = {
  id: number;
  sport: string;
  slate_date: string;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string | null;
  launch_day: boolean | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type ShadowRow = {
  created_at: string;
  sport: string;
  slate_date: string;
  matchup: string | null;
  market: string | null;
  original_pick: string | null;
  original_grade: string | null;
  ai_recommended_grade: string | null;
  run_id: string;
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map((x) => Number.parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function parseArgs(): Args {
  const out: Args = {
    sport: "mlb",
    from: "2026-06-07",
    to: todayEt(),
    market: null,
    json: false,
    apply: false,
    includeDeterministic: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") out.json = true;
    if (arg === "--apply") out.apply = true;
    if (arg === "--include-deterministic") out.includeDeterministic = true;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase();
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? todayEt() : value === "yesterday" ? shiftDate(todayEt(), -1) : value;
    if (key === "date") {
      const date = value === "today" ? todayEt() : value === "yesterday" ? shiftDate(todayEt(), -1) : value;
      out.from = date;
      out.to = date;
    }
    if (key === "market") out.market = value.toLowerCase();
  }
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeMatchup(value: string | null): string {
  return String(value ?? "")
    .replace("@", " @ ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizePick(value: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeGrade(raw: string | null | undefined, bestAngle?: boolean | null, noBet?: boolean | null): GradeLabel {
  if (noBet === true) return "No Play";
  if (bestAngle === true) return "Best Angle";
  const v = String(raw ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (v.trim() === "" && noBet === false) return "Watchlist";
  if (v.includes("best")) return "Best Angle";
  if (v.includes("lean")) return "Lean";
  if (v.includes("watch") || v.includes("market aligned") || v.includes("provisional")) return "Watchlist";
  if (v.includes("caution")) return "Caution";
  if (v.includes("no play") || v.includes("no bet") || v.includes("held")) return "No Play";
  return "Unknown";
}

function overrideGrade(snapshot: Record<string, unknown> | null): GradeLabel | null {
  const raw = snapshot?.tracking_display_grade_override;
  return typeof raw === "string" ? normalizeGrade(raw) : null;
}

function canonicalGrade(label: GradeLabel): "best_angle" | "lean" | "watchlist" | "caution" | "no_play" | null {
  switch (label) {
    case "Best Angle": return "best_angle";
    case "Lean": return "lean";
    case "Watchlist": return "watchlist";
    case "Caution": return "caution";
    case "No Play": return "no_play";
    default: return null;
  }
}

function boolish(value: unknown): boolean {
  return value === true || value === "true";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function deterministicDemoteReason(row: RecordRow): string | null {
  if (row.sport !== "mlb") return null;
  if (row.market !== "moneyline" && row.market !== "total") return null;
  if (row.best_angle !== true) return null;
  const snap = row.snapshot_json ?? {};
  const resolution = (snap.best_angle_resolution ?? {}) as Record<string, unknown>;
  const lineDirection = text(resolution.line_direction) as "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  const resolved = resolveMlbBestAngle({
    baseEligible: boolish(resolution.base_eligible),
    requiresConfirmation: boolish(resolution.requires_confirmation),
    lineDirection,
    opposingPublicMoney: text(resolution.demote_reason) === "opposing_public_money",
  });
  if (!resolved.bestAngle) return resolved.demoteReason ?? "best_angle_guard";
  if (row.market === "total") {
    const minProb =
      row.side === "over"
        ? GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB
        : row.side === "under"
          ? GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB
          : null;
    if (minProb !== null && row.model_probability !== null && row.model_probability < minProb) {
      return row.side === "over" ? "total_over_quality_gate" : "total_under_quality_gate";
    }
  }
  return null;
}

async function loadRecords(args: Args): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (let from = 0; ; from += 750) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,locked_at,launch_day,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .gte("slate_date", args.from)
      .lte("slate_date", args.to)
      .order("slate_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 749);
    if (args.market !== null) query = query.eq("market", args.market);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records query failed: ${error.message}`);
    out.push(...((data ?? []) as RecordRow[]));
    if ((data ?? []).length < 750) break;
  }
  return out.filter((r) => r.launch_day !== true);
}

async function loadShadowRows(args: Args): Promise<ShadowRow[]> {
  const out: ShadowRow[] = [];
  for (let from = 0; ; from += 750) {
    let query = supabase
      .from("ai_audit_evaluation_results")
      .select("created_at,sport,slate_date,matchup,market,original_pick,original_grade,ai_recommended_grade,run_id")
      .eq("sport", args.sport)
      .gte("slate_date", args.from)
      .lte("slate_date", args.to)
      .eq("audit_scope", "daily_edge_intelligence_shadow")
      .order("created_at", { ascending: true })
      .range(from, from + 749);
    if (args.market !== null) query = query.eq("market", args.market);
    const { data, error } = await query;
    if (error) throw new Error(`ai_audit_evaluation_results query failed: ${error.message}`);
    out.push(...((data ?? []) as ShadowRow[]));
    if ((data ?? []).length < 750) break;
  }
  return out;
}

function latestShadowBeforeLock(row: RecordRow, shadowRows: ShadowRow[]): ShadowRow | null {
  const matchup = normalizeMatchup(row.matchup);
  const pick = normalizePick(row.pick);
  const lockAt = row.locked_at ?? `${row.slate_date}T23:59:59.999Z`;
  return shadowRows
    .filter((s) =>
      s.slate_date === row.slate_date &&
      s.market === row.market &&
      normalizeMatchup(s.matchup) === matchup &&
      normalizePick(s.original_pick) === pick &&
      s.created_at <= lockAt
    )
    .at(-1) ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const records = await loadRecords(args);
  const shadows = await loadShadowRows(args);
  const rows = records.map((record) => {
    const display = latestShadowBeforeLock(record, shadows);
    const trackingGrade = overrideGrade(record.snapshot_json) ?? normalizeGrade(record.play_grade, record.best_angle, record.no_bet);
    const displayedGrade = display ? normalizeGrade(display.original_grade) : null;
    const guardDemoteReason = deterministicDemoteReason(record);
    const guardGrade = guardDemoteReason !== null && trackingGrade === "Best Angle" ? "Lean" : null;
    const targetGrade = displayedGrade ?? (args.includeDeterministic ? guardGrade : null);
    const targetCanonical = targetGrade ? canonicalGrade(targetGrade) : null;
    const currentCanonical = canonicalGrade(trackingGrade);
    const proposedCorrection =
      targetCanonical !== null &&
      targetCanonical !== currentCanonical &&
      record.no_bet !== true;
    return {
      id: record.id,
      slate_date: record.slate_date,
      matchup: record.matchup,
      market: record.market,
      pick: record.pick,
      line_value: record.line_value,
      odds_american: record.odds_american,
      result: one(record.prediction_grades)?.result ?? null,
      locked_at: record.locked_at,
      trackingGrade,
      displayedGrade,
      displayedAt: display?.created_at ?? null,
      aiRecommendedGrade: display?.ai_recommended_grade ?? null,
      guardDemoteReason,
      targetGrade,
      targetCanonical,
      currentCanonical,
      proposedCorrection,
      reason: proposedCorrection
        ? displayedGrade !== null
          ? "display_before_lock_grade_mismatch"
          : guardDemoteReason
        : null,
      deterministicOnly: displayedGrade === null && guardGrade !== null,
      snapshot_json: record.snapshot_json,
    };
  });

  const proposed = rows.filter((r) => r.proposedCorrection);
  if (args.apply && proposed.length > 0) {
    for (const row of proposed) {
      const snapshot = row.snapshot_json && typeof row.snapshot_json === "object" ? row.snapshot_json : {};
      const { error } = await supabase
        .from("prediction_records")
        .update({
          best_angle: row.targetCanonical === "best_angle",
          snapshot_json: {
            ...snapshot,
            tracking_display_grade_override: row.targetCanonical,
            tracking_display_grade_correction: {
              corrected_at: new Date().toISOString(),
              source: row.displayedGrade !== null ? "ai_audit_evaluation_results.daily_edge_intelligence_shadow" : "deterministic_best_angle_guard",
              previous_tracking_grade: row.currentCanonical,
              corrected_tracking_grade: row.targetCanonical,
              displayed_at: row.displayedAt,
              reason: row.reason,
            },
          },
        })
        .eq("id", row.id);
      if (error) throw new Error(`prediction_records update failed for id=${row.id}: ${error.message}`);
    }
  }

  const summary = {
    mode: args.apply ? "applied" : "dry_run",
    sport: args.sport,
    from: args.from,
    to: args.to,
    market: args.market,
    includeDeterministic: args.includeDeterministic,
    records: rows.length,
    shadowRows: shadows.length,
    trackedBestAngles: rows.filter((r) => r.trackingGrade === "Best Angle").length,
    displayMismatches: rows.filter((r) => r.displayedGrade !== null && r.displayedGrade !== r.trackingGrade).length,
    deterministicGuardDemotions: rows.filter((r) => r.guardDemoteReason !== null).length,
    deterministicOnlyDemotions: rows.filter((r) => r.deterministicOnly).length,
    missingLockedOddsOnBestAngles: rows.filter((r) => r.trackingGrade === "Best Angle" && r.odds_american === null).length,
    proposedCorrections: proposed.length,
    proposedRows: proposed.map(({ snapshot_json: _snapshot, ...row }) => row),
    allRows: args.json ? rows.map(({ snapshot_json: _snapshot, ...row }) => row) : undefined,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Tracking/display correction audit (${summary.mode})`);
    console.log(`${summary.sport} ${summary.from}..${summary.to}${summary.market ? ` ${summary.market}` : ""}`);
    console.log(`records=${summary.records} shadowRows=${summary.shadowRows}`);
    console.log(`trackedBestAngles=${summary.trackedBestAngles}`);
    console.log(`displayMismatches=${summary.displayMismatches}`);
    console.log(`deterministicGuardDemotions=${summary.deterministicGuardDemotions}`);
    console.log(`deterministicOnlyDemotions=${summary.deterministicOnlyDemotions}`);
    console.log(`missingLockedOddsOnBestAngles=${summary.missingLockedOddsOnBestAngles}`);
    console.log(`proposedCorrections=${summary.proposedCorrections}`);
    for (const r of proposed) {
      console.log(`- id=${r.id} ${r.slate_date} ${r.matchup} ${r.market} ${r.pick} tracking=${r.trackingGrade} target=${r.targetGrade ?? "none"} displayed=${r.displayedGrade ?? "none"} guard=${r.guardDemoteReason ?? "none"} result=${r.result}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
