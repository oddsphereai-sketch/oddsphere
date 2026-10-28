import { createClient } from "@supabase/supabase-js";
import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "../../app/lab/lib/labTypes";
import { buildEplDailyEdgePreview } from "../../lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "../../lib/services/epl/buildEplShadowSlate";
import { readEplStoredPriceHistory } from "../../lib/services/epl/eplLineHistoryStore";

const SNAPSHOT_KEY = "soccer::english_premier_league::current-week";
// Soccer DTO aliases: moneyline = Match Result, total = Total,
// first_inning = BTTS. Double Chance remains a nested soccer-only surface.
const markets = ["moneyline", "total", "first_inning"] as const;

function actionable(market: MarketEdgeDto) {
  return market.verdict.key === "best_angle" || market.verdict.key === "lean";
}

function selectedSide(market: MarketEdgeDto) {
  return market.soccerPriceBoard?.rows.find((row) => row.selected)?.side ?? market.pick ?? null;
}

function summary(games: DailyEdgeGameDto[]) {
  const rows = games.flatMap((game) => markets.flatMap((key) => game.markets[key] ? [{ game, key, market: game.markets[key] }] : []));
  return {
    games: games.length,
    markets: rows.length,
    grades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((label) => [label, rows.filter((row) => row.market.verdict.label === label).length])),
    actionables: rows.filter((row) => actionable(row.market)).length,
    mix: Object.fromEntries(markets.map((key) => [key, rows.filter((row) => row.key === key && actionable(row.market)).length])),
  };
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("lab_response_snapshots").select("payload,payload_version,updated_at").eq("snapshot_key", SNAPSHOT_KEY).single();
  if (error) throw error;
  const incumbent = data.payload as DailyEdgeResponse;
  const slate = await buildEplShadowSlate();
  const storedPriceHistory = await readEplStoredPriceHistory(slate.matches.map((match) => match.id));
  const candidate = await buildEplDailyEdgePreview(slate, { storedPriceHistory, skipForwardEvidence: true, cacheNamespace: "epl-r20-audit", cacheIdentity: `r20-${Date.now()}` });
  const incumbentById = new Map(incumbent.games.map((game) => [String(game.external_id), game]));
  const now = Date.now();
  const comparisons = candidate.games.flatMap((game) => {
    const prior = incumbentById.get(String(game.external_id));
    if (!prior) return [];
    const unlocked = Date.parse(game.gameStartAt ?? "") - now > 60 * 60_000;
    return markets.flatMap((key) => {
      const before = prior.markets[key];
      const after = game.markets[key];
      if (!before || !after) return [];
      return [{
        matchup: `${game.awayTeam}@${game.homeTeam}`,
        kickoff: game.gameStartAt,
        unlocked,
        market: key,
        beforeSide: selectedSide(before),
        afterSide: selectedSide(after),
        beforeGrade: before.verdict.label,
        afterGrade: after.verdict.label,
        beforeProbability: before.modelProb,
        afterProbability: after.modelProb,
        beforePrice: before.currentPriceAmerican,
        afterPrice: after.currentPriceAmerican,
      }];
    });
  });
  const unlocked = comparisons.filter((row) => row.unlocked);
  console.log(JSON.stringify({
    mode: "read_only_zero_write",
    incumbent: { payloadVersion: data.payload_version, updatedAt: data.updated_at, ...summary(incumbent.games) },
    candidate: { release: slate.modelRelease, calibrationRelease: slate.calibrationRelease, ...summary(candidate.games) },
    unlockedImpact: {
      rows: unlocked.length,
      sideChanges: unlocked.filter((row) => row.beforeSide !== row.afterSide),
      promotions: unlocked.filter((row) => !["Best Angle", "Lean"].includes(row.beforeGrade) && ["Best Angle", "Lean"].includes(row.afterGrade)),
      demotions: unlocked.filter((row) => ["Best Angle", "Lean"].includes(row.beforeGrade) && !["Best Angle", "Lean"].includes(row.afterGrade)),
    },
    scoreChanges: candidate.games.flatMap((game) => {
      const prior = incumbentById.get(String(game.external_id));
      if (!prior?.soccerProjection || !game.soccerProjection) return [];
      return [{
        matchup: `${game.awayTeam}@${game.homeTeam}`,
        kickoff: game.gameStartAt,
        before: prior.soccerProjection.expectedGoals,
        after: game.soccerProjection.expectedGoals,
      }];
    }),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
