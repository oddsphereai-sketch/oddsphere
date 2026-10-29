/** Read-only same-input NBA incumbent-versus-professional board comparison. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNbaAutoModelV2 } from "../../../lib/automodel/nba/nbaAutoModelV2";
import { buildNbaMarketConsensus } from "../../../lib/automodel/nba/nbaMarketConsensus";
import { computeNbaMarketProbabilities } from "../../../lib/automodel/nba/nbaDistribution";
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

const RELEASE = "nba_professional_current_board_audit_2026_10_16_r2_independent_first";
const date = process.argv[2] ?? "2026-10-20";
const owlsApiKey = process.env.OWLS_INSIGHT_API_KEY;
if (!owlsApiKey) throw new Error("OWLS_INSIGHT_API_KEY is required.");
const ballDontLieApiKey = process.env.BALLDONTLIE_API_KEY;
if (!ballDontLieApiKey) throw new Error("BALLDONTLIE_API_KEY is required.");

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
const refresh = await refreshNbaLines({
  slateDate: date,
  owlsApiKey: owlsApiKey!,
  ballDontLieApiKey,
  dryRun: true,
});
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
const compactDecision = (value: ReturnType<typeof buildNbaDailyEdgeGameDto>["intelligence"]["ml"]) => {
  const price = value.current_price.odds_american;
  const probability = value.model_prob_on_pick;
  const profit = price === null ? null : price > 0 ? price / 100 : 100 / -price;
  return {
    pick: value.pick_side,
    grade: value.grade,
    probability,
    selectedPrice: price,
    expectedReturn: probability === null || profit === null
      ? null
      : probability * profit - (1 - probability),
    edgeProbabilityPp: value.edge_prob_pp,
    edgePoints: value.edge_points,
  };
};
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
  const r2Margin = candidate.consensus.spreadHome === null
    ? candidate.independent.marginHome
    : 0.25 * candidate.independent.marginHome + 0.75 * -candidate.consensus.spreadHome;
  const r2Total = candidate.consensus.totalLine === null
    ? candidate.independent.total
    : 0.25 * candidate.independent.total + 0.75 * candidate.consensus.totalLine;
  const r2Final = {
    ...candidate.final,
    homeScore: (r2Total + r2Margin) / 2,
    awayScore: (r2Total - r2Margin) / 2,
    marginHome: r2Margin,
    total: r2Total,
    spreadResidual: candidate.consensus.spreadHome === null
      ? null
      : r2Margin + candidate.consensus.spreadHome,
    movementQualified: false,
    movementApplied: false,
    marketApplied: {
      margin: candidate.consensus.spreadHome !== null,
      total: candidate.consensus.totalLine !== null,
    },
  };
  const r2Probabilities = computeNbaMarketProbabilities({
    projected_home_margin: r2Final.marginHome,
    projected_total: r2Final.total,
    market_spread_home: candidate.consensus.spreadHome,
    market_total: candidate.consensus.totalLine,
    margin_sd_base: NBA_PROFESSIONAL_MODEL_ARTIFACT.distribution!.marginSigma,
    total_sd_base: NBA_PROFESSIONAL_MODEL_ARTIFACT.distribution!.totalSigma,
  });
  const r2Candidate = {
    ...candidate,
    final: r2Final,
    probabilities: r2Probabilities,
    picks: {
      moneyline: r2Final.marginHome >= 0 ? "home" as const : "away" as const,
      spread: r2Probabilities.spread_home_cover_prob === null
        ? null
        : r2Probabilities.spread_home_cover_prob >= 0.5 ? "home" as const : "away" as const,
      total: r2Probabilities.total_over_prob === null
        ? null
        : r2Probabilities.total_over_prob >= 0.5 ? "over" as const : "under" as const,
    },
  };
  const r2Prediction = applyNbaProfessionalCandidate({ baseline, candidate: r2Candidate });
  const r3Prediction = applyNbaProfessionalCandidate({ baseline, candidate });
  const r2Dto = buildNbaDailyEdgeGameDto({
    snapshot,
    prediction: r2Prediction,
    provenance: prov,
    lines,
    splitsRow: null,
    opportunities: [],
  });
  const r3Dto = buildNbaDailyEdgeGameDto({
    snapshot,
    prediction: r3Prediction,
    provenance: prov,
    lines,
    splitsRow: null,
    opportunities: [],
  });
  return {
    gameExternalId: snapshot.game_external_id,
    matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
    books: new Set(lines.map((line) => line.sportsbook)).size,
    r2FinalScore: [r2Final.awayScore, r2Final.homeScore],
    professionalIndependentScore: [candidate.independent.awayScore, candidate.independent.homeScore],
    r3FinalScore: [candidate.final.awayScore, candidate.final.homeScore],
    market: { spreadHome: consensus.spreadHome, total: consensus.totalLine },
    markets: (["ml", "spread", "total"] as const).map((market) => {
      const incumbent = r2Dto.intelligence[market];
      const proposed = r3Dto.intelligence[market];
      return {
        market,
        r2: compactDecision(incumbent),
        r3: compactDecision(proposed),
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
    r2Actionable: markets.filter((row) => actionable(row.r2.grade)).length,
    r3Actionable: markets.filter((row) => actionable(row.r3.grade)).length,
    promotions: markets.filter((row) => row.promotion).length,
    demotions: markets.filter((row) => row.demotion).length,
    pickChanges: markets.filter((row) => row.r2.pick !== row.r3.pick).length,
    promotedNonpositiveExpectedReturn: markets.filter((row) =>
      row.promotion && (row.r3.expectedReturn === null || row.r3.expectedReturn <= 0)
    ).length,
  },
  limitations: [
    "This rehearsal compares the released r2 25/75 formula with r3's independent-first state before a qualifying reader correction.",
    "The live reader remains fail-closed unless two persistent same-direction number trails, including a named book, clear two points.",
    "Public splits are intentionally excluded from score and grade changes until source-qualified NBA validation exists.",
    "This is a read-only current-price rehearsal, not an outcome-accuracy estimate.",
  ],
  comparisons,
};
const output = path.resolve(`nba-research/reports/nba_professional_r44_independent_first_current_board/${date}.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, ...report.boardImpact, provider: report.provider }, null, 2));
}

void main();
