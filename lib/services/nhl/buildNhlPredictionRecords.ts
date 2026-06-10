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
import {
  CONTEXT_SNAPSHOT_NOTE,
  type NhlPuckLineDisplayedContext,
} from "../../types/domain/DisplayedContextMarket";

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
 * P1-2 Commit A — build the displayed_context_markets.spread substrate
 * for NHL (puck-line). The PL* chip on the slate card is rendered from
 * `model.puck_line`; this substrate captures what was shown so the
 * auditor can verify display-vs-snapshot truth without polluting
 * public tracking. See lib/types/domain/DisplayedContextMarket.ts.
 */
function buildNhlPuckLineDisplayedContext(opts: {
  model: NhlModelOutput;
  spreadLines: Array<{
    market_type: string;
    sportsbook: string;
    side: string;
    line_value: number | null;
    odds_american: number | null;
  }>;
  homeAbbr: string;
  capturedAt: string;
}): NhlPuckLineDisplayedContext {
  const pl = opts.model.puck_line;
  const pickIsPass = pl.verdict === "pass";
  // pl.pick like "VGK +1.5" — first token is team abbr
  const pickTeam = pl.pick.split(" ")[0] ?? "";
  const pickIsHome = pickTeam === opts.homeAbbr;
  const side: NhlPuckLineDisplayedContext["side"] = pickIsPass
    ? null
    : pickIsHome
      ? "home"
      : "away";
  const pickSideForLineLookup = pickIsHome ? "home" : "away";

  // Extract the expected puck-line value from the pick label so we match
  // the right side of the puck-line. Without this, `home +1.5` and
  // `home -1.5` (which can both appear when sportsbooks list either
  // direction on the home side) would be conflated.
  const pickLineMatch = pl.pick.match(/[+-]?\d+(?:\.\d+)?/);
  const expectedLine = pickLineMatch !== null ? parseFloat(pickLineMatch[0]) : null;

  // Get the best price for the picked side + expected line on spread market.
  const sideLines = opts.spreadLines.filter((l) => {
    if (l.side !== pickSideForLineLookup) return false;
    if (expectedLine === null) return true;
    if (l.line_value === null) return false;
    return Math.abs(l.line_value - expectedLine) < 0.05;
  });
  const bestOdds = sideLines.length > 0
    ? sideLines
        .map((l) => l.odds_american)
        .filter((x): x is number => x !== null)
        .reduce((max, p) => (p > max ? p : max), -Infinity)
    : null;
  const lineValue =
    sideLines.find((l) => l.line_value !== null)?.line_value ?? expectedLine;
  const sportsbook =
    sideLines.find((l) => l.odds_american === bestOdds && bestOdds !== null)
      ?.sportsbook ?? null;

  const lineSourceQuality: NhlPuckLineDisplayedContext["source_evidence"]["line_source_quality"] =
    bestOdds !== null && bestOdds !== -Infinity
      ? "real_book"
      : opts.spreadLines.length > 0
        ? "consensus_fallback"
        : "unavailable";

  const verdict: NhlPuckLineDisplayedContext["verdict"] = pickIsPass
    ? "no_play"
    : (pl.verdict as NhlPuckLineDisplayedContext["verdict"]);

  return {
    market: "spread",
    display_label: "PL*",
    official_tracked: false,
    context_only: true,
    displayed_at_lock: !pickIsPass,
    pick: pickIsPass ? null : pl.pick,
    side,
    line: lineValue,
    odds_american: bestOdds !== null && bestOdds !== -Infinity ? bestOdds : null,
    sportsbook,
    verdict,
    confidence_displayed: pickIsPass ? null : pl.confidence * 100,
    edge_pct: pl.model_market_gap_pct !== null ? pl.model_market_gap_pct * 100 : null,
    rationale_one_liner: pl.notes[0] ?? null,
    source_evidence: {
      line_source_quality: lineSourceQuality,
      lines_observed_count: opts.spreadLines.length,
      open_to_current_movement: null,
    },
    model_projection: {
      predicted_goal_diff_home: opts.model.expected_goal_diff,
      predicted_total_goals: opts.model.expected_total_goals,
    },
    snapshot_note: CONTEXT_SNAPSHOT_NOTE,
    captured_at: opts.capturedAt,
  };
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
  // P1-2 Commit A — needed to build the PL* substrate.
  homeAbbr: string;
  capturedAt: string;
}): Record<string, unknown> {
  const spreadLines = opts.marketLines.filter((l) => l.market_type === "spread");
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
    // P1-2 Commit A — internal-only substrate for the displayed
    // context-only `PL*` chip. Same block written on ML + Total rows
    // for join robustness. Does NOT create a public tracking row for
    // puck-line; see lib/types/domain/DisplayedContextMarket.ts.
    displayed_context_markets: {
      spread: buildNhlPuckLineDisplayedContext({
        model: opts.model,
        spreadLines,
        homeAbbr: opts.homeAbbr,
        capturedAt: opts.capturedAt,
      }),
    },
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

      // Fetch lines snapshot for the snapshot_json. P1-2 Commit A —
      // additionally fetch "spread" lines (NHL puck-line is stored as
      // market_type="spread" in `lines`). These don't generate a
      // public tracking row — they only populate the internal
      // displayed_context_markets.spread substrate so the auditor
      // can verify what the PL* chip showed at lock.
      const { data: linesData } = await supabase
        .from("lines")
        .select("market_type, sportsbook, side, line_value, odds_american")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total", "spread"]);
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

      // Phase 7L Step 7 — persist every market including Pass/No-Play
      // so backend calibration can later answer "would the Pass picks
      // have hit?" Without this, NHL Pass markets are invisible to
      // post-hoc calibration analysis. Pass rows still set no_bet=true
      // + no_bet_reason="below_edge_threshold" so they're auditable
      // distinct from active picks.
      {
        // Moneyline — always write a row. For Pass, pick side defaults
        // to the model's nominal lean (home if expected_goal_diff >= 0)
        // even though no_bet=true, so the row still has a directional
        // record for retrospective analysis.
        const mlIsPass = model.moneyline.verdict === "pass";
        const pickIsHome = mlIsPass
          ? model.expected_goal_diff >= 0
          : model.moneyline.pick.startsWith(homeAbbr);
        const pickSide = pickIsHome ? "home" : "away";
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
        if (mlIsPass) recordsSkippedPass += 1; // counter still tracks pass frequency
      }
      {
        // Total — same persist-on-pass policy. For Pass, default the
        // side to over if model_total > market_line, else under.
        const totalIsPass = model.total.verdict === "pass";
        const totalLineCandidates = lines.filter((l) => l.market_type === "total");
        const marketLine = totalLineCandidates.find((l) => l.line_value !== null)?.line_value ?? null;
        const pickIsOver = totalIsPass
          ? marketLine === null || model.expected_total_goals > marketLine
          : model.total.pick.startsWith("OVER");
        const totalSide = pickIsOver ? "over" : "under";
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
        if (totalIsPass) recordsSkippedPass += 1;
      }

      const snapshotJson = buildSnapshotJson({
        model,
        marketLines: lines,
        goalieAssumption,
        featureInputs: snapshot,
        lockedAtIso,
        lockSource,
        homeAbbr,
        capturedAt: now.toISOString(),
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
