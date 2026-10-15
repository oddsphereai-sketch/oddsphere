/** Read-only same-input NBA incumbent-versus-professional board comparison. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNbaAutoModelV2 } from "../../../lib/automodel/nba/nbaAutoModelV2";
import { buildNbaMarketConsensus } from "../../../lib/automodel/nba/nbaMarketConsensus";
import {
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import type { NbaGameSnapshot } from "../../../lib/automodel/nba/types";
import { supabase } from "../../../lib/db/supabase";
import { buildNbaDailyEdgeGameDto } from "../../../lib/services/nba/buildNbaDailyEdgeDto";
import { buildNbaFeatureSnapshotsWithProvenance } from "../../../lib/services/nba/featureSnapshot";
import { etSlateDateToUtcWindow } from "../../../lib/services/nba/etSlateDate";
import type { NbaLineRow } from "../../../lib/services/nba/nbaMarketIntelligence";
import {
  applyNbaProfessionalCandidate,
  buildNbaProfessionalCandidate,
} from "../../../lib/services/nba/nbaProfessionalCandidate";
import { refreshNbaLines } from "../../../lib/services/nba/refreshNbaLinesService";

const RELEASE = "nba_professional_current_board_audit_2026_10_15_r1";
const date = process.argv[2] ?? "2026-10-20";
const sharpApiKey = process.env.SHARPAPI_KEY;
if (!sharpApiKey) throw new Error("SHARPAPI_KEY is required.");

async function main(): Promise<void> {
const window = etSlateDateToUtcWindow(date);
const utcDates = [...new Set([window.startISO.slice(0, 10), window.endISO.slice(0, 10)])];
const parts = await Promise.all(utcDates.map((utcDate) => buildNbaFeatureSnapshotsWithProvenance(utcDate)));
const seen = new Set<number>();
const snapshots = parts.flatMap((part) => part.snapshots).filter((snapshot) => {
  if (seen.has(snapshot.game_external_id) || snapshot.game_time_iso === null) return false;
  const time = Date.parse(snapshot.game_time_iso);
  if (time < Date.parse(window.startISO) || time > Date.parse(window.endISO)) return false;
  seen.add(snapshot.game_external_id);
  return true;
});
const built = {
  snapshots,
  provenance: parts.flatMap((part) => part.provenance)
    .filter((row, index, rows) => seen.has(row.game_external_id) &&
      rows.findIndex((candidate) => candidate.game_external_id === row.game_external_id) === index),
};
const refresh = await refreshNbaLines({ slateDate: date, sharpApiKey: sharpApiKey!, dryRun: true });
const externalIds = built.snapshots.map((snapshot) => snapshot.game_external_id);
const { data: games, error: gameError } = await supabase
  .from("games")
  .select("id,external_id")
  .eq("sport", "nba")
  .in("external_id", externalIds);
if (gameError) throw new Error(gameError.message);
const externalByDbId = new Map((games ?? []).map((game) => [Number(game.id), Number(game.external_id)]));
const linesByExternal = new Map<number, NbaLineRow[]>();
const observedAt = new Date().toISOString();
for (const line of refresh.canonicalLines) {
  const externalId = externalByDbId.get(line.gameId);
  if (externalId === undefined) continue;
  const rows = linesByExternal.get(externalId) ?? [];
  rows.push({
    market_type: line.marketType,
    sportsbook: line.sportsbook,
    side: line.side,
    line_value: line.lineValue,
    odds_american: line.oddsAmerican,
    fetched_at: observedAt,
  });
  linesByExternal.set(externalId, rows);
}

const providerSeason = Number(date.slice(5, 7)) >= 10
  ? Number(date.slice(0, 4))
  : Number(date.slice(0, 4)) - 1;
const featureRows = buildNbaProfessionalRuntimeFeatures({
  upcomingGames: built.snapshots.map((snapshot) => ({
    gameId: snapshot.game_external_id,
    season: providerSeason,
    startTime: snapshot.game_time_iso!,
    homeTeam: snapshot.home_team.abbreviation,
    awayTeam: snapshot.away_team.abbreviation,
  })),
});
const provenance = new Map(built.provenance.map((row) => [row.game_external_id, row]));
const actionable = (grade: string) => grade === "best_angle" || grade === "lean";
const comparisons = built.snapshots.map((rawSnapshot) => {
  const lines = linesByExternal.get(rawSnapshot.game_external_id) ?? [];
  const consensus = buildNbaMarketConsensus(lines.map((line) => ({
    sportsbook: line.sportsbook,
    market_type: line.market_type as "moneyline" | "spread" | "total",
    side: line.side!,
    line_value: line.line_value,
    odds_american: line.odds_american,
  })));
  const snapshot: NbaGameSnapshot = {
    ...rawSnapshot,
    market: {
      ml: {
        home_odds_american: lines.find((line) => line.market_type === "moneyline" && line.side === "home")?.odds_american ?? null,
        away_odds_american: lines.find((line) => line.market_type === "moneyline" && line.side === "away")?.odds_american ?? null,
      },
      spread: {
        home_line: consensus.spreadHome,
        home_odds_american: lines.find((line) => line.market_type === "spread" && line.side === "home")?.odds_american ?? null,
        away_odds_american: lines.find((line) => line.market_type === "spread" && line.side === "away")?.odds_american ?? null,
      },
      total: {
        line: consensus.totalLine,
        over_odds_american: lines.find((line) => line.market_type === "total" && line.side === "over")?.odds_american ?? null,
        under_odds_american: lines.find((line) => line.market_type === "total" && line.side === "under")?.odds_american ?? null,
      },
    },
    data_quality: { ...rawSnapshot.data_quality, market_present: lines.length > 0 },
  };
  const baseline = runNbaAutoModelV2(snapshot, "t60_locked", {
    bookCount: new Set(lines.map((line) => line.sportsbook).filter(Boolean)).size,
  });
  const feature = featureRows.get(snapshot.game_external_id);
  const prov = provenance.get(snapshot.game_external_id);
  if (!feature || !prov) throw new Error(`Missing audit input for ${snapshot.game_external_id}.`);
  const candidate = buildNbaProfessionalCandidate({
    artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
    featureRow: selectNbaProfessionalPortableFeatures(feature),
    lines,
    history: [],
    externalGameId: snapshot.game_external_id,
  });
  const professional = applyNbaProfessionalCandidate({ baseline, candidate });
  const incumbentDto = buildNbaDailyEdgeGameDto({
    snapshot,
    prediction: baseline,
    provenance: prov,
    lines,
    splitsRow: null,
    opportunities: [],
  });
  const professionalDto = buildNbaDailyEdgeGameDto({
    snapshot,
    prediction: professional,
    provenance: prov,
    lines,
    splitsRow: null,
    opportunities: [],
  });
  return {
    gameExternalId: snapshot.game_external_id,
    matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
    books: new Set(lines.map((line) => line.sportsbook)).size,
    incumbentScore: [baseline.predicted_away_score, baseline.predicted_home_score],
    professionalIndependentScore: [candidate.independent.awayScore, candidate.independent.homeScore],
    professionalFinalScore: [candidate.final.awayScore, candidate.final.homeScore],
    market: { spreadHome: consensus.spreadHome, total: consensus.totalLine },
    markets: (["ml", "spread", "total"] as const).map((market) => {
      const incumbent = incumbentDto.intelligence[market];
      const proposed = professionalDto.intelligence[market];
      return {
        market,
        incumbent: { pick: incumbent.pick_side, grade: incumbent.grade, probability: incumbent.model_prob_on_pick },
        professional: { pick: proposed.pick_side, grade: proposed.grade, probability: proposed.model_prob_on_pick },
        promotion: !actionable(incumbent.grade) && actionable(proposed.grade),
        demotion: actionable(incumbent.grade) && !actionable(proposed.grade),
      };
    }),
  };
});
const markets = comparisons.flatMap((game) => game.markets);
const report = {
  release: RELEASE,
  generatedAt: new Date().toISOString(),
  slateDate: date,
  apply: false,
  productionChanged: false,
  modelRelease: NBA_PROFESSIONAL_MODEL_ARTIFACT.release,
  provider: {
    games: refresh.gamesInDb,
    oddsRowsFetched: refresh.oddsRowsFetched,
    canonicalLines: refresh.canonicalLines.length,
  },
  boardImpact: {
    games: comparisons.length,
    markets: markets.length,
    incumbentActionable: markets.filter((row) => actionable(row.incumbent.grade)).length,
    professionalActionable: markets.filter((row) => actionable(row.professional.grade)).length,
    promotions: markets.filter((row) => row.promotion).length,
    demotions: markets.filter((row) => row.demotion).length,
    pickChanges: markets.filter((row) => row.incumbent.pick !== row.professional.pick).length,
  },
  limitations: [
    "Opening-night board has no prospective same-book movement history yet; the validated movement residual is inactive.",
    "Public splits are intentionally excluded from score and grade changes until source-qualified NBA validation exists.",
    "This is a read-only current-price rehearsal, not an outcome-accuracy estimate.",
  ],
  comparisons,
};
const output = path.resolve(`nba-research/reports/nba_professional_r43_current_board/${date}.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, ...report.boardImpact, provider: report.provider }, null, 2));
}

void main();
