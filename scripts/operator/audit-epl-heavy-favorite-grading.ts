import { BallDontLieEplProvider } from "../../lib/providers/real_api/BallDontLieEplProvider";
import { deriveEplMatchResultDecision } from "../../lib/services/epl/eplPreviewGrade";
import { fitEplShadowModel, joinEplMatchStats, predictEplMatch, type EplTrainingMatch } from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type Partition = "validation" | "holdout";
type Row = {
  partition: Partition;
  outcome: Side;
  model: Record<Side, number>;
  market: Record<Side, number>;
  decimal: Record<Side, number>;
  american: Record<Side, number>;
  forecastSide: Side;
  probability: number;
  edgePp: number;
  expectedValue: number;
  limited: boolean;
  currentGrade: string;
};

type PromotionRule = { probabilityFloor: number; edgeFloor: number; evFloor: number; plusMoneyOnly: boolean };

const CONFIG = { halfLifeDays: 365, shrinkageMatches: 4, xgWeight: 0.35, dixonColesTau: -0.1 };
const SIDES = ["home", "draw", "away"] as const;
const safeLog = (value: number) => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, value)));

function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(value); value = "";
      if (row.some(Boolean)) lines.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); lines.push(row); }
  const header = lines.shift()!.map((item) => item.replace(/^\uFEFF/, ""));
  return lines.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

function canonicalTeam(name: string): string {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    mancity: "manchestercity", manunited: "manchesterunited", nottmforest: "nottinghamforest",
    wolves: "wolverhamptonwanderers", brighton: "brightonandhovealbion", tottenham: "tottenhamhotspur",
    newcastle: "newcastleunited", leeds: "leedsunited", westham: "westhamunited", sheffieldunited: "sheffutd",
  };
  return aliases[base] ?? base;
}

function positive(row: Record<string, string>, key: string): number | null {
  const value = Number(row[key]);
  return Number.isFinite(value) && value > 1 ? value : null;
}

function american(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function noVig(decimal: Record<Side, number>): Record<Side, number> {
  const raw = Object.fromEntries(SIDES.map((side) => [side, 1 / decimal[side]])) as Record<Side, number>;
  const sum = SIDES.reduce((total, side) => total + raw[side], 0);
  return Object.fromEntries(SIDES.map((side) => [side, raw[side] / sum])) as Record<Side, number>;
}

function maxSide(probabilities: Record<Side, number>): Side {
  return SIDES.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function selectionMetrics(rows: Row[]) {
  const wins = rows.filter((row) => row.forecastSide === row.outcome).length;
  const units = rows.reduce((sum, row) => sum + (row.forecastSide === row.outcome ? row.decimal[row.forecastSide] - 1 : -1), 0);
  const meanProbability = rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : null;
  const accuracy = rows.length ? wins / rows.length : null;
  return {
    n: rows.length,
    wins,
    losses: rows.length - wins,
    accuracy,
    meanProbability,
    calibrationGapPp: accuracy === null || meanProbability === null ? null : (accuracy - meanProbability) * 100,
    units,
    roi: rows.length ? units / rows.length : null,
    meanPrice: rows.length ? rows.reduce((sum, row) => sum + row.american[row.forecastSide], 0) / rows.length : null,
    meanEv: rows.length ? rows.reduce((sum, row) => sum + row.expectedValue, 0) / rows.length : null,
  };
}

function probabilityMetrics(rows: Row[]) {
  return {
    n: rows.length,
    accuracy: rows.filter((row) => maxSide(row.model) === row.outcome).length / rows.length,
    brier: rows.reduce((sum, row) => sum + SIDES.reduce((value, side) => value + (row.model[side] - Number(side === row.outcome)) ** 2, 0), 0) / rows.length,
    logLoss: rows.reduce((sum, row) => sum - safeLog(row.model[row.outcome]), 0) / rows.length,
    marketAccuracy: rows.filter((row) => maxSide(row.market) === row.outcome).length / rows.length,
    marketBrier: rows.reduce((sum, row) => sum + SIDES.reduce((value, side) => value + (row.market[side] - Number(side === row.outcome)) ** 2, 0), 0) / rows.length,
    marketLogLoss: rows.reduce((sum, row) => sum - safeLog(row.market[row.outcome]), 0) / rows.length,
  };
}

function heavyFavorite(row: Row): boolean {
  const marketFavorite = maxSide(row.market);
  const price = row.american[row.forecastSide];
  return marketFavorite === row.forecastSide
    && price <= -300
    && (row.probability >= 0.7 || (!row.limited && row.probability >= 0.65));
}

function promotionEligible(row: Row, rule: PromotionRule): boolean {
  if (row.currentGrade === "Lean" || row.currentGrade === "Best Angle" || row.limited) return false;
  const price = row.american[row.forecastSide];
  const maxGap = Math.max(...SIDES.map((side) => Math.abs(row.model[side] - row.market[side]))) * 100;
  return price > -300
    && (!rule.plusMoneyOnly || price >= 100)
    && maxGap <= 20
    && row.probability >= rule.probabilityFloor
    && row.edgePp >= rule.edgeFloor
    && row.expectedValue >= rule.evFloor;
}

function gradeMix(rows: Row[]) {
  return rows.reduce<Record<string, number>>((mix, row) => {
    mix[row.currentGrade] = (mix[row.currentGrade] ?? 0) + 1;
    return mix;
  }, {});
}

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieEplProvider(key);
  const seasons = [2022, 2023, 2024, 2025] as const;
  const [matchLists, teams, csvTexts] = await Promise.all([
    Promise.all(seasons.map((season) => provider.listMatches({ season }))),
    Promise.all(seasons.map((season) => provider.listTeams(season))),
    Promise.all(["2223", "2324", "2425", "2526"].map(async (code) => {
      const response = await fetch(`https://www.football-data.co.uk/mmz4281/${code}/E0.csv`);
      if (!response.ok) throw new Error(`Football-Data ${code}: ${response.status}`);
      return response.text();
    })),
  ]);
  const finals = matchLists.flat().filter((match) => match.status_state === "final");
  const stats = await provider.listTeamMatchStats(finals.map((match) => match.id));
  const joined = joinEplMatchStats(finals, stats).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const teamNames = new Map(teams.flat().map((team) => [team.id, team.name]));
  const csvByKey = new Map<string, Record<string, string>>();
  csvTexts.forEach((text, index) => parseCsv(text).forEach((row) => {
    csvByKey.set(`${seasons[index]}:${canonicalTeam(row.HomeTeam)}:${canonicalTeam(row.AwayTeam)}`, row);
  }));

  const rows: Row[] = [];
  for (let index = 0; index < joined.length; index++) {
    const match = joined[index]!;
    if (match.season !== 2024 && match.season !== 2025) continue;
    const history = joined.slice(0, index) as EplTrainingMatch[];
    const prediction = predictEplMatch(fitEplShadowModel(history, match.date, CONFIG), match.home_team_id, match.away_team_id);
    const csv = csvByKey.get(`${match.season}:${canonicalTeam(teamNames.get(match.home_team_id) ?? "")}:${canonicalTeam(teamNames.get(match.away_team_id) ?? "")}`);
    if (!csv) continue;
    const home = positive(csv, "AvgH"), draw = positive(csv, "AvgD"), away = positive(csv, "AvgA");
    if (!home || !draw || !away) continue;
    const decimal = { home, draw, away };
    const market = noVig(decimal);
    const model = { home: prediction.probabilities.home, draw: prediction.probabilities.draw, away: prediction.probabilities.away };
    const prices = { home: american(home), draw: american(draw), away: american(away) };
    const forecastSide = maxSide(model);
    const decision = deriveEplMatchResultDecision({ model, market, prices, promotedProxy: prediction.confidence === "limited" });
    const probability = model[forecastSide];
    const edgePp = (model[forecastSide] - market[forecastSide]) * 100;
    rows.push({
      partition: match.season === 2024 ? "validation" : "holdout",
      outcome: match.home_score! > match.away_score! ? "home" : match.home_score! < match.away_score! ? "away" : "draw",
      model,
      market,
      decimal,
      american: prices,
      forecastSide,
      probability,
      edgePp,
      expectedValue: probability * decimal[forecastSide] - 1,
      limited: prediction.confidence === "limited",
      currentGrade: decision.grade.verdict.label,
    });
  }

  const validation = rows.filter((row) => row.partition === "validation");
  const holdout = rows.filter((row) => row.partition === "holdout");
  const rules: PromotionRule[] = [];
  for (const probabilityFloor of [0.35, 0.4, 0.45, 0.5]) for (const edgeFloor of [2, 3, 4, 5]) for (const evFloor of [0, 0.02, 0.05]) for (const plusMoneyOnly of [false, true]) {
    rules.push({ probabilityFloor, edgeFloor, evFloor, plusMoneyOnly });
  }
  const promotionTrials = rules.map((rule) => {
    const selected = validation.filter((row) => promotionEligible(row, rule));
    return { rule, validation: selectionMetrics(selected) };
  }).filter((trial) => trial.validation.n >= 20)
    .sort((a, b) => (b.validation.roi ?? -Infinity) - (a.validation.roi ?? -Infinity) || b.validation.n - a.validation.n);
  const selectedPromotion = promotionTrials.find((trial) => (trial.validation.roi ?? -1) > 0 && Math.abs(trial.validation.calibrationGapPp ?? 999) <= 10) ?? null;
  const promotionHoldout = selectedPromotion ? selectionMetrics(holdout.filter((row) => promotionEligible(row, selectedPromotion.rule))) : null;
  const promotionPassesHoldout = Boolean(promotionHoldout && promotionHoldout.n >= 20 && (promotionHoldout.roi ?? -1) > 0 && Math.abs(promotionHoldout.calibrationGapPp ?? 999) <= 10);

  const partitions = Object.fromEntries((["validation", "holdout"] as const).map((partition) => {
    const partitionRows = rows.filter((row) => row.partition === partition);
    const heavy = partitionRows.filter(heavyFavorite);
    const currentActionable = partitionRows.filter((row) => row.currentGrade === "Lean" || row.currentGrade === "Best Angle");
    const bestAngles = partitionRows.filter((row) => row.currentGrade === "Best Angle");
    const disagreementBestAngles = bestAngles.filter((row) => maxSide(row.market) !== row.forecastSide);
    const subFiftyDisagreementBestAngles = disagreementBestAngles.filter((row) => row.probability < 0.5);
    const promoted = selectedPromotion && promotionPassesHoldout ? partitionRows.filter((row) => promotionEligible(row, selectedPromotion.rule)) : [];
    const candidateActionable = partitionRows.filter((row) => (row.currentGrade === "Lean" || row.currentGrade === "Best Angle") && !heavy).concat(promoted);
    return [partition, {
      probability: probabilityMetrics(partitionRows),
      currentGradeMix: gradeMix(partitionRows),
      currentActionable: selectionMetrics(currentActionable),
      bestAngle: selectionMetrics(bestAngles),
      marketDisagreementBestAngle: selectionMetrics(disagreementBestAngles),
      subFiftyMarketDisagreementBestAngle: selectionMetrics(subFiftyDisagreementBestAngles),
      heavyFavoriteLean: selectionMetrics(heavy),
      heavyFavoritePriceBands: {
        minus300To399: selectionMetrics(heavy.filter((row) => row.american[row.forecastSide] >= -399)),
        minus400To599: selectionMetrics(heavy.filter((row) => row.american[row.forecastSide] <= -400 && row.american[row.forecastSide] >= -599)),
        minus600OrShorter: selectionMetrics(heavy.filter((row) => row.american[row.forecastSide] <= -600)),
      },
      candidateActionable: selectionMetrics(candidateActionable),
      candidateImpact: { promotions: promoted.length, demotions: heavy.length, net: promoted.length - heavy.length },
    }];
  }));

  console.log(JSON.stringify({
    protocol: "2022-23/2023-24 prior history; 2024-25 validation; 2025-26 untouched holdout",
    prices: "Football-Data AvgH/AvgD/AvgA exact average pre-closing decimal quotes; returns use the exact selected-side quote",
    releases: { model: "epl_goals_coherent_2026_08_20_r16 (Match Result r8 core, replayed with current 365/4/0.35/-0.10 configuration)", grade: "epl_grade_policy_2026_08_20_v21" },
    coverage: { validation: validation.length, holdout: holdout.length },
    partitions,
    promotionSearch: {
      selectedOnValidation: selectedPromotion,
      holdout: promotionHoldout,
      passesHoldout: promotionPassesHoldout,
      topValidationTrials: promotionTrials.slice(0, 8),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
