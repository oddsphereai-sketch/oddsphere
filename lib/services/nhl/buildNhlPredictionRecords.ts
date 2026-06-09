/**
 * Phase 7L Phase 4 — NHL prediction_records writer.
 *
 * Writes one prediction_records row per non-passed market (ML, Total)
 * for the requested slate. Mirrors NBA's writer shape; uses the v0
 * NHL model.
 *
 * Scope:
 *   • Markets: `moneyline` and `total` ONLY (per v0 spec; puck-line
 *     deferred until calibration justifies it).
 *   • No props.
 *   • sport='nhl'; never touches MLB / NBA rows.
 *
 * Idempotency:
 *   • Upsert on (game_id, market, model_version, slate_date) — same
 *     v17 unique key MLB/NBA use.
 *   • Locked-row preservation: once locked_at IS NOT NULL, subsequent
 *     passes SKIP. Lock captures the snapshot at puck drop.
 *
 * Lock semantics:
 *   • Set locked_at = now() when game starts within
 *     LOCK_MINUTES_BEFORE_PUCK_DROP of now, or game has already started.
 *   • Lock freezes the full snapshot: model output, market price/line,
 *     goalie assumption, feature inputs. Only `result` updates after.
 *
 * snapshot_json (stable schema for ops review + future migrations):
 *   {
 *     model_version: "nhl_v0_2026_finals",
 *     model_output: { ...nhlAutoModelV0 result },
 *     feature_inputs: { ...featureSnapshot inputs },
 *     market_at_lock: {
 *       ml_implied_home_prob, ml_book_count,
 *       total_line, total_book_count,
 *       lines_snapshot: [...]
 *     },
 *     goalie_assumption: {
 *       home: { player_external_id, player_name, source },
 *       away: { player_external_id, player_name, source }
 *     },
 *     locked_at_iso, lock_source
 *   }
 */

import { supabase } from "../../db/supabase";
import { buildNhlFeatureSnapshot } from "./featureSnapshot";
import {
  nhlAutoModelV0,
  NHL_MODEL_VERSION_CONST,
  type NhlModelOutput,
} from "../../automodel/nhlAutoModelV0";
import type { PredictionRecordRow, TrackedMarketV17 } from "../../types/domain/Tracking";

const LOCK_MINUTES_BEFORE_PUCK_DROP = 60;

export type WriteNhlRecordsOptions = {
  /** YYYY-MM-DD ET slate. */
  slateDate: string;
  /** MoneyPuck season start-year (2025 for 2025-26). */
  season: number;
  /** false = dry-run; no DB writes. */
  apply: boolean;
  /** Manual goalie overrides (player_external_id from nhl_goalie_stats). */
  homeGoalieExternalId?: number;
  awayGoalieExternalId?: number;
  /**
   * Goalie source tag persisted in snapshot. "manual_override" when the
   * caller passed an explicit ID; "default_most_playoff_gp" otherwise.
   * Caller controls the tag — operator script passes "manual_override"
   * when --home-goalie/--away-goalie is set.
   */
  goalieSource?: "default_most_playoff_gp" | "manual_override";
  logger?: (msg: string) => void;
};

export type WriteNhlRecordsResult = {
  mode: "dry-run" | "write" | "no-games";
  gamesProcessed: number;
  recordsCreated: number;
  recordsSkippedLocked: number;
  recordsSkippedPass: number;
  errors: string[];
};

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
};

type TeamRow = { id: number; abbreviation: string };

function shouldLock(gameDateIso: string, now: Date): boolean {
  try {
    const puckDrop = new Date(gameDateIso).getTime();
    const nowMs = now.getTime();
    return puckDrop - nowMs <= LOCK_MINUTES_BEFORE_PUCK_DROP * 60 * 1000;
  } catch {
    return false;
  }
}

function gradeFromVerdict(verdict: string): string {
  switch (verdict) {
    case "best_angle": return "best_signal";
    case "lean":       return "model_only";
    case "watchlist":  return "market_watch";
    case "pass":       return "model_only";
    default:           return "model_only";
  }
}

/**
 * Build the snapshot_json payload — a stable, ops-readable record of
 * everything that fed the prediction at lock time. Caller passes the
 * goalie meta directly so we don't re-fetch.
 */
function buildSnapshotJson(opts: {
  model: NhlModelOutput;
  marketLines: Array<{
    market_type: string;
    sportsbook: string;
    side: string;
    line_value: number | null;
    odds_american: number | null;
  }>;
  goalieAssumption: {
    home: { player_external_id?: number; player_name?: string; source: string };
    away: { player_external_id?: number; player_name?: string; source: string };
  };
  featureInputs: unknown;
  lockedAtIso: string | null;
  lockSource: "live" | "locked";
}): Record<string, unknown> {
  return {
    model_version: NHL_MODEL_VERSION_CONST,
    model_output: opts.model,
    feature_inputs: opts.featureInputs,
    market_at_lock: {
      ml_implied_home_prob: opts.model.inputs_summary.market_book_count > 0
        ? opts.model.moneyline.model_market_gap_pct !== null
          ? opts.model.moneyline.probability - opts.model.moneyline.model_market_gap_pct
          : null
        : null,
      ml_book_count: opts.model.inputs_summary.market_book_count,
      total_line: opts.model.total.model_market_gap_pct !== null
        ? opts.model.expected_total_goals - opts.model.total.model_market_gap_pct
        : null,
      lines_snapshot: opts.marketLines,
    },
    goalie_assumption: opts.goalieAssumption,
    locked_at_iso: opts.lockedAtIso,
    lock_source: opts.lockSource,
  };
}

export async function writeNhlPredictionRecords(
  opts: WriteNhlRecordsOptions,
): Promise<WriteNhlRecordsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const now = new Date();

  // 1. Load NHL games for the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date")
    .eq("sport", "nhl")
    .eq("slate_date", opts.slateDate);
  if (gamesErr) throw new Error(`load NHL games: ${gamesErr.message}`);
  const games = (gamesData as DbGame[] | null) ?? [];
  if (games.length === 0) {
    log(`(no NHL games on slate ${opts.slateDate})`);
    return {
      mode: "no-games", gamesProcessed: 0,
      recordsCreated: 0, recordsSkippedLocked: 0, recordsSkippedPass: 0,
      errors,
    };
  }

  // 2. Load teams for matchup label.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamById = new Map<number, TeamRow>(
    (teamsData as TeamRow[] | null ?? []).map((t) => [t.id, t]),
  );

  // 3. For each game: snapshot → model → write record(s).
  let recordsCreated = 0;
  let recordsSkippedLocked = 0;
  let recordsSkippedPass = 0;

  for (const g of games) {
    try {
      const { snapshot, meta } = await buildNhlFeatureSnapshot({
        gameId: g.id,
        season: opts.season,
        homeGoalieExternalId: opts.homeGoalieExternalId,
        awayGoalieExternalId: opts.awayGoalieExternalId,
      });
      const model = nhlAutoModelV0(snapshot);

      // Fetch lines snapshot for the snapshot_json.
      const { data: linesData } = await supabase
        .from("lines")
        .select("market_type, sportsbook, side, line_value, odds_american")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total"]);
      const lines = (linesData as Array<{
        market_type: string; sportsbook: string; side: string;
        line_value: number | null; odds_american: number | null;
      }> | null) ?? [];

      const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
      const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
      const matchup = `${awayAbbr} @ ${homeAbbr}`;

      const goalieSource = opts.goalieSource ??
        (opts.homeGoalieExternalId !== undefined || opts.awayGoalieExternalId !== undefined
          ? "manual_override"
          : "default_most_playoff_gp");

      const goalieAssumption = {
        home: {
          player_external_id: opts.homeGoalieExternalId,
          player_name: meta.home_goalie,
          source: goalieSource,
        },
        away: {
          player_external_id: opts.awayGoalieExternalId,
          player_name: meta.away_goalie,
          source: goalieSource,
        },
      };

      const isLockingNow = shouldLock(g.game_date, now);
      const lockedAtIso = isLockingNow ? now.toISOString() : null;
      const lockSource = isLockingNow ? "locked" : "live";

      // Build one row per active market (ML + Total). Skip "pass".
      const marketsToWrite: Array<{
        market: TrackedMarketV17;
        modelMarket: NhlModelOutput["moneyline"];
        priceAmerican: number | null;
        lineValue: number | null;
      }> = [];

      if (model.moneyline.verdict !== "pass") {
        // Use the model's pick side's price from lines (best available).
        const pickSide = model.moneyline.pick.startsWith(homeAbbr) ? "home" : "away";
        const mlLines = lines.filter((l) => l.market_type === "moneyline" && l.side === pickSide);
        const bestPrice = mlLines.length > 0
          ? mlLines.map((l) => l.odds_american).filter((x): x is number => x !== null).reduce((max, p) => p > max ? p : max, -99999)
          : null;
        marketsToWrite.push({
          market: "moneyline",
          modelMarket: model.moneyline,
          priceAmerican: bestPrice === -99999 ? null : bestPrice,
          lineValue: null,
        });
      } else {
        recordsSkippedPass += 1;
      }
      if (model.total.verdict !== "pass") {
        const totalSide = model.total.pick.startsWith("OVER") ? "over" : "under";
        const totalLines = lines.filter((l) => l.market_type === "total" && l.side === totalSide);
        const bestPrice = totalLines.length > 0
          ? totalLines.map((l) => l.odds_american).filter((x): x is number => x !== null).reduce((max, p) => p > max ? p : max, -99999)
          : null;
        const lineValue = totalLines.find((l) => l.line_value !== null)?.line_value ?? null;
        marketsToWrite.push({
          market: "total",
          modelMarket: model.total,
          priceAmerican: bestPrice === -99999 ? null : bestPrice,
          lineValue,
        });
      } else {
        recordsSkippedPass += 1;
      }

      const snapshotJson = buildSnapshotJson({
        model,
        marketLines: lines,
        goalieAssumption,
        featureInputs: snapshot,
        lockedAtIso,
        lockSource,
      });

      for (const m of marketsToWrite) {
        const pickSide = m.market === "moneyline"
          ? (model.moneyline.pick.startsWith(homeAbbr) ? "home" : "away")
          : (model.total.pick.startsWith("OVER") ? "over" : "under");

        // Check if a locked row already exists — skip if so.
        const { data: existing } = await supabase
          .from("prediction_records")
          .select("id, locked_at")
          .eq("game_id", g.id)
          .eq("market", m.market)
          .eq("model_version", NHL_MODEL_VERSION_CONST)
          .eq("slate_date", g.slate_date)
          .maybeSingle();
        if (existing && (existing as { locked_at: string | null }).locked_at !== null) {
          recordsSkippedLocked += 1;
          log(`  ⏭ ${matchup} ${m.market}: locked row preserved`);
          continue;
        }

        const row: Omit<PredictionRecordRow, "id" | "created_at"> = {
          game_prediction_id: null, // v18: nullable for non-MLB
          game_id: g.id,
          external_id: g.external_id,
          sport: "nhl",
          slate_date: g.slate_date,
          game_date: g.game_date,
          matchup,
          market: m.market,
          pick: m.modelMarket.pick,
          side: pickSide,
          line_value: m.lineValue,
          odds_american: m.priceAmerican,
          odds_decimal: m.priceAmerican !== null
            ? (m.priceAmerican > 0 ? 1 + m.priceAmerican / 100 : 1 + 100 / Math.abs(m.priceAmerican))
            : null,
          model_used: "nhlAutoModelV0",
          model_version: NHL_MODEL_VERSION_CONST,
          prediction_source: "daily_edge_pipeline",
          confidence: m.modelMarket.confidence,
          model_probability: m.modelMarket.probability,
          market_probability: null,
          edge: null,
          expected_value: null,
          play_grade: gradeFromVerdict(m.modelMarket.verdict),
          prediction_type: m.market === "moneyline" ? "game_ml" : "game_total",
          best_angle: m.modelMarket.verdict === "best_angle",
          no_bet: m.modelMarket.verdict === "pass",
          no_bet_reason: m.modelMarket.verdict === "pass" ? "below_edge_threshold" : null,
          market_aligned: m.modelMarket.model_market_gap_pct !== null
            ? Math.abs(m.modelMarket.model_market_gap_pct) <= 0.05
            : false,
          data_quality_tier: model.inputs_summary.market_book_count >= 3 ? "two_sided_consensus" : "single_book",
          source_quality: "v0_calibration",
          provisional: true, // v0 calibration phase
          held: false,
          hold_reason: null,
          launch_day: false,
          manual_outcome_expected: false,
          locked_at: lockedAtIso,
          published_at: null,
          snapshot_json: snapshotJson,
        };

        if (!opts.apply) {
          log(`  [dry-run] ${matchup} ${m.market}/${pickSide}  pick=${m.modelMarket.pick}  prob=${m.modelMarket.probability.toFixed(3)}  verdict=${m.modelMarket.verdict}  price=${m.priceAmerican}  locked_at=${lockedAtIso ?? "null"}`);
          recordsCreated += 1;
          continue;
        }

        const { error: upErr } = await supabase
          .from("prediction_records")
          .upsert(row, { onConflict: "game_id,market,model_version,slate_date" });
        if (upErr) {
          const msg = `  ✗ upsert ${matchup} ${m.market}: ${upErr.message}`;
          log(msg);
          errors.push(msg);
        } else {
          log(`  ✓ ${matchup} ${m.market}/${pickSide}  pick=${m.modelMarket.pick}  locked_at=${lockedAtIso ?? "null"}`);
          recordsCreated += 1;
        }
      }
    } catch (e) {
      const msg = `  ✗ game ${g.id}: ${(e as Error).message}`;
      log(msg);
      errors.push(msg);
    }
  }

  return {
    mode: opts.apply ? "write" : "dry-run",
    gamesProcessed: games.length,
    recordsCreated,
    recordsSkippedLocked,
    recordsSkippedPass,
    errors,
  };
}
