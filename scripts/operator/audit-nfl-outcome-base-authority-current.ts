#!/usr/bin/env tsx

/** SELECT-only same-input audit for the price-blind NFL outcome-base candidate. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflOwlsNamedPriceHistory } from "../../lib/services/football/nflOwlsNamedPriceHistory";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import { nflStoredMarketEpisodeHistory } from "../../lib/services/football/nflStoredMarketEpisodeHistory";
import { selectNflOutcomeBaseAuthority } from "../../lib/services/football/nflOutcomeBaseAuthority";
import { readNflMarketInnovation } from "../../lib/services/football/nflMarketInnovationRuntime";
import { applyNflMarketInnovationPosture } from "../../lib/services/football/nflMarketInnovationPosture";
import { buildNflMarketQualification } from "../../lib/services/football/nflMarketQualification";
import { nflForwardContextSharpHistoryBooks } from "../../lib/services/football/nflForwardEvidenceCapture";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import { buildNflV1ActionableGradeBundle } from "../../lib/services/football/nflV1ActionableGradeCandidate";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  type NflV1WeekOneOutcomeForecast,
} from "../../lib/services/football/nflV1WeekOneOutcome";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const season = 2026;
  const week = Number(process.argv.find(value => value.startsWith("--week="))?.slice(7) ?? "9");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [stored, currentSeasonState] = await Promise.all([
    readNflForwardEvidence({ client, season, week }),
    readNflPlayerPropsCurrentSeasonState({ client, season }),
  ]);
  type CurrentStored = Omit<NflForwardStoredEvidence, "payload"> & { payload: NflForwardEvidencePayload };
  const latest = new Map<string, CurrentStored>();
  for (const row of stored) {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE || row.stage === "t60" ||
        !row.payload.exactProviderScoreShadow || !row.payload.paidProjectionShadow ||
        !row.payload.providerStartersAndDepth) continue;
    const currentRow = row as CurrentStored;
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(prior.capturedAt) < Date.parse(row.capturedAt)) latest.set(row.providerGameId, currentRow);
  }
  const evaluatedAt = new Date(Math.max(...[...latest.values()].map(row => Date.parse(row.capturedAt)))).toISOString();
  const owls = await readNflOwlsNamedPriceHistory({ client, gameIds: [...latest.keys()], evaluatedAt });
  const rows = [...latest.values()].sort((a, b) => a.providerGameId.localeCompare(b.providerGameId)).map(row => {
    const payload = row.payload;
    const exact = payload.exactProviderScoreShadow!;
    const fallback = getNflV1WeekOneOutcomeForecast({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: { projectedHomeMargin: exact.expectedHomeMargin, marketTotal: exact.expectedTotal },
    });
    const selected = selectNflOutcomeBaseAuthority({
      fallbackForecast: fallback,
      exactProviderScore: exact,
      playerAwareScore: payload.paidProjectionShadow!,
      providerDepth: payload.providerStartersAndDepth!,
      availabilityAdjustedDepth: payload.startersAndDepth,
    });
    const history = [
      ...(owls.historyByGame[row.providerGameId] ?? []).flatMap(receipt => receipt.books),
      ...nflStoredMarketEpisodeHistory({ providerGameId: row.providerGameId, evaluatedAt: row.capturedAt,
        captures: stored.filter(item => item.providerGameId === row.providerGameId)
          .map(item => item.payload.contextualEvidenceCapture) }),
    ];
    const shadow = buildNflR6ShadowMoneylineDecision({
      game: payload.game,
      opening: payload.market.operationalOpening,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      startersAndDepth: payload.startersAndDepth,
      injuries: payload.injuries,
      stage: row.stage,
      capturedAt: row.capturedAt,
      t60LagMinutes: payload.t60LagMinutes,
      coverageHealthHolds: payload.coverage.healthHolds,
      currentSeasonState,
    });
    const referenceBooks = nflForwardContextSharpHistoryBooks(payload.contextualEvidenceCapture);
    const allCapturedInterpreted = payload.fullGameEvidenceInterpretation?.interpretationAccounting
      .allCapturedInterpreted === true;
    let evaluationTargets = buildNflV1ActionableGradeBundle({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: row.gameStartAt,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
      outcomeForecast: selected.outcome,
    });
    let candidate: ReturnType<typeof readNflMarketInnovation> | null = null;
    let candidateProduction = evaluationTargets;
    const seenTargets = new Set<string>();
    for (let iteration = 0; iteration < 12; iteration++) {
      const targetKey = evaluatedTargetSignature(evaluationTargets);
      if (seenTargets.has(targetKey)) break;
      seenTargets.add(targetKey);
      const excluded = Object.fromEntries(([
        "moneyline", "spread", "total",
      ] as const).map(market => [market, evaluationTargets.evaluatedBets
        .filter(bet => bet.market === market)
        .map(bet => bet.evaluatedQuote.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, ""))])) as
        Record<"moneyline" | "spread" | "total", string[]>;
      candidate = readNflMarketInnovation({
        independentForecast: selected.outcome,
        independentInputPolicy: "market_inputs_prohibited",
        history,
        evaluatedAt: row.capturedAt,
        gameStartsAt: row.gameStartAt,
        excludedFamiliesByMarket: excluded,
      });
      const qualification = Object.fromEntries(([
        "moneyline", "spread", "total",
      ] as const).map(market => {
        const source = market === "total" ? candidate!.receipt.selectedSources.total
          : candidate!.receipt.selectedSources.moneyline ?? candidate!.receipt.selectedSources.spread;
        return [market, buildNflMarketQualification({
          market,
          providerGameId: row.providerGameId,
          evaluatedAt: row.capturedAt,
          gameStartsAt: row.gameStartAt,
          forecast: candidate!.outcome,
          basis: source ? "source_bound_joint_innovation" : "market_free_independent_law",
          independentInputPolicy: "market_inputs_prohibited",
          sourceMarketId: `${row.providerGameId}:${market}`,
          sourceReceipt: JSON.stringify({
            release: candidate!.receipt.release,
            source: source ?? "independent_exact_stat",
            reason: candidate!.receipt.reasons[market],
          }),
          evidenceQualified: allCapturedInterpreted &&
            candidate!.receipt.marketQualificationStatus?.[market].status !== "unavailable",
        })];
      }));
      const unposturedProduction = buildNflV1ActionableGradeBundle({
        providerGameId: row.providerGameId,
        awayTeam: payload.game.away.abbreviation,
        homeTeam: payload.game.home.abbreviation,
        gameStartsAt: row.gameStartAt,
        current: payload.market.current,
        comparableCurrentBooks: payload.market.comparableCurrentBooks,
        shadowMoneyline: shadow,
        outcomeForecast: candidate.outcome,
        referenceBooks,
        marketQualification: qualification,
      });
      candidateProduction = applyNflMarketInnovationPosture({
        production: unposturedProduction,
        innovation: { ...candidate.receipt, qualification },
        homeTeam: payload.game.home.abbreviation,
        promotionContext: {
          independentForecast: selected.outcome,
          finalForecast: candidate.outcome,
          marketQualification: qualification,
          books: payload.market.comparableCurrentBooks,
          referenceBooks,
          sourceHistory: history,
          executionAvailableAt: row.capturedAt,
        },
      }).production;
      if (evaluatedTargetSignature(candidateProduction) === targetKey) break;
      evaluationTargets = candidateProduction;
    }
    if (!candidate) throw new Error(`NFL target stabilization produced no candidate for ${row.providerGameId}`);
    return summarize(row, selected.outcome, candidate.outcome, selected.receipt.source,
      candidate.receipt.selectedSources, candidateProduction.evaluatedBets);
  });
  const changes = rows.filter(row => row.scoreChanged || row.sideChanges.length > 0);
  const authorityChanges = rows.filter(row => row.baseSource === "player_aware_availability_regime");
  const actionable = (grade: string | undefined) => grade === "Lean" || grade === "Best Angle";
  const beforeActionables = rows.flatMap(row => Object.values(row.currentGrades)).filter(row => actionable(row.grade)).length;
  const afterActionables = rows.flatMap(row => Object.values(row.candidateGrades)).filter(row => actionable(row.grade)).length;
  const transitions = rows.flatMap(row => (["moneyline", "spread", "total"] as const).map(market => ({
    matchup: row.matchup,
    market,
    before: row.currentGrades[market],
    after: row.candidateGrades[market],
  })));
  console.log(JSON.stringify({
    release: "nfl_outcome_base_authority_current_audit_2026_11_05_r1",
    readOnly: true,
    writes: 0,
    season,
    week,
    games: rows.length,
    selectedSources: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.baseSource] = (counts[row.baseSource] ?? 0) + 1; return counts;
    }, {}),
    boardImpact: {
      actionableBefore: beforeActionables,
      actionableAfter: afterActionables,
      actionablePromotions: transitions.filter(row => !actionable(row.before?.grade) && actionable(row.after?.grade))
        .map(row => `${row.matchup}:${row.market}`),
      actionableDemotions: transitions.filter(row => actionable(row.before?.grade) && !actionable(row.after?.grade))
        .map(row => `${row.matchup}:${row.market}`),
    },
    authorityChangedGames: authorityChanges.map(row => row.matchup),
    authorityScopedGradeChanges: authorityChanges.flatMap(row =>
      row.gradeChanges.map(change => `${row.matchup}:${change}`)),
    changedGames: changes.length,
    sideChanges: changes.flatMap(row => row.sideChanges.map(market => `${row.matchup}:${market}`)),
    gradeChanges: rows.flatMap(row => row.gradeChanges.map(change => `${row.matchup}:${change}`)),
    rows,
  }, null, 2));
}

function evaluatedTargetSignature(production: ReturnType<typeof buildNflV1ActionableGradeBundle>): string {
  return JSON.stringify((["moneyline", "spread", "total"] as const).map(market => {
    const bet = production.evaluatedBets.find(row => row.market === market);
    return [market, bet?.evaluatedQuote.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null,
      bet?.evaluatedQuote.line ?? null];
  }));
}

function summarize(
  row: Omit<NflForwardStoredEvidence, "payload"> & { payload: NflForwardEvidencePayload },
  base: NflV1WeekOneOutcomeForecast,
  candidate: NflV1WeekOneOutcomeForecast,
  baseSource: string,
  selectedSources: Partial<Record<"moneyline" | "spread" | "total", string>>,
  candidateBets: NflForwardEvidencePayload["decisions"]["evaluatedBets"],
) {
  const current = row.payload.outcomeForecast;
  const sides = (forecast: NflV1WeekOneOutcomeForecast) => {
    const spread = row.payload.market.current.spread;
    const total = row.payload.market.current.total;
    if (!spread || !total) return { moneyline: null, spread: null, total: null };
    const p = nflV1WeekOneLineProbabilities({ forecast, homeSpread: spread.homeLine, totalLine: total.line });
    return {
      moneyline: forecast.homeWinProbability >= forecast.awayWinProbability ? "home" : "away",
      spread: p.spread.homeCoverProbability >= p.spread.awayCoverProbability ? "home" : "away",
      total: p.total.overProbability >= p.total.underProbability ? "over" : "under",
    };
  };
  const currentSides = sides(current);
  const candidateSides = sides(candidate);
  const sideChanges = (["moneyline", "spread", "total"] as const)
    .filter(market => currentSides[market] !== candidateSides[market]);
  const compact = (forecast: NflV1WeekOneOutcomeForecast) => ({
    away: Number(forecast.expectedAwayScore.toFixed(3)),
    home: Number(forecast.expectedHomeScore.toFixed(3)),
    homeMargin: Number((forecast.expectedHomeScore - forecast.expectedAwayScore).toFixed(3)),
    total: Number((forecast.expectedHomeScore + forecast.expectedAwayScore).toFixed(3)),
    sides: sides(forecast),
  });
  const currentCompact = compact(current);
  const candidateCompact = compact(candidate);
  const currentGrades = Object.fromEntries(row.payload.decisions.evaluatedBets.map(bet => [bet.market, {
    side: bet.side, grade: bet.grade, price: bet.evaluatedQuote.price,
  }])) as Record<string, { side: string; grade: string; price: number }>;
  const candidateGrades = Object.fromEntries(candidateBets.map(bet => [bet.market, {
    side: bet.side, grade: bet.grade, price: bet.evaluatedQuote.price,
  }])) as Record<string, { side: string; grade: string; price: number }>;
  const gradeChanges = (["moneyline", "spread", "total"] as const).flatMap(market => {
    const before = currentGrades[market];
    const after = candidateGrades[market];
    return before?.side === after?.side && before?.grade === after?.grade ? []
      : [`${market}:${before?.side ?? "missing"}/${before?.grade ?? "missing"}->${after?.side ?? "missing"}/${after?.grade ?? "missing"}`];
  });
  return {
    gameId: row.providerGameId,
    matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
    capturedAt: row.capturedAt,
    baseSource,
    selectedSources,
    scoreChanged: currentCompact.homeMargin !== candidateCompact.homeMargin || currentCompact.total !== candidateCompact.total,
    sideChanges,
    gradeChanges,
    current: currentCompact,
    selectedBase: compact(base),
    candidate: candidateCompact,
    currentGrades,
    candidateGrades,
  };
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
