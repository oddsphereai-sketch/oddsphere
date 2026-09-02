/**
 * Read-only paired audit over the frozen deployed r1 EPL evidence capture.
 * This script never reads outcomes and never calls an odds provider.
 */
import { supabase } from "../../lib/db/supabase";
import { deriveEplCoherentMarketOutcome } from "../../lib/services/epl/eplCoherentMarketOutcome";
import {
  EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
  type EplForwardBookVector,
  type EplForwardEvidenceCapture,
  type EplForwardEvidenceHistory,
  type EplForwardMarket,
} from "../../lib/services/epl/eplForwardEvidenceCapture";
import { deriveEplMatchResultDecision, deriveEplPreviewGrade } from "../../lib/services/epl/eplPreviewGrade";

const CHAMPION_RELEASE = "epl_goals_coherent_2026_08_20_r16";
const CAPTURE_TIMESTAMP = "2026-09-02T12:38:05.049Z";
const GAMES = [58431, 58432, 58433, 58434, 58435, 58436, 58437, 58438, 58439, 58440] as const;
const MARKETS: EplForwardMarket[] = ["match_result", "double_chance", "total", "btts"];
const SIDES: Record<EplForwardMarket, string[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  total: ["over", "under"],
  btts: ["yes", "no"],
};
const BOARD_LABELS = ["Best Angle", "Lean", "Watchlist", "No Play", "Caution"] as const;

type GradeLabel = (typeof BOARD_LABELS)[number];
type Row = { game_id: number; matchup: string; slate_date: string; snapshot_json: Record<string, unknown> | null };
type BoardRow = {
  gameId: number;
  market: EplForwardMarket;
  forecastSide: string | null;
  valueSide: string | null;
  probability: number | null;
  priceAmerican: number | null;
  expectedValue: number | null;
  grade: GradeLabel;
  exactQuote: boolean;
};

function decimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function expectedValue(probability: number, american: number): number {
  return probability * decimal(american) - 1;
}

function gradeLabel(value: string | null): GradeLabel {
  return BOARD_LABELS.includes(value as GradeLabel) ? value as GradeLabel : "No Play";
}

function evidenceHistory(row: Row): EplForwardEvidenceHistory {
  const history = row.snapshot_json?.epl_forward_evidence_history as EplForwardEvidenceHistory | undefined;
  if (!history || history.captureRelease !== EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE) throw new Error(`r1 evidence missing for ${row.game_id}`);
  return history;
}

function captureFrom(row: Row, captureTimestamp: string): EplForwardEvidenceCapture {
  const capture = evidenceHistory(row).captures.find((candidate) => candidate.capturedAt === captureTimestamp);
  if (!capture) throw new Error(`capture ${captureTimestamp} missing for ${row.game_id}`);
  return capture;
}

function independentProbabilities(capture: EplForwardEvidenceCapture): Record<EplForwardMarket, Record<string, number>> {
  const p = capture.independent.probabilities;
  return {
    match_result: { home: p.home, draw: p.draw, away: p.away },
    double_chance: { home_or_draw: p.home + p.draw, away_or_draw: p.away + p.draw, home_or_away: p.home + p.away },
    total: { over: capture.champion.markets.total.selectedSide === "over" ? capture.champion.markets.total.modelProbability! : 1 - capture.champion.markets.total.modelProbability!, under: capture.champion.markets.total.selectedSide === "under" ? capture.champion.markets.total.modelProbability! : 1 - capture.champion.markets.total.modelProbability! },
    btts: { yes: capture.champion.markets.btts.selectedSide === "yes" ? capture.champion.markets.btts.modelProbability! : 1 - capture.champion.markets.btts.modelProbability!, no: capture.champion.markets.btts.selectedSide === "no" ? capture.champion.markets.btts.modelProbability! : 1 - capture.champion.markets.btts.modelProbability! },
  };
}

function quotedVector(capture: EplForwardEvidenceCapture, market: EplForwardMarket): EplForwardBookVector | null {
  return capture.markets[market].evaluated;
}

function quote(vector: EplForwardBookVector | null, side: string | null) {
  if (!vector || !side) return null;
  return vector.outcomes.find((outcome) => outcome.side === side) ?? null;
}

function valueSide(probabilities: Record<string, number>, vector: EplForwardBookVector | null): string | null {
  if (!vector) return null;
  const complete = SIDES[vector.market].map((side) => ({ side, probability: probabilities[side], quote: quote(vector, side) }));
  if (complete.some((row) => typeof row.probability !== "number" || !row.quote)) return null;
  return complete.reduce((best, row) => expectedValue(row.probability!, row.quote!.american) > expectedValue(best.probability!, best.quote!.american) ? row : best).side;
}

function championBoard(gameId: number, capture: EplForwardEvidenceCapture): BoardRow[] {
  const probabilities = independentProbabilities(capture);
  return MARKETS.map((market) => {
    const champion = capture.champion.markets[market];
    const vector = quotedVector(capture, market);
    const selectedQuote = quote(vector, champion.selectedSide);
    return {
      gameId,
      market,
      forecastSide: champion.selectedSide,
      valueSide: valueSide(probabilities[market], vector),
      probability: champion.modelProbability,
      priceAmerican: selectedQuote?.american ?? champion.currentPriceAmerican,
      expectedValue: champion.modelProbability !== null && (selectedQuote?.american ?? champion.currentPriceAmerican) !== null
        ? expectedValue(champion.modelProbability, (selectedQuote?.american ?? champion.currentPriceAmerican)!)
        : null,
      grade: gradeLabel(champion.grade),
      exactQuote: Boolean(selectedQuote),
    };
  });
}

function candidateFor(capture: EplForwardEvidenceCapture) {
  const totalEvaluated = capture.markets.total.evaluated;
  const bttsEvaluated = capture.markets.btts.evaluated;
  const vectors = [...(totalEvaluated ? [totalEvaluated] : []), ...capture.markets.total.targetExcluded];
  const providerEventId = capture.markets.total.targetExcluded.find((vector) => vector.providerEventId)?.providerEventId
    ?? totalEvaluated?.providerEventId
    ?? null;
  return deriveEplCoherentMarketOutcome({
    independentLambdaHome: capture.independent.lambdaHome,
    independentLambdaAway: capture.independent.lambdaAway,
    totalVectors: vectors,
    evaluatedMatchResultCanonicalBook: capture.markets.match_result.evaluated?.canonicalBook ?? null,
    evaluatedTotalCanonicalBook: totalEvaluated?.canonicalBook ?? null,
    evaluatedBttsCanonicalBook: bttsEvaluated?.canonicalBook ?? null,
    providerEventId,
    decisionAt: capture.capturedAt,
    kickoff: capture.kickoff,
  });
}

function candidateBoard(gameId: number, capture: EplForwardEvidenceCapture, outcome: ReturnType<typeof candidateFor>): BoardRow[] {
  const p = capture.independent.probabilities;
  const probabilities: Record<EplForwardMarket, Record<string, number>> = {
    match_result: { home: p.home, draw: p.draw, away: p.away },
    double_chance: { home_or_draw: p.home + p.draw, away_or_draw: p.away + p.draw, home_or_away: p.home + p.away },
    total: { over: outcome.markets.total.over, under: outcome.markets.total.under },
    btts: { yes: outcome.markets.btts.yes, no: outcome.markets.btts.no },
  };
  return MARKETS.map((market) => {
    if (market === "double_chance") return championBoard(gameId, capture).find((row) => row.market === market)!;
    if (market === "match_result") {
      const vector = quotedVector(capture, market);
      const complete = vector && SIDES.match_result.every((side) => quote(vector, side));
      const decision = deriveEplMatchResultDecision({
        model: probabilities.match_result as { home: number; draw: number; away: number },
        market: complete ? {
          home: quote(vector, "home")!.noVigProbability,
          draw: quote(vector, "draw")!.noVigProbability,
          away: quote(vector, "away")!.noVigProbability,
        } : null,
        prices: complete ? {
          home: quote(vector, "home")!.american,
          draw: quote(vector, "draw")!.american,
          away: quote(vector, "away")!.american,
        } : null,
        promotedProxy: capture.independent.confidence === "limited",
      });
      const selectedQuote = quote(vector, decision.forecastSide);
      return {
        gameId,
        market,
        forecastSide: decision.forecastSide,
        valueSide: valueSide(probabilities.match_result, vector),
        probability: probabilities.match_result[decision.forecastSide]!,
        priceAmerican: selectedQuote?.american ?? null,
        expectedValue: selectedQuote ? expectedValue(probabilities.match_result[decision.forecastSide]!, selectedQuote.american) : null,
        grade: gradeLabel(decision.grade.verdict.label),
        exactQuote: Boolean(selectedQuote),
      };
    }
    const forecastSide = SIDES[market].reduce((best, side) => probabilities[market][side]! > probabilities[market][best]! ? side : best);
    const modelProbability = probabilities[market][forecastSide]!;
    const vector = quotedVector(capture, market);
    const selectedQuote = quote(vector, forecastSide);
    const marketProbability = selectedQuote?.noVigProbability ?? null;
    const edgePp = marketProbability === null ? null : (modelProbability - marketProbability) * 100;
    const grade = deriveEplPreviewGrade({
      market,
      modelProbability,
      edgePp,
      priceAmerican: selectedQuote?.american ?? null,
      coherentMarket: Boolean(vector),
      promotedProxy: capture.independent.confidence === "limited",
    });
    return {
      gameId,
      market,
      forecastSide,
      valueSide: valueSide(probabilities[market], vector),
      probability: modelProbability,
      priceAmerican: selectedQuote?.american ?? null,
      expectedValue: selectedQuote ? expectedValue(modelProbability, selectedQuote.american) : null,
      grade: gradeLabel(grade.verdict.label),
      exactQuote: Boolean(selectedQuote),
    };
  });
}

function counts(rows: BoardRow[]) {
  return Object.fromEntries(BOARD_LABELS.map((label) => [label, rows.filter((row) => row.grade === label).length]));
}

function rank(grade: GradeLabel): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}

async function main() {
  const { data, error } = await supabase.from("prediction_records")
    .select("game_id,matchup,slate_date,snapshot_json")
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .eq("model_version", CHAMPION_RELEASE)
    .in("game_id", [...GAMES]);
  if (error) throw new Error(`read frozen EPL evidence: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length !== GAMES.length) throw new Error(`expected ${GAMES.length} frozen games, found ${rows.length}`);
  rows.sort((left, right) => left.game_id - right.game_id);
  const captureTimestamp = CAPTURE_TIMESTAMP;
  if (!rows.every((row) => evidenceHistory(row).captures.some((capture) => capture.capturedAt === captureTimestamp))) {
    throw new Error(`frozen capture ${captureTimestamp} no longer covers all ten games`);
  }

  const games = rows.map((row) => {
    const capture = captureFrom(row, captureTimestamp);
    const candidate = candidateFor(capture);
    const champion = championBoard(row.game_id, capture);
    const next = candidateBoard(row.game_id, capture, candidate);
    return { row, capture, candidate, champion, next };
  });
  const championRows = games.flatMap((game) => game.champion);
  const candidateRows = games.flatMap((game) => game.next);
  const eligibleSources = games.flatMap((game) => game.candidate.audit.eligibleAlternativeSources);
  const transitions = candidateRows.map((next) => {
    const prior = championRows.find((row) => row.gameId === next.gameId && row.market === next.market)!;
    const priorActionable = prior.grade === "Best Angle" || prior.grade === "Lean";
    const nextActionable = next.grade === "Best Angle" || next.grade === "Lean";
    return {
      gameId: next.gameId,
      market: next.market,
      forecastSideChanged: prior.forecastSide !== next.forecastSide,
      valueSideChanged: prior.valueSide !== next.valueSide,
      gradeDirection: rank(next.grade) > rank(prior.grade) ? "promotion" : rank(next.grade) < rank(prior.grade) ? "demotion" : "unchanged",
      actionableDirection: !priorActionable && nextActionable ? "promotion" : priorActionable && !nextActionable ? "demotion" : "unchanged",
      exactRepricedQuoteAfterSideChange: prior.forecastSide !== next.forecastSide ? next.exactQuote : null,
      champion: prior,
      candidate: next,
    };
  });
  const byMarket = Object.fromEntries(MARKETS.map((market) => [market, {
    champion: counts(championRows.filter((row) => row.market === market)),
    candidate: counts(candidateRows.filter((row) => row.market === market)),
    forecastSideChanges: transitions.filter((row) => row.market === market && row.forecastSideChanged).length,
    valueSideChanges: transitions.filter((row) => row.market === market && row.valueSideChanged).length,
    tierPromotions: transitions.filter((row) => row.market === market && row.gradeDirection === "promotion").length,
    tierDemotions: transitions.filter((row) => row.market === market && row.gradeDirection === "demotion").length,
    actionablePromotions: transitions.filter((row) => row.market === market && row.actionableDirection === "promotion").length,
    actionableDemotions: transitions.filter((row) => row.market === market && row.actionableDirection === "demotion").length,
    exactQuoteCoverage: `${candidateRows.filter((row) => row.market === market && row.exactQuote).length}/${GAMES.length}`,
  }]));
  const report = {
    cohort: "prospective_frozen_r1_pilot_same_snapshot_no_outcomes_read",
    captureRelease: EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
    captureTimestamp,
    games: games.length,
    selectedPmf: {
      targetExcludedTilt: games.filter((game) => game.candidate.source === "target_excluded_total_tilt").length,
      exactIndependentIdentity: games.filter((game) => game.candidate.source === "independent_club_pmf").length,
      gateReasons: games.flatMap((game) => game.candidate.audit.gateReasons).reduce<Record<string, number>>((result, reason) => ({ ...result, [reason]: (result[reason] ?? 0) + 1 }), {}),
      eligibleAlternativeCounts: games.map((game) => ({ gameId: game.row.game_id, count: game.candidate.audit.eligibleAlternativeBooks.length, source: game.candidate.source })),
      singletonAuthority: 0,
    },
    evidence: {
      sourceClasses: eligibleSources.reduce<Record<string, number>>((result, source) => ({
        ...result,
        [source.sourceClass]: (result[source.sourceClass] ?? 0) + 1,
      }), {}),
      conservativeFamilies: eligibleSources.reduce<Record<string, number>>((result, source) => ({
        ...result,
        [source.evidenceFamily]: (result[source.evidenceFamily] ?? 0) + 1,
      }), {}),
      maximumAgeMs: Math.max(...eligibleSources.map((source) => Date.parse(captureTimestamp) - Date.parse(source.fetchedAtMin))),
      maximumVectorSkewMs: Math.max(...eligibleSources.map((source) => source.vectorSkewMs)),
      evaluatedCanonicalBooksExcluded: Object.fromEntries(games.map((game) => [game.row.game_id, game.candidate.audit.evaluatedCanonicalBooksExcluded])),
      exactSameBookMovementVectorsReportedOnly: games.reduce((sum, game) => sum
        + MARKETS.reduce((marketSum, market) => marketSum + game.capture.markets[market].movements.length, 0), 0),
      publicEvidencePresentReportedOnly: games.reduce((sum, game) => sum
        + MARKETS.filter((market) => game.capture.markets[market].publicEvidence?.state === "present").length, 0),
      circaVectorsPresentReportedOnly: games.reduce((sum, game) => sum
        + MARKETS.filter((market) => game.capture.markets[market].circaVectorIdentity !== null).length, 0),
      evaluatedQuotesExcludedFromForecast: true,
      movementPublicCircaPosteriorWeight: 0,
    },
    identity: {
      matchResultProbabilityChanges: games.filter((game) => ["home", "draw", "away"].some((side) => game.candidate.markets.match_result[side as "home"] !== game.capture.independent.probabilities[side as "home"])).length,
      matchResultSideChanges: transitions.filter((row) => row.market === "match_result" && row.forecastSideChanged).length,
      doubleChanceSideChanges: transitions.filter((row) => row.market === "double_chance" && row.forecastSideChanged).length,
      doubleChanceConstruction: "exact_match_result_pairwise_sums",
    },
    board: {
      overall: { champion: counts(championRows), candidate: counts(candidateRows) },
      byMarket,
      forecastSideChanges: transitions.filter((row) => row.forecastSideChanged).length,
      valueSideChanges: transitions.filter((row) => row.valueSideChanged).length,
      tierPromotions: transitions.filter((row) => row.gradeDirection === "promotion").length,
      tierDemotions: transitions.filter((row) => row.gradeDirection === "demotion").length,
      actionablePromotions: transitions.filter((row) => row.actionableDirection === "promotion").length,
      actionableDemotions: transitions.filter((row) => row.actionableDirection === "demotion").length,
      nonPositiveExpectedValueActionables: candidateRows.filter((row) =>
        (row.grade === "Best Angle" || row.grade === "Lean")
        && (row.expectedValue === null || row.expectedValue <= 0)).length,
      changedRows: transitions.filter((row) => row.forecastSideChanged || row.valueSideChanged || row.gradeDirection !== "unchanged"),
    },
    projections: games.map((game) => ({
      gameId: game.row.game_id,
      matchup: game.row.matchup,
      source: game.candidate.source,
      champion: game.capture.champion.projected,
      candidate: { away: game.candidate.expectedGoals.away, home: game.candidate.expectedGoals.home },
      likelyScore: game.candidate.likelyScore,
      representativeScore: game.candidate.representativeScore,
      totalOver: game.candidate.markets.total.over,
      bttsYes: game.candidate.markets.btts.yes,
      maximumMatchResultResidual: game.candidate.audit.maximumMatchResultResidual,
    })),
    limitations: [
      "No outcomes were read; this is a paired mechanics/board audit, not forecast-quality qualification.",
      "The bounded r1 capture may omit eligible vectors after deterministic pruning; omitted vectors are not reconstructed.",
      "Movement, public, and Circa capture fields are reporting-only and are not posterior modifiers.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
