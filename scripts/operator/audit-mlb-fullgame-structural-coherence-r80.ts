/**
 * SELECT-only / pure-model audit for MLB full-game structural coherence r80.
 *
 * This script performs no provider calls and no writes. It compares the r80
 * singleton evaluated-quote exclusion with the incumbent behavior on the same
 * immutable in-memory GameSnapshot. The incumbent replay is exact for this
 * structural branch: when a coherent-map market has one accepted complete
 * pair, only the pair-count input to the new exclusion resolver is changed;
 * all prices, probabilities, timestamps, baseball inputs, and r76 math remain
 * byte-identical.
 *
 * A separate dry prediction-record build reports publication coherence and
 * exact-price grade counts. Those results are deliberately not presented as
 * forecast-accuracy evidence.
 */
import { loadEnvConfig } from "@next/env";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";
import type { GameSnapshot, MlbCoherentMarketPriceMapSide } from "../../lib/automodel/types";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { supabase } from "../../lib/db/supabase";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

loadEnvConfig(process.cwd());

type ModelGrade = "best_angle" | "lean" | "watchlist" | "no_play" | "other";

function pairCount(side: MlbCoherentMarketPriceMapSide): number {
  return side.sharp_book_count + side.retail_book_count;
}

function replayIncumbentSnapshot(snapshot: GameSnapshot): GameSnapshot {
  const map = snapshot.market.coherent_price_map;
  if (map === null || map === undefined) return snapshot;
  const expandSingleton = (
    side: MlbCoherentMarketPriceMapSide,
  ): MlbCoherentMarketPriceMapSide => {
    if (pairCount(side) !== 1) return side;
    return side.retail_book_count === 1
      ? { ...side, retail_book_count: 2 }
      : { ...side, sharp_book_count: 2 };
  };
  return {
    ...snapshot,
    market: {
      ...snapshot.market,
      coherent_price_map: {
        ...map,
        moneyline_home: expandSingleton(map.moneyline_home),
        total_over: expandSingleton(map.total_over),
      },
    },
  };
}

function normalizeModelGrade(value: string): ModelGrade {
  if (value === "best_angle" || value === "lean") return value;
  if (value === "market_aligned") return "watchlist";
  if (value === "no_bet" || value === "provisional") return "no_play";
  return "other";
}

function gradeCounts(values: readonly ModelGrade[]): Record<ModelGrade, number> {
  return {
    best_angle: values.filter((value) => value === "best_angle").length,
    lean: values.filter((value) => value === "lean").length,
    watchlist: values.filter((value) => value === "watchlist").length,
    no_play: values.filter((value) => value === "no_play").length,
    other: values.filter((value) => value === "other").length,
  };
}

function expectedValuePct(probability: number, americanOdds: number | null): number | null {
  if (!Number.isFinite(probability) || americanOdds === null || americanOdds === 0) return null;
  const winProfit = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  return (probability * winProfit - (1 - probability)) * 100;
}

function recordGrade(record: {
  best_angle: boolean;
  play_grade: string | null;
  no_bet: boolean;
  held: boolean;
}): ModelGrade {
  if (record.best_angle || record.play_grade === "best_angle") return "best_angle";
  if (record.play_grade === "lean" && !record.no_bet && !record.held) return "lean";
  if (record.no_bet || record.held) return "no_play";
  return "watchlist";
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type CandidateModel = ReturnType<typeof runMlbAutoModelV2_2>;
type QueryResult = { data: unknown; error?: unknown };

function wrapThenableQuery(
  query: object,
  transform: (result: QueryResult) => QueryResult,
): object {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === "then") {
        const then = Reflect.get(target, property, receiver) as (
          onFulfilled: (result: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => unknown;
        return (
          onFulfilled: (result: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => then.call(target, (result) => onFulfilled(transform(result)), onRejected);
      }
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const next = Reflect.apply(member, target, args) as unknown;
        return next !== null && typeof next === "object"
          ? wrapThenableQuery(next, transform)
          : next;
      };
    },
  });
}

function modelPredictionClient(
  modelByGameId: ReadonlyMap<number, CandidateModel>,
): typeof supabase {
  const from = (table: string): unknown => {
    const query = supabase.from(table);
    if (table !== "game_predictions") return query;
    return wrapThenableQuery(query, (result) => {
      if (!Array.isArray(result.data)) return result;
      return {
        ...result,
        data: result.data.map((unknownRow) => {
          const row = object(unknownRow);
          const gameId = typeof row?.game_id === "number" ? row.game_id : null;
          const candidate = gameId === null ? undefined : modelByGameId.get(gameId);
          if (row === null || candidate === undefined) return unknownRow;
          const priorSportSpecific = object(row.sport_specific) ?? {};
          return {
            ...row,
            predicted_home_score: candidate.predicted_home_score,
            predicted_away_score: candidate.predicted_away_score,
            predicted_ml_winner: candidate.predicted_ml_winner,
            ml_confidence: candidate.ml_confidence,
            predicted_ou_side: candidate.predicted_ou_side,
            ou_confidence: candidate.ou_confidence,
            sport_specific: {
              ...priorSportSpecific,
              ml_play_grade: candidate.v22Audit.ml_play_grade,
              ou_play_grade: candidate.v22Audit.ou_play_grade,
              ml_prediction_type: candidate.v22Audit.ml_prediction_type,
              ou_prediction_type: candidate.v22Audit.ou_prediction_type,
              ml_best_angle_eligible: candidate.v22Audit.ml_best_angle_eligible,
              ou_best_angle_eligible: candidate.v22Audit.ou_best_angle_eligible,
              ml_best_angle_reason: candidate.v22Audit.ml_best_angle_reason,
              ou_best_angle_reason: candidate.v22Audit.ou_best_angle_reason,
              ml_no_bet_reason: candidate.v22Audit.ml_no_bet_reason,
              ou_no_bet_reason: candidate.v22Audit.ou_no_bet_reason,
              ml_market_aligned: candidate.v22Audit.ml_market_aligned,
              ou_market_aligned: candidate.v22Audit.ou_market_aligned,
              v2_provisional: candidate.v22Audit.provisional,
              v2_data_quality_tier: candidate.v22Audit.data_quality_tier,
              v2_best_angle_eligible:
                candidate.v22Audit.ml_best_angle_eligible ||
                candidate.v22Audit.ou_best_angle_eligible,
              v2_2_audit: candidate.v22Audit,
            },
          };
        }),
      };
    });
  };
  return { from } as unknown as typeof supabase;
}

async function main(): Promise<void> {
  const dateArg = process.argv.find((value) => value.startsWith("--date="));
  const slateDate = dateArg?.slice("--date=".length) ?? currentSlateDate("mlb");
  const generatedAt = new Date();
  const onlyUnstarted = process.argv.includes("--only-unstarted");
  const allSnapshots = await buildFeatureSnapshots("mlb", slateDate);
  const snapshots = onlyUnstarted
    ? allSnapshots.filter((snapshot) => {
        const scheduledAt = Date.parse(snapshot.game_date);
        return Number.isFinite(scheduledAt) && scheduledAt > generatedAt.getTime();
      })
    : allSnapshots;
  const candidateByExternalId = new Map<number, CandidateModel>();
  const incumbentByExternalId = new Map<number, CandidateModel>();
  const modelRows = snapshots.map((snapshot) => {
    const v1 = runMlbAutoModelV1(snapshot, "morning_draft");
    const incumbent = runMlbAutoModelV2_2(
      replayIncumbentSnapshot(snapshot),
      v1,
      "morning_draft",
    );
    const candidate = runMlbAutoModelV2_2(snapshot, v1, "morning_draft");
    candidateByExternalId.set(snapshot.game_external_id, candidate);
    incumbentByExternalId.set(snapshot.game_external_id, incumbent);
    const exclusion = candidate.v22Audit.evaluation_only_price_exclusion;
    const incumbentMlGrade = normalizeModelGrade(incumbent.v22Audit.ml_play_grade);
    const candidateMlGrade = normalizeModelGrade(candidate.v22Audit.ml_play_grade);
    const incumbentTotalGrade = normalizeModelGrade(incumbent.v22Audit.ou_play_grade);
    const candidateTotalGrade = normalizeModelGrade(candidate.v22Audit.ou_play_grade);
    const incumbentMlOdds = incumbent.predicted_ml_winner === "home"
      ? snapshot.market.home_ml_odds_american
      : snapshot.market.away_ml_odds_american;
    const candidateMlOdds = candidate.predicted_ml_winner === "home"
      ? snapshot.market.home_ml_odds_american
      : snapshot.market.away_ml_odds_american;
    const incumbentTotalOdds = incumbent.predicted_ou_side === "over"
      ? snapshot.market.over_odds_american
      : snapshot.market.under_odds_american;
    const candidateTotalOdds = candidate.predicted_ou_side === "over"
      ? snapshot.market.over_odds_american
      : snapshot.market.under_odds_american;
    return {
      externalId: snapshot.game_external_id,
      matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
      singletonMoneyline: exclusion?.moneyline_forecast_excluded === true,
      singletonTotal:
        exclusion?.total_forecast_excluded === true &&
        exclusion?.total_probability_regularization_excluded === true,
      incumbent: {
        awayScore: incumbent.predicted_away_score,
        homeScore: incumbent.predicted_home_score,
        total: incumbent.predicted_total,
        moneylineSide: incumbent.predicted_ml_winner,
          moneylineProbability: incumbent.v22Audit.ml_model_prob,
          moneylineOdds: incumbentMlOdds,
          moneylineExpectedValuePct: expectedValuePct(
            incumbent.v22Audit.ml_model_prob,
            incumbentMlOdds,
          ),
          moneylineEdgePp: incumbent.v22Audit.ml_edge_pct,
          moneylineGrade: incumbentMlGrade,
          totalSide: incumbent.predicted_ou_side,
          totalProbability: incumbent.v22Audit.ou_model_prob,
          totalOdds: incumbentTotalOdds,
          totalExpectedValuePct: expectedValuePct(
            incumbent.v22Audit.ou_model_prob,
            incumbentTotalOdds,
          ),
          totalEdgePp: incumbent.v22Audit.ou_edge_pct,
          totalGrade: incumbentTotalGrade,
      },
      candidate: {
        awayScore: candidate.predicted_away_score,
        homeScore: candidate.predicted_home_score,
        total: candidate.predicted_total,
        moneylineSide: candidate.predicted_ml_winner,
          moneylineProbability: candidate.v22Audit.ml_model_prob,
          moneylineOdds: candidateMlOdds,
          moneylineExpectedValuePct: expectedValuePct(
            candidate.v22Audit.ml_model_prob,
            candidateMlOdds,
          ),
          moneylineEdgePp: candidate.v22Audit.ml_edge_pct,
          moneylineGrade: candidateMlGrade,
          totalSide: candidate.predicted_ou_side,
          totalProbability: candidate.v22Audit.ou_model_prob,
          totalOdds: candidateTotalOdds,
          totalExpectedValuePct: expectedValuePct(
            candidate.v22Audit.ou_model_prob,
            candidateTotalOdds,
          ),
          totalEdgePp: candidate.v22Audit.ou_edge_pct,
          totalGrade: candidateTotalGrade,
      },
      scoreChanged:
        incumbent.predicted_away_score !== candidate.predicted_away_score ||
        incumbent.predicted_home_score !== candidate.predicted_home_score,
      moneylineSideChanged: incumbent.predicted_ml_winner !== candidate.predicted_ml_winner,
      totalSideChanged: incumbent.predicted_ou_side !== candidate.predicted_ou_side,
      moneylineGradeChanged: incumbentMlGrade !== candidateMlGrade,
      totalGradeChanged: incumbentTotalGrade !== candidateTotalGrade,
    };
  });

  const gameQuery = await supabase
    .from("games")
    .select("id,external_id")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate);
  if (gameQuery.error) throw new Error(gameQuery.error.message);
  const candidateByGameId = new Map<number, CandidateModel>();
  const incumbentByGameId = new Map<number, CandidateModel>();
  for (const unknownRow of gameQuery.data ?? []) {
    const row = object(unknownRow);
    const id = typeof row?.id === "number" ? row.id : null;
    const externalId = typeof row?.external_id === "number" ? row.external_id : null;
    const candidate = externalId === null ? undefined : candidateByExternalId.get(externalId);
    if (id !== null && candidate !== undefined) candidateByGameId.set(id, candidate);
    const incumbent = externalId === null ? undefined : incumbentByExternalId.get(externalId);
    if (id !== null && incumbent !== undefined) incumbentByGameId.set(id, incumbent);
  }
  const incumbentDry = await createPredictionRecords({
    sport: "mlb",
    slateDate,
    launchDay: false,
    apply: false,
    supabase: modelPredictionClient(incumbentByGameId),
  });
  if (incumbentDry.errors.length > 0) throw new Error(JSON.stringify(incumbentDry.errors));
  const candidateDry = await createPredictionRecords({
    sport: "mlb",
    slateDate,
    launchDay: false,
    apply: false,
    supabase: modelPredictionClient(candidateByGameId),
  });
  if (candidateDry.errors.length > 0) throw new Error(JSON.stringify(candidateDry.errors));
  const publicRows = candidateDry.proposed
    .filter((record) => record.market === "moneyline" || record.market === "total")
    .map((record) => {
      const snapshot = object(record.snapshot_json);
      const decision = object(snapshot?.decision_pipeline);
      return {
        matchup: record.matchup,
        market: record.market,
        finalSide: record.side,
        grade: recordGrade(record),
        publicationCoherenceApplied: decision?.publication_coherence_applied === true,
        rejectedCandidateSide:
          typeof decision?.publication_coherence_rejected_candidate_side === "string"
            ? decision.publication_coherence_rejected_candidate_side
            : null,
        boardAction: decision?.board_action ?? null,
      };
    });
  const incumbentPublicByKey = new Map(
    incumbentDry.proposed
      .filter((record) => record.market === "moneyline" || record.market === "total")
      .map((record) => [`${record.game_id}:${record.market}`, {
        side: record.side,
        grade: recordGrade(record),
      }] as const),
  );
  const publicTransitions = candidateDry.proposed
    .filter((record) => record.market === "moneyline" || record.market === "total")
    .flatMap((record) => {
      const incumbent = incumbentPublicByKey.get(`${record.game_id}:${record.market}`);
      if (incumbent === undefined) return [];
      const candidateGrade = recordGrade(record);
      return [{
        matchup: record.matchup,
        market: record.market,
        incumbentSide: incumbent.side,
        candidateSide: record.side,
        incumbentGrade: incumbent.grade,
        candidateGrade,
        sideChanged: incumbent.side !== record.side,
        gradeChanged: incumbent.grade !== candidateGrade,
      }];
    });
  const incumbentMlGrades = modelRows.map((row) => row.incumbent.moneylineGrade);
  const candidateMlGrades = modelRows.map((row) => row.candidate.moneylineGrade);
  const incumbentTotalGrades = modelRows.map((row) => row.incumbent.totalGrade);
  const candidateTotalGrades = modelRows.map((row) => row.candidate.totalGrade);
  const gradeTransitions = modelRows.flatMap((row) => [
    row.moneylineGradeChanged
      ? {
          matchup: row.matchup,
          market: "moneyline",
          from: row.incumbent.moneylineGrade,
          to: row.candidate.moneylineGrade,
        }
      : null,
    row.totalGradeChanged
      ? {
          matchup: row.matchup,
          market: "total",
          from: row.incumbent.totalGrade,
          to: row.candidate.totalGrade,
        }
      : null,
  ]).filter((row): row is NonNullable<typeof row> => row !== null);
  const actionable = (grade: ModelGrade): boolean => grade === "best_angle" || grade === "lean";

  console.log(JSON.stringify({
    generatedAt: generatedAt.toISOString(),
    slateDate,
    onlyUnstarted,
    allGames: allSnapshots.length,
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    predictionQuality: {
      games: modelRows.length,
      singletonMoneylineRows: modelRows.filter((row) => row.singletonMoneyline).length,
      singletonTotalRows: modelRows.filter((row) => row.singletonTotal).length,
      scoreChanges: modelRows.filter((row) => row.scoreChanged).length,
      moneylineSideChanges: modelRows.filter((row) => row.moneylineSideChanged).length,
      totalSideChanges: modelRows.filter((row) => row.totalSideChanged).length,
      changedRows: modelRows.filter((row) =>
        row.scoreChanged || row.moneylineSideChanged || row.totalSideChanged ||
        row.moneylineGradeChanged || row.totalGradeChanged
      ),
    },
    exactPriceGradeEconomics: {
      incumbent: {
        moneyline: gradeCounts(incumbentMlGrades),
        total: gradeCounts(incumbentTotalGrades),
        actionables: [...incumbentMlGrades, ...incumbentTotalGrades].filter(actionable).length,
      },
      candidate: {
        moneyline: gradeCounts(candidateMlGrades),
        total: gradeCounts(candidateTotalGrades),
        actionables: [...candidateMlGrades, ...candidateTotalGrades].filter(actionable).length,
      },
      promotions: gradeTransitions.filter((row) => !actionable(row.from) && actionable(row.to)),
      demotions: gradeTransitions.filter((row) => actionable(row.from) && !actionable(row.to)),
      allTransitions: gradeTransitions,
    },
    dryPublication: {
      authoritativePredictionOverrides: candidateByGameId.size,
      records: publicRows.length,
      incumbentGradeCounts: gradeCounts(
        [...incumbentPublicByKey.values()].map((row) => row.grade),
      ),
      gradeCounts: gradeCounts(publicRows.map((row) => row.grade)),
      actionablePromotions: publicTransitions.filter((row) =>
        !actionable(row.incumbentGrade) && actionable(row.candidateGrade)
      ),
      actionableDemotions: publicTransitions.filter((row) =>
        actionable(row.incumbentGrade) && !actionable(row.candidateGrade)
      ),
      sideChanges: publicTransitions.filter((row) => row.sideChanged),
      allChangedRows: publicTransitions.filter((row) => row.sideChanged || row.gradeChanged),
      coherenceRepairs: publicRows.filter((row) => row.publicationCoherenceApplied),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
