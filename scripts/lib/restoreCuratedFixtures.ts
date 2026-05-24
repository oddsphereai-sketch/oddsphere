/**
 * restoreCuratedFixtures — bring the curated prop_predictions tonight fixture
 * back after a cron test suite has wiped + regenerated props for the slate.
 *
 * Background — the 5C footgun
 *   predictionService.generatePropPredictions DELETEs prop_predictions for
 *   the slate's games and INSERTs fresh model-output rows. The seed's
 *   tonight_props.json fixture (~39 hand-curated rows targeting Daniel's
 *   PREMIUM/STRONG/GOOD/SKIP distribution) gets replaced by whatever the
 *   prop model emits at test time — usually a non-curated distribution
 *   heavy on tier=skip.
 *
 * The 5F.3 fix
 *   Each cron test calls `restoreCuratedFixtures()` in its cleanup pass.
 *   Same logic the seed runs, scoped to today's slate only. Idempotent.
 *
 * Why not just re-run `npm run seed`
 *   Seed wipes + re-inserts every table (8s round-trip, even longer with
 *   network latency). Per-test restore touches only prop_predictions for
 *   one slate and one game-id set — sub-second on warm DB.
 */

import { supabase } from "../../lib/db/supabase";
import { computeSlateDate } from "../../lib/dates/slateDate";
import * as signalDerivationService from "../../lib/services/signalDerivationService";
import tonightPropsJson from "../../lib/providers/mock/fixtures/tonight_props.json";
import type { Sport } from "../../lib/types/domain/Sport";

type TonightPropRow = {
  game_external_id: number;
  player_external_id: number;
  prop_market: string;
  prop_line: number;
  model_probability: number;
  fair_probability: number;
  edge_pct: number;
  confidence_score: number;
  tier: "premium" | "strong" | "good" | "skip";
  best_sportsbook: string;
  best_odds_american: number;
  reasoning: string;
};

/**
 * Restore tonight_props.json onto the games it targets. Caller passes the
 * slate_date so the restore is scoped — usually a test calls this right
 * before tearing down, with the same date it ran the cron against.
 *
 * Returns counts for the caller's diagnostics. Throws on DB errors.
 */
export async function restoreCuratedFixtures(
  sport: Sport,
  slate_date?: string
): Promise<{
  restored: number;
  skipped: number;
  signals_updated: number;
}> {
  const fixture = tonightPropsJson as TonightPropRow[];
  // The fixture's game_external_ids correspond to a specific slate. Derive it
  // from the first game we can resolve — keeps the helper sport-flexible if
  // we add curated fixtures for other sports later.
  const fixtureGameIds = Array.from(new Set(fixture.map((r) => r.game_external_id)));
  const { data: gameRows, error: gameErr } = await supabase
    .from("games")
    .select("id, external_id, slate_date")
    .eq("sport", sport)
    .in("external_id", fixtureGameIds);
  if (gameErr) {
    throw new Error(`restoreCuratedFixtures games lookup failed: ${gameErr.message}`);
  }
  type GameRow = { id: number; external_id: number; slate_date: string };
  const games = ((gameRows ?? []) as GameRow[]);
  if (games.length === 0) {
    return { restored: 0, skipped: fixture.length, signals_updated: 0 };
  }
  const gameIdByExternal = new Map<number, number>(games.map((g) => [g.external_id, g.id]));
  const resolvedSlateDate = slate_date ?? games[0]!.slate_date;

  // Game IDs to clear props for. We blow away props on EVERY game on the
  // resolved slate, not just the 7 referenced by the fixture. Otherwise cron
  // tests that generated props for the 5 "other" early-evening games (which
  // share the slate_date) leave non-curated rows behind that pollute the
  // tier distribution in QA. Restoring the curated fixture means the slate
  // looks like it does right after `npm run seed` — those 5 games have no
  // props (no curated data for them yet).
  const { data: slateGames, error: slateGamesErr } = await supabase
    .from("games")
    .select("id")
    .eq("sport", sport)
    .eq("slate_date", resolvedSlateDate);
  if (slateGamesErr) {
    throw new Error(`restoreCuratedFixtures slate-games lookup failed: ${slateGamesErr.message}`);
  }
  const gameDbIds = ((slateGames ?? []) as Array<{ id: number }>).map((g) => g.id);

  // Players — resolve external_id → db id (fixture uses external_id refs).
  const fixturePlayerExts = Array.from(new Set(fixture.map((r) => r.player_external_id)));
  const { data: playerRows, error: playerErr } = await supabase
    .from("players")
    .select("id, external_id")
    .eq("sport", sport)
    .in("external_id", fixturePlayerExts);
  if (playerErr) {
    throw new Error(`restoreCuratedFixtures players lookup failed: ${playerErr.message}`);
  }
  const playerIdByExternal = new Map<number, number>(
    ((playerRows ?? []) as Array<{ id: number; external_id: number }>).map((p) => [p.external_id, p.id])
  );

  // Clear non-curated rows. Mirror the seed: blow away prop_predictions for
  // the fixture's games + clear any referencing prediction_results so the
  // FK constraint doesn't trip the delete.
  const { data: existingPropIds } = await supabase
    .from("prop_predictions")
    .select("id")
    .in("game_id", gameDbIds);
  const propIdList = ((existingPropIds ?? []) as Array<{ id: number }>).map((r) => r.id);
  if (propIdList.length > 0) {
    await supabase.from("prediction_results").delete().in("prop_prediction_id", propIdList);
  }
  await supabase.from("prop_predictions").delete().in("game_id", gameDbIds);

  // Re-insert the curated rows. Same logic as scripts/seed.ts seedTonightPropPredictions.
  const computedAt = `${resolvedSlateDate}T13:00:00.000Z`;
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of fixture) {
    const gameId = gameIdByExternal.get(r.game_external_id);
    const playerId = playerIdByExternal.get(r.player_external_id);
    if (gameId === undefined || playerId === undefined) {
      skipped++;
      continue;
    }
    rows.push({
      game_id: gameId,
      player_id: playerId,
      prop_market: r.prop_market,
      prop_line: r.prop_line,
      model_probability: r.model_probability,
      fair_probability: r.fair_probability,
      edge_pct: r.edge_pct,
      confidence_score: r.confidence_score,
      confidence_stars: Math.max(1, Math.min(5, Math.round(r.confidence_score / 20))),
      tier: r.tier,
      best_sportsbook: r.best_sportsbook,
      best_odds_american: r.best_odds_american,
      ev_pct: r.edge_pct,
      reasoning: r.reasoning,
      caveat: null,
      bet_odds_american: r.best_odds_american,
      closing_odds_american: null,
      clv_pct: null,
      beat_closing_line: null,
      model_version: "daniels-v3.2",
      computed_at: computedAt,
    });
  }
  if (rows.length === 0) {
    return { restored: 0, skipped, signals_updated: 0 };
  }
  const { error: insErr } = await supabase.from("prop_predictions").insert(rows);
  if (insErr) {
    throw new Error(`restoreCuratedFixtures insert failed: ${insErr.message}`);
  }

  // Re-derive signals for the restored props so the chip filter keeps working.
  const sigResult = await signalDerivationService.updateSignalsForSlate(sport, resolvedSlateDate);

  // Silence unused-import warning for computeSlateDate — kept here so a
  // future caller that wants to pass a UTC-instant override can compute the
  // slate the same way the seed does.
  void computeSlateDate;

  return {
    restored: rows.length,
    skipped,
    signals_updated: sigResult.updated,
  };
}
