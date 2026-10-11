#!/usr/bin/env tsx

/** Read-only, exact-input current-board replay for the CFB professional model release. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { fetchCfbCurrentAdvancedState } from "../../lib/services/football/cfbCurrentAdvancedState";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  buildCfbV1DecisionBundle,
  type CfbV1ExactPriceDecision,
  type CfbV1Forecast,
  type CfbV1Grade,
  type CfbV1Market,
} from "../../lib/services/football/cfbV1Decision";
import { getCfbV1WeeklyForecasts } from "../../lib/services/football/cfbV1WeeklyForecast";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { preferredCfbTargetBook, retainLatestCfbNamedBookMarkets } from "../../lib/services/football/cfbSharpApiOdds";
import {
  cfbMarketAnchorHealthHolds,
  publishCfbForwardDecisionBundle,
} from "../../lib/services/football/cfbForwardEvidenceWriter";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

const MARKETS: CfbV1Market[] = ["moneyline", "spread", "total"];
type AuditRow = {
  game: string;
  providerGameId: string;
  date: string;
  week: number;
  market: CfbV1Market;
  previous: ReturnType<typeof compact>;
  base: ReturnType<typeof compact>;
  candidate: ReturnType<typeof compact>;
  result: "win" | "loss" | "push" | null;
  independentResult: "win" | "loss" | "push" | null;
  competitionCohort: "both_fbs" | "fbs_fcs" | "both_fcs";
  profileHealth: "matched" | "neutral_imputation";
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const settledMode = process.argv.includes("--settled");
  const compactMode = process.argv.includes("--compact");
  const focusMatchups = new Set(process.argv.filter((value) => value.startsWith("--matchup=")).map((value) => value.slice(10).toUpperCase()));
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [rows, advanced] = await Promise.all([
    readCfbForwardEvidence({ client, season: 2026 }),
    fetchCfbCurrentAdvancedState({ season: 2026, now }),
  ]);
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (settledMode) {
      if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt) || !findOutcome(row.payload.game, advanced.games)) continue;
    } else if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const previous = latest.get(row.providerGameId);
    const rowT60 = row.stage === "t60";
    const previousT60 = previous?.stage === "t60";
    if (!previous || (rowT60 && !previousT60) || (rowT60 === previousT60 && Date.parse(row.capturedAt) > Date.parse(previous.capturedAt))) latest.set(row.providerGameId, row);
  }
  const selected = [...latest.values()].sort((a, b) => a.gameStartAt.localeCompare(b.gameStartAt));
  const forecasts = getCfbV1WeeklyForecasts({ games: selected.map((row) => row.payload.game), advancedGames: advanced.games });
  const comparisons: AuditRow[] = [];
  const coherenceFailures: string[] = [];

  for (const row of selected) {
    const payload = row.payload;
    const weekly = forecasts.get(payload.game.providerGameId);
    if (!weekly) throw new Error(`Missing forecast ${payload.game.providerGameId}.`);
    const historicalBooks = rows
      .filter((candidate) => candidate.providerGameId === row.providerGameId && Date.parse(candidate.capturedAt) <= Date.parse(payload.capturedAt))
      .flatMap((candidate) => candidate.payload.market.currentBooks);
    const currentBooks = retainLatestCfbNamedBookMarkets(payload.market.currentBooks, historicalBooks);
    const current = preferredCfbTargetBook(currentBooks);
    const anchor = resolveCfbCanonicalMarketAnchor({
      books: currentBooks,
      contextLines: {
        homeSpread: payload.market.playbookLine?.homeSpread ?? null,
        totalLine: payload.market.playbookLine?.total ?? null,
      },
    });
    const sharpSplits = payload.market.sharpApiSplits ?? [];
    const publicSplits = payload.market.playbookSplits;
    const priorSpreadSplits = rows
      .filter((candidate) => candidate.providerGameId === row.providerGameId && Date.parse(candidate.capturedAt) <= Date.parse(payload.capturedAt))
      .map((candidate) => candidate.payload.market.playbookSplits?.spread ?? null)
      .filter((split): split is NonNullable<typeof split> => split !== null);
    const operationalOpening = payload.market.operationalOpening;
    const weather = payload.availability.weather ?? null;
    const baseForecast = anchor ? buildCfbMarketSharpAwareForecast({
      independentForecast: weekly.forecast,
      anchor,
      current,
      operationalOpening,
      sharpSplits,
      playbookLine: payload.market.playbookLine,
      publicSplits,
      priorSpreadSplits,
      evaluatedAt: payload.capturedAt,
    }) : weekly.forecast;
    const forecast = anchor && weather && weather.independentTotalAdjustmentPoints < 0
      ? buildCfbMarketSharpAwareForecast({
          independentForecast: weekly.forecast,
          anchor,
          current,
          operationalOpening,
          sharpSplits,
          playbookLine: payload.market.playbookLine,
          publicSplits,
          priorSpreadSplits,
          kickoffWeather: weather,
          evaluatedAt: payload.capturedAt,
        })
      : baseForecast;
    const healthHolds = [
      ...(weekly.featureHealth.awayProfile === "neutral_imputation" ? ["away_model_team_profile_unavailable"] : []),
      ...(weekly.featureHealth.homeProfile === "neutral_imputation" ? ["home_model_team_profile_unavailable"] : []),
      ...cfbMarketAnchorHealthHolds(anchor),
    ];
    const fixedEvaluatedSportsbookByMarket = anchor && weather && weather.independentTotalAdjustmentPoints < 0
      ? Object.fromEntries(applyCfbMarketSharpAwareGrades({
          bundle: buildCfbV1DecisionBundle({
            providerGameId: payload.game.providerGameId,
            awayTeam: payload.game.away.abbreviation,
            homeTeam: payload.game.home.abbreviation,
            gameStartsAt: payload.game.scheduledStart,
            comparableCurrentBooks: currentBooks,
            evaluatedAt: payload.capturedAt,
            healthHolds,
            forecast: baseForecast,
            contextLines: { homeSpread: payload.market.playbookLine?.homeSpread ?? null, totalLine: payload.market.playbookLine?.total ?? null },
          }),
          homeTeam: payload.game.home.abbreviation,
          sharpSplits,
          playbookLine: payload.market.playbookLine,
          publicSplits,
          operationalOpening,
          current,
        }).evaluatedBets.map((decision) => [decision.market, decision.evaluatedQuote.sportsbook]))
      : undefined;
    const rawBundle = buildCfbV1DecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      comparableCurrentBooks: currentBooks,
      evaluatedAt: payload.capturedAt,
      healthHolds,
      forecast,
      contextLines: { homeSpread: payload.market.playbookLine?.homeSpread ?? null, totalLine: payload.market.playbookLine?.total ?? null },
      fixedEvaluatedSportsbookByMarket,
    });
    const candidate = publishCfbForwardDecisionBundle(anchor ? applyCfbMarketSharpAwareGrades({
      bundle: rawBundle,
      homeTeam: payload.game.home.abbreviation,
      sharpSplits,
      playbookLine: payload.market.playbookLine,
      publicSplits,
      operationalOpening,
      current,
    }) : rawBundle, payload.market.playbookLine, payload.market.espnReferenceLine ?? null, {
      spread: preferredCfbTargetBook(currentBooks.filter((book) => book.spread !== null)),
      total: preferredCfbTargetBook(currentBooks.filter((book) => book.total !== null)),
    });
    if (Math.abs(candidate.forecast.expectedHomePoints + candidate.forecast.expectedAwayPoints - forecast.expectedTotal) > 1e-8) {
      coherenceFailures.push(payload.game.providerGameId);
    }
    const previous = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const base = new Map(rawBundle.evaluatedBets.map((decision) => [decision.market, decision]));
    const currentDecisions = new Map(candidate.evaluatedBets.map((decision) => [decision.market, decision]));
    const outcome = findOutcome(payload.game, advanced.games);
    for (const market of MARKETS) comparisons.push({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      providerGameId: payload.game.providerGameId,
      date: easternDate(payload.game.scheduledStart),
      week: payload.game.providerWeek,
      market,
      previous: compact(previous.get(market)),
      base: compact(base.get(market)),
      candidate: compact(currentDecisions.get(market)),
      result: settle(currentDecisions.get(market), payload.game.home.abbreviation, outcome),
      independentResult: settleIndependent(currentDecisions.get(market), weekly.forecast, payload.game.home.abbreviation, outcome),
      competitionCohort: payload.game.away.fbs && payload.game.home.fbs
        ? "both_fbs"
        : payload.game.away.fbs || payload.game.home.fbs
          ? "fbs_fcs"
          : "both_fcs",
      profileHealth: weekly.featureHealth.awayProfile === "matched" && weekly.featureHealth.homeProfile === "matched"
        ? "matched"
        : "neutral_imputation",
    });
  }

  const promotions = comparisons.filter((row) => rank(row.candidate?.grade) > rank(row.previous?.grade));
  const demotions = comparisons.filter((row) => rank(row.candidate?.grade) < rank(row.previous?.grade));
  const sideChanges = comparisons.filter((row) => row.previous?.side && row.candidate?.side && row.previous.side !== row.candidate.side);
  const priorActionable = comparisons.filter((row) => actionable(row.previous?.grade)).length;
  const candidateActionable = comparisons.filter((row) => actionable(row.candidate?.grade)).length;
  const resultSummary = summarizeResults(comparisons);
  console.log(JSON.stringify({
    release: "cfb_professional_market_marriage_current_board_audit_2026_10_01_r15",
    readOnly: true,
    providerRequests: 6,
    writes: 0,
    games: selected.length,
    markets: comparisons.length,
    advancedGames: advanced.games.length,
    previousGradeCounts: gradeCounts(comparisons.map((row) => row.previous?.grade)),
    candidateGradeCounts: gradeCounts(comparisons.map((row) => row.candidate?.grade)),
    priorActionable,
    candidateActionable,
    actionableDelta: candidateActionable - priorActionable,
    promotions: promotions.length,
    demotions: demotions.length,
    sideChanges: sideChanges.length,
    coherenceFailures,
    ...(compactMode ? {
      focusRows: comparisons.filter((row) => focusMatchups.has(row.game.toUpperCase())),
    } : {}),
    ...(settledMode ? {
      resultSummary,
      selectionWeeks1to2: summarizeResults(comparisons.filter((row) => row.week <= 2)),
      confirmationWeeks3to4: summarizeResults(comparisons.filter((row) => row.week >= 3 && row.week <= 4)),
      calibrationDiagnostics: summarizeCalibrationDiagnostics(comparisons),
      tierCandidates: summarizeTierCandidates(comparisons),
      gradeAuthorityCandidates: summarizeGradeAuthorityCandidates(comparisons),
      actionabilityGrid: summarizeActionabilityGrid(comparisons),
      rootCauseCohorts: summarizeRootCauseCohorts(comparisons),
    } : compactMode ? {} : {
      promotionRows: promotions,
      demotionRows: demotions,
      sideChangeRows: sideChanges,
    }),
  }, null, 2));
}

function compact(decision: CfbV1ExactPriceDecision | undefined) {
  return decision ? {
    side: decision.side,
    grade: decision.grade,
    line: decision.evaluatedQuote.line,
    price: decision.evaluatedQuote.price,
    book: decision.evaluatedQuote.sportsbook,
    modelProbability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    expectedValue: decision.expectedValue,
    probabilityGrade: decision.probabilityGrade,
    confidenceScore: decision.gradeAdjustment?.confidenceScore ?? null,
    confidenceAdjustment: decision.gradeAdjustment?.confidenceAdjustment ?? null,
    sharpDirection: decision.gradeAdjustment?.sharpDirection ?? "unknown",
    publicDirection: decision.gradeAdjustment?.publicDirection ?? "unknown",
    movementDirection: decision.gradeAdjustment?.movementDirection ?? "unknown",
    executionStatus: decision.gradeAdjustment?.executionStatus ?? null,
    reasonCodes: decision.gradeAdjustment?.reasonCodes ?? [],
  } : null;
}

function easternDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function rank(grade: CfbV1Grade | undefined): number { return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 : grade === "No Play" ? 1 : 0; }
function actionable(grade: CfbV1Grade | undefined): boolean { return grade === "Best Angle" || grade === "Lean"; }
function gradeCounts(grades: Array<CfbV1Grade | undefined>) {
  return grades.reduce<Record<string, number>>((counts, grade) => {
    const key = grade ?? "Held";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function findOutcome(game: { scheduledStart: string; home: { name: string }; away: { name: string } }, outcomes: Awaited<ReturnType<typeof fetchCfbCurrentAdvancedState>>["games"]) {
  const home = normalizeName(game.home.name);
  const away = normalizeName(game.away.name);
  return outcomes.find((outcome) =>
    normalizeName(outcome.homeTeam) === home && normalizeName(outcome.awayTeam) === away &&
    Math.abs(Date.parse(outcome.scheduledStart) - Date.parse(game.scheduledStart)) <= 18 * 3_600_000) ?? null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function settle(decision: CfbV1ExactPriceDecision | undefined, homeTeam: string, outcome: Awaited<ReturnType<typeof fetchCfbCurrentAdvancedState>>["games"][number] | null): "win" | "loss" | "push" | null {
  if (!decision || !outcome) return null;
  let value: number;
  if (decision.market === "moneyline") value = decision.side === homeTeam ? outcome.homeScore - outcome.awayScore : outcome.awayScore - outcome.homeScore;
  else if (decision.market === "spread") {
    if (decision.evaluatedQuote.line === null) return null;
    value = decision.side.startsWith(homeTeam)
      ? outcome.homeScore + decision.evaluatedQuote.line - outcome.awayScore
      : outcome.awayScore + decision.evaluatedQuote.line - outcome.homeScore;
  } else {
    if (decision.evaluatedQuote.line === null) return null;
    const delta = outcome.homeScore + outcome.awayScore - decision.evaluatedQuote.line;
    value = /^over\b/i.test(decision.side) ? delta : -delta;
  }
  return Math.abs(value) < 1e-9 ? "push" : value > 0 ? "win" : "loss";
}

function settleIndependent(
  decision: CfbV1ExactPriceDecision | undefined,
  forecast: CfbV1Forecast,
  homeTeam: string,
  outcome: Awaited<ReturnType<typeof fetchCfbCurrentAdvancedState>>["games"][number] | null,
): "win" | "loss" | "push" | null {
  if (!decision || !outcome) return null;
  const home = decision.side.startsWith(homeTeam);
  const homeSpread = decision.market === "spread" ? (home ? decision.evaluatedQuote.line! : -decision.evaluatedQuote.line!) : null;
  const selectedSide = decision.market === "moneyline"
    ? forecast.expectedMarginHome >= 0 ? homeTeam : "away"
    : decision.market === "spread"
      ? forecast.expectedMarginHome + homeSpread! >= 0
        ? homeTeam
        : "away"
      : forecast.expectedTotal >= decision.evaluatedQuote.line! ? "Over" : "Under";
  const selectedHome = selectedSide === homeTeam;
  const independentLine = decision.market === "spread"
    ? selectedHome ? homeSpread! : -homeSpread!
    : decision.evaluatedQuote.line;
  const independentDecision = {
    ...decision,
    evaluatedQuote: { ...decision.evaluatedQuote, line: independentLine },
    side: decision.market === "total"
      ? `${selectedSide} ${decision.evaluatedQuote.line}`
      : selectedSide === homeTeam
        ? `${homeTeam}${decision.market === "spread" ? ` ${independentLine}` : ""}`
        : `away${decision.market === "spread" ? ` ${independentLine}` : ""}`,
  };
  return settle(independentDecision, homeTeam, outcome);
}

function summarizeResults(rows: AuditRow[]) {
  const summarize = (subset: AuditRow[]) => {
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const pushes = subset.filter((row) => row.result === "push").length;
    return { rows: subset.length, wins, losses, pushes, decided: wins + losses, accuracy: wins + losses > 0 ? wins / (wins + losses) : null };
  };
  return {
    all: summarize(rows.filter((row) => row.result !== null)),
    actionable: summarize(rows.filter((row) => actionable(row.candidate?.grade) && row.result !== null)),
    bestAngle: summarize(rows.filter((row) => row.candidate?.grade === "Best Angle" && row.result !== null)),
    lean: summarize(rows.filter((row) => row.candidate?.grade === "Lean" && row.result !== null)),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(rows.filter((row) => row.market === market && row.result !== null))])),
    actionableByMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(rows.filter((row) => row.market === market && actionable(row.candidate?.grade) && row.result !== null))])),
  };
}

function summarizeCalibrationDiagnostics(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.result !== null && row.candidate !== null);
  const summarize = (subset: AuditRow[]) => {
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const pushes = subset.filter((row) => row.result === "push").length;
    const decided = wins + losses;
    const units = subset.reduce((sum, row) => {
      if (row.result === "push") return sum;
      if (row.result === "loss") return sum - 1;
      const price = row.candidate?.price ?? -110;
      return sum + (price < 0 ? 100 / Math.abs(price) : price / 100);
    }, 0);
    return {
      rows: subset.length,
      games: new Set(subset.map((row) => row.providerGameId)).size,
      wins,
      losses,
      pushes,
      accuracy: decided ? wins / decided : null,
      units,
      roi: decided ? units / decided : null,
    };
  };
  const by = (key: (row: AuditRow) => string) => Object.fromEntries(
    [...new Set(settled.map(key))].sort().map((value) => [value, summarize(settled.filter((row) => key(row) === value))]),
  );
  const confidenceBand = (row: AuditRow) => {
    const score = row.candidate?.confidenceScore;
    if (score === null || score === undefined) return "unknown";
    if (score < 51.5) return "<51.5";
    if (score < 55) return "51.5-54.99";
    if (score < 57.5) return "55-57.49";
    if (score < 60) return "57.5-59.99";
    if (score < 62.5) return "60-62.49";
    return ">=62.5";
  };
  const evidencePattern = (row: AuditRow) => [
    row.candidate?.sharpDirection ?? "unknown",
    row.candidate?.publicDirection ?? "unknown",
    row.candidate?.movementDirection ?? "unknown",
  ].join("/");
  return {
    byConfidenceBand: by(confidenceBand),
    byGradeMarket: by((row) => `${row.candidate?.grade}:${row.market}`),
    byGradeEvidence: by((row) => `${row.candidate?.grade}:${evidencePattern(row)}`),
    selectionByGrade: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade,
      summarize(settled.filter((row) => row.week <= 2 && row.candidate?.grade === grade))])),
    confirmationByGrade: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade,
      summarize(settled.filter((row) => row.week >= 3 && row.week <= 4 && row.candidate?.grade === grade))])),
  };
}

type TierCandidate = {
  name: string;
  moneylineProbability: number;
  spreadProbability: number;
  totalProbability: number;
  requireNoResistance: boolean;
  requireSupportForSpreadTotal: boolean;
};

function summarizeTierCandidates(rows: AuditRow[]) {
  const candidates: TierCandidate[] = [
    { name: "p65_all_markets", moneylineProbability: 0.65, spreadProbability: 0.65, totalProbability: 0.65, requireNoResistance: false, requireSupportForSpreadTotal: false },
    { name: "p60_no_resistance", moneylineProbability: 0.60, spreadProbability: 0.60, totalProbability: 0.60, requireNoResistance: true, requireSupportForSpreadTotal: false },
    { name: "market_65_60_60_no_resistance", moneylineProbability: 0.65, spreadProbability: 0.60, totalProbability: 0.60, requireNoResistance: true, requireSupportForSpreadTotal: false },
    { name: "market_65_60_60_supported_spread_total", moneylineProbability: 0.65, spreadProbability: 0.60, totalProbability: 0.60, requireNoResistance: true, requireSupportForSpreadTotal: true },
    { name: "market_625_60_60_no_resistance", moneylineProbability: 0.625, spreadProbability: 0.60, totalProbability: 0.60, requireNoResistance: true, requireSupportForSpreadTotal: false },
    { name: "market_675_625_625_no_resistance", moneylineProbability: 0.675, spreadProbability: 0.625, totalProbability: 0.625, requireNoResistance: true, requireSupportForSpreadTotal: false },
  ];
  return Object.fromEntries(candidates.map((candidate) => [candidate.name, {
    policy: candidate,
    selection: summarizeTierCandidate(rows.filter((row) => row.week <= 2), candidate),
    confirmation: summarizeTierCandidate(rows.filter((row) => row.week >= 3 && row.week <= 4), candidate),
  }]));
}

function summarizeTierCandidate(rows: AuditRow[], policy: TierCandidate) {
  const actionableRows = rows.filter((row) => actionable(row.candidate?.grade) && row.result !== null && row.candidate !== null);
  const candidateGrade = (row: AuditRow): CfbV1Grade => {
    const decision = row.candidate!;
    const threshold = row.market === "moneyline"
      ? policy.moneylineProbability
      : row.market === "spread"
        ? policy.spreadProbability
        : policy.totalProbability;
    const directions = [decision.sharpDirection, decision.publicDirection, decision.movementDirection];
    const noResistance = !directions.includes("resistance");
    const hasSupport = directions.includes("support");
    const qualifies = decision.modelProbability >= threshold
      && (!policy.requireNoResistance || noResistance)
      && (!policy.requireSupportForSpreadTotal || row.market === "moneyline" || hasSupport);
    return qualifies ? "Best Angle" : "Lean";
  };
  const summarize = (subset: AuditRow[]) => {
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const pushes = subset.filter((row) => row.result === "push").length;
    const decided = wins + losses;
    const units = subset.reduce((sum, row) => {
      if (row.result === "push") return sum;
      if (row.result === "loss") return sum - 1;
      const price = row.candidate?.price ?? -110;
      return sum + (price < 0 ? 100 / Math.abs(price) : price / 100);
    }, 0);
    return { rows: subset.length, wins, losses, pushes, accuracy: decided ? wins / decided : null, units, roi: decided ? units / decided : null };
  };
  const best = actionableRows.filter((row) => candidateGrade(row) === "Best Angle");
  const lean = actionableRows.filter((row) => candidateGrade(row) === "Lean");
  return {
    actionable: summarize(actionableRows),
    bestAngle: summarize(best),
    lean: summarize(lean),
    promotions: actionableRows.filter((row) => row.candidate?.grade === "Lean" && candidateGrade(row) === "Best Angle").length,
    demotions: actionableRows.filter((row) => row.candidate?.grade === "Best Angle" && candidateGrade(row) === "Lean").length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, {
      bestAngle: summarize(best.filter((row) => row.market === market)),
      lean: summarize(lean.filter((row) => row.market === market)),
    }])),
  };
}

type GradeAuthorityPolicy = "current" | "base" | "base_plus_supported_promotion" | "base_plus_multichannel_promotion";

function summarizeGradeAuthorityCandidates(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.result !== null && row.candidate !== null);
  const policies: GradeAuthorityPolicy[] = [
    "current",
    "base",
    "base_plus_supported_promotion",
    "base_plus_multichannel_promotion",
  ];
  const segments = {
    selection: (row: AuditRow) => row.date <= "2026-09-20",
    confirmation: (row: AuditRow) => row.date >= "2026-09-21" && row.date <= "2026-10-04",
    preCrisisHoldout: (row: AuditRow) => row.date >= "2026-10-05" && row.date <= "2026-10-09",
    october10Holdout: (row: AuditRow) => row.date >= "2026-10-10",
  };
  return Object.fromEntries(policies.map((policy) => [policy, {
    all: gradeAuthorityMetrics(settled, policy),
    segments: Object.fromEntries(Object.entries(segments).map(([name, eligible]) => [
      name,
      gradeAuthorityMetrics(settled.filter(eligible), policy),
    ])),
  }]));
}

function gradeAuthorityEligible(row: AuditRow, policy: GradeAuthorityPolicy): boolean {
  const currentActionable = actionable(row.candidate?.grade);
  if (policy === "current") return currentActionable;
  const baseActionable = actionable(row.base?.grade);
  if (policy === "base") return baseActionable;
  if (baseActionable) return true;
  if (!currentActionable || !row.candidate) return false;

  const directions = [
    row.candidate.sharpDirection,
    row.candidate.publicDirection,
    row.candidate.movementDirection,
  ];
  const support = directions.filter((direction) => direction === "support").length;
  const resistance = directions.filter((direction) => direction === "resistance").length;
  const reasonCodes = row.candidate.reasonCodes;
  const explicitPromotion = reasonCodes.includes("balanced_positive_value_promotion")
    || reasonCodes.includes("moneyline_market_confirmed_favorite_lean");
  if (!explicitPromotion || resistance > 0) return false;
  return policy === "base_plus_supported_promotion" ? support >= 1 : support >= 2;
}

function gradeAuthorityMetrics(rows: AuditRow[], policy: GradeAuthorityPolicy) {
  const selected = rows.filter((row) => gradeAuthorityEligible(row, policy));
  const summarize = (subset: AuditRow[]) => {
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const pushes = subset.filter((row) => row.result === "push").length;
    const decided = wins + losses;
    const units = subset.reduce((sum, row) => {
      if (row.result === "push") return sum;
      if (row.result === "loss") return sum - 1;
      const price = row.candidate?.price ?? -110;
      return sum + (price < 0 ? 100 / Math.abs(price) : price / 100);
    }, 0);
    return {
      rows: subset.length,
      wins,
      losses,
      pushes,
      accuracy: decided > 0 ? wins / decided : null,
      units,
      roi: decided > 0 ? units / decided : null,
    };
  };
  return {
    actionable: summarize(selected),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(selected.filter((row) => row.market === market))])),
    promotions: rows.filter((row) => !actionable(row.candidate?.grade) && gradeAuthorityEligible(row, policy)).length,
    demotions: rows.filter((row) => actionable(row.candidate?.grade) && !gradeAuthorityEligible(row, policy)).length,
  };
}

type ActionabilityGridPolicy = {
  market: CfbV1Market;
  probability: number;
  edgePp: number;
  expectedValue: number;
  support: number;
  resistance: number;
  maximumAbsLine: number | null;
};

function summarizeActionabilityGrid(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.result !== null && row.candidate !== null);
  const values = {
    probability: [0.52, 0.54, 0.55, 0.56, 0.575, 0.60, 0.625, 0.65, 0.675],
    edgePp: [0, 2, 3, 4, 5, 7.5, 10],
    expectedValue: [0, 0.01, 0.02, 0.03, 0.05, 0.075, 0.10],
    support: [0, 1, 2],
    resistance: [0, 1],
  };
  return Object.fromEntries(MARKETS.map((market) => {
    const maximumAbsLines = market === "spread" ? [10, 17, 24, null] : [null];
    const policies: ActionabilityGridPolicy[] = [];
    for (const probability of values.probability)
      for (const edgePp of values.edgePp)
        for (const expectedValue of values.expectedValue)
          for (const support of values.support)
            for (const resistance of values.resistance)
              for (const maximumAbsLine of maximumAbsLines)
                policies.push({ market, probability, edgePp, expectedValue, support, resistance, maximumAbsLine });

    const selectionRows = settled.filter((row) => row.market === market && row.date <= "2026-09-20");
    const confirmationRows = settled.filter((row) => row.market === market && row.date >= "2026-09-21" && row.date <= "2026-10-04");
    const minimum = market === "moneyline" ? 8 : 16;
    const evaluated = policies.flatMap((policy) => {
      const selection = actionabilityGridMetrics(selectionRows, policy);
      const confirmation = actionabilityGridMetrics(confirmationRows, policy);
      if (selection.rows < minimum || confirmation.rows < minimum) return [];
      return [{
        policy,
        selection,
        confirmation,
        robustRoi: Math.min(selection.roi ?? -Infinity, confirmation.roi ?? -Infinity),
        developmentRoi: ((selection.units + confirmation.units) / Math.max(1, selection.decided + confirmation.decided)),
      }];
    }).sort((left, right) =>
      right.robustRoi - left.robustRoi ||
      right.developmentRoi - left.developmentRoi ||
      (right.selection.rows + right.confirmation.rows) - (left.selection.rows + left.confirmation.rows));

    const deduped = [...new Map(evaluated.map((entry) => [
      [entry.policy.probability, entry.policy.edgePp, entry.policy.expectedValue, entry.policy.support, entry.policy.resistance, entry.policy.maximumAbsLine].join("|"),
      entry,
    ])).values()].slice(0, 12).map((entry) => ({
      ...entry,
      preCrisisHoldout: actionabilityGridMetrics(
        settled.filter((row) => row.market === market && row.date >= "2026-10-05" && row.date <= "2026-10-09"),
        entry.policy,
      ),
      october10Holdout: actionabilityGridMetrics(
        settled.filter((row) => row.market === market && row.date >= "2026-10-10"),
        entry.policy,
      ),
      boardImpact: actionabilityGridBoardImpact(settled.filter((row) => row.market === market), entry.policy),
    }));
    return [market, deduped];
  }));
}

function actionabilityGridEligible(row: AuditRow, policy: ActionabilityGridPolicy): boolean {
  const decision = row.candidate;
  if (!decision || decision.executionStatus !== "bet") return false;
  const edgePp = 100 * (decision.modelProbability - decision.marketFairProbability);
  const directions = [decision.sharpDirection, decision.publicDirection, decision.movementDirection];
  const support = directions.filter((direction) => direction === "support").length;
  const resistance = directions.filter((direction) => direction === "resistance").length;
  if (decision.modelProbability < policy.probability || edgePp < policy.edgePp || decision.expectedValue < policy.expectedValue) return false;
  if (support < policy.support || resistance > policy.resistance) return false;
  if (policy.market === "moneyline") return decision.price >= -700 && decision.price <= 500;
  if (decision.price < -140 || decision.price > 140) return false;
  return policy.maximumAbsLine === null || decision.line === null || Math.abs(decision.line) <= policy.maximumAbsLine;
}

function actionabilityGridMetrics(rows: AuditRow[], policy: ActionabilityGridPolicy) {
  const selected = rows.filter((row) => actionabilityGridEligible(row, policy));
  const wins = selected.filter((row) => row.result === "win").length;
  const losses = selected.filter((row) => row.result === "loss").length;
  const pushes = selected.filter((row) => row.result === "push").length;
  const decided = wins + losses;
  const units = selected.reduce((sum, row) => {
    if (row.result === "push") return sum;
    if (row.result === "loss") return sum - 1;
    const price = row.candidate?.price ?? -110;
    return sum + (price < 0 ? 100 / Math.abs(price) : price / 100);
  }, 0);
  return { rows: selected.length, wins, losses, pushes, decided, units, roi: decided > 0 ? units / decided : null };
}

function actionabilityGridBoardImpact(rows: AuditRow[], policy: ActionabilityGridPolicy) {
  return {
    incumbentActionable: rows.filter((row) => actionable(row.candidate?.grade)).length,
    candidateActionable: rows.filter((row) => actionabilityGridEligible(row, policy)).length,
    promotions: rows.filter((row) => !actionable(row.candidate?.grade) && actionabilityGridEligible(row, policy)).length,
    demotions: rows.filter((row) => actionable(row.candidate?.grade) && !actionabilityGridEligible(row, policy)).length,
  };
}

function summarizeRootCauseCohorts(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.result !== null && row.independentResult !== null);
  const summarizeSet = (selected: AuditRow[]) => Object.fromEntries(MARKETS.map((market) => [
    market,
    rootCauseMetrics(selected.filter((row) => row.market === market)),
  ]));
  const cohorts = ["both_fbs", "fbs_fcs", "both_fcs"] as const;
  const health = ["matched", "neutral_imputation"] as const;
  return {
    all: summarizeSet(settled),
    october10: summarizeSet(settled.filter((row) => row.date >= "2026-10-10")),
    byCompetition: Object.fromEntries(cohorts.map((cohort) => [cohort, {
      all: summarizeSet(settled.filter((row) => row.competitionCohort === cohort)),
      october10: summarizeSet(settled.filter((row) => row.competitionCohort === cohort && row.date >= "2026-10-10")),
    }])),
    byProfileHealth: Object.fromEntries(health.map((state) => [state, {
      all: summarizeSet(settled.filter((row) => row.profileHealth === state)),
      october10: summarizeSet(settled.filter((row) => row.profileHealth === state && row.date >= "2026-10-10")),
    }])),
  };
}

function rootCauseMetrics(rows: AuditRow[]) {
  const finalWins = rows.filter((row) => row.result === "win").length;
  const finalLosses = rows.filter((row) => row.result === "loss").length;
  const finalPushes = rows.filter((row) => row.result === "push").length;
  const independentWins = rows.filter((row) => row.independentResult === "win").length;
  const independentLosses = rows.filter((row) => row.independentResult === "loss").length;
  const independentPushes = rows.filter((row) => row.independentResult === "push").length;
  const actionableRows = rows.filter((row) => actionable(row.candidate?.grade));
  const actionableWins = actionableRows.filter((row) => row.result === "win").length;
  const actionableLosses = actionableRows.filter((row) => row.result === "loss").length;
  const actionablePushes = actionableRows.filter((row) => row.result === "push").length;
  const units = actionableRows.reduce((sum, row) => {
    if (row.result === "push") return sum;
    if (row.result === "loss") return sum - 1;
    const price = row.candidate?.price ?? -110;
    return sum + (price < 0 ? 100 / Math.abs(price) : price / 100);
  }, 0);
  return {
    rows: rows.length,
    independent: { wins: independentWins, losses: independentLosses, pushes: independentPushes },
    final: { wins: finalWins, losses: finalLosses, pushes: finalPushes },
    corrections: rows.filter((row) => row.independentResult === "loss" && row.result === "win").length,
    harms: rows.filter((row) => row.independentResult === "win" && row.result === "loss").length,
    actionable: {
      rows: actionableRows.length,
      wins: actionableWins,
      losses: actionableLosses,
      pushes: actionablePushes,
      units,
      roi: actionableWins + actionableLosses > 0 ? units / (actionableWins + actionableLosses) : null,
    },
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
