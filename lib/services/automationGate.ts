/**
 * Phase 4.2.C.1.R-17 Step 1 — Automation gate.
 *
 * Extends `marketCoverageGate` with additional checks the orchestrator
 * needs to decide per-game / per-market hold-vs-play:
 *
 *   • Starter coverage (per-game: are both home + away pitcher_id set?)
 *   • Provider date alignment result (passed in from the preflight)
 *   • FI odds coverage (best-effort report — does NOT hard-block)
 *
 * Returns:
 *   • aggregate counts
 *   • per-game decisions: { ml, ou, nrfi } each = "play" | "hold" with reason
 *   • overall cycle status: ok | degraded | fail_closed
 *
 * Pure read-only. Never writes anything.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";
import { loadGameIdMap } from "./_idMaps";
import {
  assessMarketCoverage,
  type MarketCoverageReport,
} from "./marketCoverageGate";
import type {
  ProviderDateAlignmentReport,
  ProviderDateAlignmentStatus,
} from "./providerDateAlignment";

export type GateDecision = "play" | "hold";

export type PerMarketDecision = {
  decision: GateDecision;
  reason: string | null;
};

export type PerGameGateRow = {
  game_id: number;
  external_id: number;
  tag: string;
  starter_home_set: boolean;
  starter_away_set: boolean;
  ml_lines: number;
  total_lines: number;
  spread_lines: number;
  fi_lines: number;
  ml: PerMarketDecision;
  ou: PerMarketDecision;
  nrfi: PerMarketDecision;
};

export type AutomationGateAggregate = {
  total_games: number;
  games_with_complete_starters: number;
  games_with_ml_lines: number;
  games_with_total_lines: number;
  games_with_spread_lines: number;
  games_with_fi_lines: number;
  games_with_sharp_signals: number;
  stale_line_games: number;
  ml_hold_count: number;
  ou_hold_count: number;
  nrfi_hold_count: number;
};

export type AutomationGateStatus =
  | "ok"
  | "degraded"
  | "fail_closed";

export type AutomationGateReport = {
  sport: Sport;
  date: string;
  assessed_at: string;
  provider_alignment: ProviderDateAlignmentReport | null;
  market_coverage: MarketCoverageReport;
  per_game: PerGameGateRow[];
  aggregate: AutomationGateAggregate;
  overall: AutomationGateStatus;
  reasons: string[];
};

export type AutomationGateOpts = {
  /** Forwarded to marketCoverageGate. Default 60. */
  staleThresholdMinutes?: number;
  /**
   * Provider date alignment result from the preflight. Required —
   * the orchestrator passes it through after running the preflight.
   * `null` is treated as "alignment not checked yet" — gate emits a
   * warn-level reason instead of fail_closed.
   */
  providerAlignment: ProviderDateAlignmentReport | null;
};

export async function assessAutomationGate(
  sport: Sport,
  date: string,
  opts: AutomationGateOpts
): Promise<AutomationGateReport> {
  const assessedAt = new Date().toISOString();
  const staleMinutes = opts.staleThresholdMinutes ?? 60;

  // Read slate games + starter assignment in one query.
  const gameIdByExternal = await loadGameIdMap(sport, date);
  const gameIds = [...gameIdByExternal.values()];
  const { data: gameRows, error: gerr } = await supabase
    .from("games")
    .select(
      `id, external_id, home_pitcher_id, away_pitcher_id,
       home_team:teams!games_home_team_id_fkey(abbreviation),
       away_team:teams!games_away_team_id_fkey(abbreviation)`
    )
    .in("id", gameIds);
  if (gerr) {
    throw new Error(`assessAutomationGate games read failed: ${gerr.message}`);
  }
  // Supabase returns nested team relations as arrays (length 1 since
  // these are 1:1 FK joins). Normalize at read.
  type GameRow = {
    id: number;
    external_id: number;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
    home_team: { abbreviation: string } | null;
    away_team: { abbreviation: string } | null;
  };
  const gById = new Map<number, GameRow>();
  for (const raw of (gameRows ?? []) as unknown as Array<{
    id: number;
    external_id: number;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
    home_team: Array<{ abbreviation: string }> | { abbreviation: string } | null;
    away_team: Array<{ abbreviation: string }> | { abbreviation: string } | null;
  }>) {
    const homeTeam = Array.isArray(raw.home_team) ? raw.home_team[0] ?? null : raw.home_team;
    const awayTeam = Array.isArray(raw.away_team) ? raw.away_team[0] ?? null : raw.away_team;
    gById.set(raw.id, {
      id: raw.id,
      external_id: raw.external_id,
      home_pitcher_id: raw.home_pitcher_id,
      away_pitcher_id: raw.away_pitcher_id,
      home_team: homeTeam,
      away_team: awayTeam,
    });
  }

  // Reuse the existing market coverage gate for lines/sharp_signals.
  const coverage = await assessMarketCoverage(sport, date, {
    staleThresholdMinutes: staleMinutes,
  });

  // FI-specific line counts — marketCoverageGate doesn't track FI today.
  const { data: fiLines } = await supabase
    .from("lines")
    .select("game_id")
    .in("game_id", gameIds)
    .is("player_id", null)
    .eq("market_type", "first_inning_total");
  const fiCountByGame = new Map<number, number>();
  for (const r of (fiLines ?? []) as Array<{ game_id: number }>) {
    fiCountByGame.set(r.game_id, (fiCountByGame.get(r.game_id) ?? 0) + 1);
  }

  // Provider alignment translates to a top-level fail_closed reason if
  // it failed — but the per-game decisions still get computed (operator
  // sees what would happen *if* alignment were OK).
  const providerAlignment = opts.providerAlignment;
  const providerStatus: ProviderDateAlignmentStatus = providerAlignment
    ? providerAlignment.status
    : "warn";

  // Compose per-game decisions.
  const perGame: PerGameGateRow[] = [];
  let gamesWithCompleteStarters = 0;
  let gamesWithMlLines = 0,
    gamesWithTotalLines = 0,
    gamesWithSpreadLines = 0,
    gamesWithFiLines = 0,
    gamesWithSharp = 0;
  let staleLineGames = 0;
  let mlHolds = 0,
    ouHolds = 0,
    nrfiHolds = 0;

  for (const gameId of gameIds) {
    const ext = gameIdByExternal.has(gameId)
      ? -1
      : -1; // resolved below
    const game = gById.get(gameId);
    if (!game) continue;
    const tag = `${game.away_team?.abbreviation ?? "?"}@${game.home_team?.abbreviation ?? "?"}`;
    const externalId = game.external_id;
    const starterHomeSet = game.home_pitcher_id !== null;
    const starterAwaySet = game.away_pitcher_id !== null;
    const startersComplete = starterHomeSet && starterAwaySet;

    const cov = coverage.per_game.find((p) => p.game_id === gameId);
    const mlLines = cov?.ml_lines ?? 0;
    const totalLines = cov?.total_lines ?? 0;
    const spreadLines = cov?.spread_lines ?? 0;
    const fiLineCount = fiCountByGame.get(gameId) ?? 0;
    const hasSharp = (cov?.has_signals ?? false) === true;
    const isStale = cov?.suggested_decision === "stale";

    if (startersComplete) gamesWithCompleteStarters++;
    if (mlLines > 0) gamesWithMlLines++;
    if (totalLines > 0) gamesWithTotalLines++;
    if (spreadLines > 0) gamesWithSpreadLines++;
    if (fiLineCount > 0) gamesWithFiLines++;
    if (hasSharp) gamesWithSharp++;
    if (isStale) staleLineGames++;

    // Per-market decisions
    let ml: PerMarketDecision = { decision: "play", reason: null };
    let ou: PerMarketDecision = { decision: "play", reason: null };
    let nrfi: PerMarketDecision = { decision: "play", reason: null };

    // Starter gate — if either side missing, hold all three picks
    if (!startersComplete) {
      const missing: string[] = [];
      if (!starterHomeSet) missing.push("home");
      if (!starterAwaySet) missing.push("away");
      const reason = `Missing starter (${missing.join(" + ")})`;
      ml = { decision: "hold", reason };
      ou = { decision: "hold", reason };
      nrfi = { decision: "hold", reason };
    } else {
      // Per-market line coverage gates
      if (mlLines === 0) {
        ml = { decision: "hold", reason: "No ML lines available" };
      }
      if (totalLines === 0) {
        ou = { decision: "hold", reason: "No total lines available" };
      }
      // FI gate — best effort. If no FI lines AND no expected_runs context
      // is available the model would already toss-up-hold via 5-zone logic.
      // The gate marks "hold" only as informational — actual hold also
      // comes from the model's toss-up logic.
      if (fiLineCount === 0) {
        nrfi = {
          decision: "hold",
          reason: "No FI odds available (best-effort; toss-up rules also apply)",
        };
      }
    }

    // Provider alignment fail propagates as additional hold reasons, but
    // doesn't double-hold a market that's already held for another reason.
    if (providerAlignment && providerAlignment.status === "fail_closed") {
      // R-17 Step 2B — drop the "matched/slate_size" form for the reason
      // string; under EV-based discovery `matched` can exceed `slate_size`
      // (which is a fallback constant when the DB is empty), so the ratio
      // form is misleading. Show kept + wrong-date counts directly.
      const provReason = `Provider rolled forward (${providerAlignment.matched} on date, ${providerAlignment.wrong_date} on wrong date)`;
      if (ml.decision === "play") ml = { decision: "hold", reason: provReason };
      if (ou.decision === "play") ou = { decision: "hold", reason: provReason };
      if (nrfi.decision === "play") nrfi = { decision: "hold", reason: provReason };
    }

    if (ml.decision === "hold") mlHolds++;
    if (ou.decision === "hold") ouHolds++;
    if (nrfi.decision === "hold") nrfiHolds++;

    perGame.push({
      game_id: gameId,
      external_id: externalId,
      tag,
      starter_home_set: starterHomeSet,
      starter_away_set: starterAwaySet,
      ml_lines: mlLines,
      total_lines: totalLines,
      spread_lines: spreadLines,
      fi_lines: fiLineCount,
      ml,
      ou,
      nrfi,
    });
  }
  void providerStatus;

  // Compose overall status
  const reasons: string[] = [];
  let overall: AutomationGateStatus = "ok";
  if (providerAlignment) {
    if (providerAlignment.status === "fail_closed") {
      overall = "fail_closed";
      reasons.push(providerAlignment.reason);
    } else if (providerAlignment.status === "warn") {
      overall = "degraded";
      reasons.push(providerAlignment.reason);
    } else {
      // R-17 Step 2B — drop the "matched/slate_size" form (see provReason
      // comment above). Show kept count + threshold + slate-size basis.
      reasons.push(
        `provider date alignment: ${providerAlignment.status} (${providerAlignment.matched} EV event(s) on date; threshold ${providerAlignment.threshold}, slate-size basis ${providerAlignment.slate_size})`
      );
    }
  } else {
    overall = overall === "ok" ? "degraded" : overall;
    reasons.push("provider date alignment: not checked");
  }
  if (gamesWithCompleteStarters < gameIds.length) {
    if (overall !== "fail_closed") overall = "degraded";
    reasons.push(
      `starter coverage ${gamesWithCompleteStarters}/${gameIds.length} (missing in ${gameIds.length - gamesWithCompleteStarters} game(s))`
    );
  }
  if (gamesWithMlLines < gameIds.length) {
    if (overall !== "fail_closed") overall = "degraded";
    reasons.push(`ML lines coverage ${gamesWithMlLines}/${gameIds.length}`);
  }
  if (gamesWithTotalLines < gameIds.length) {
    if (overall !== "fail_closed") overall = "degraded";
    reasons.push(`Total lines coverage ${gamesWithTotalLines}/${gameIds.length}`);
  }
  if (gamesWithFiLines < gameIds.length) {
    // FI is best-effort — does NOT escalate overall status by itself.
    reasons.push(
      `FI odds coverage ${gamesWithFiLines}/${gameIds.length} (best-effort; not blocking)`
    );
  }
  if (staleLineGames > 0) {
    reasons.push(`${staleLineGames} game(s) have stale lines (> ${staleMinutes} min)`);
  }
  if (reasons.length === 0) reasons.push("all checks passed");

  return {
    sport,
    date,
    assessed_at: assessedAt,
    provider_alignment: providerAlignment,
    market_coverage: coverage,
    per_game: perGame,
    aggregate: {
      total_games: gameIds.length,
      games_with_complete_starters: gamesWithCompleteStarters,
      games_with_ml_lines: gamesWithMlLines,
      games_with_total_lines: gamesWithTotalLines,
      games_with_spread_lines: gamesWithSpreadLines,
      games_with_fi_lines: gamesWithFiLines,
      games_with_sharp_signals: gamesWithSharp,
      stale_line_games: staleLineGames,
      ml_hold_count: mlHolds,
      ou_hold_count: ouHolds,
      nrfi_hold_count: nrfiHolds,
    },
    overall,
    reasons,
  };
}
