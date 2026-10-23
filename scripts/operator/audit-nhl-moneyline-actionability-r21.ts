/**
 * SELECT-only NHL Moneyline actionability audit.
 *
 * Reconstructs current fast-state forecasts from strictly pre-slate MoneyPuck
 * state and evaluates four predeclared exact-price grade rules. No writes.
 */

import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  nhlRegularModelV1,
  resolveNhlPriceAwareVerdict,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
  type NhlVerdictKey,
} from "../../lib/automodel/nhlRegularModelV1";
import { loadNhlOpponentAdjustedState } from "../../lib/services/nhl/loadNhlOpponentAdjustedState";

type Side = -1 | 1;
type Result = "win" | "loss";
type CandidateName = "baseline" | "price_value" | "dual_model" | "market_arbitrated" | "two_of_three";
type CohortName = "selection" | "confirmation_a" | "confirmation_b" | "combined_confirmation" | "full";

const R18 = "nhl_regular_2026_r18_fast_state_direct_probability";
const R19 = "nhl_regular_2026_r19_fresh_quote_authority";
const R20 = "nhl_regular_2026_r20_verified_current_board";
const CANDIDATES: CandidateName[] = ["baseline", "price_value", "dual_model", "market_arbitrated", "two_of_three"];
const PREFERENCE: Exclude<CandidateName, "baseline">[] = ["two_of_three", "market_arbitrated", "dual_model", "price_value"];

type Grade = { actual_home_score: number | null; actual_away_score: number | null; result: string | null };
type LockedLine = {
  market_type?: string;
  side?: string;
  line_value?: number | null;
  odds_american?: number | null;
};
type StoredSnapshot = {
  feature_inputs?: NhlFeatureSnapshot;
  market_at_lock?: { lines_snapshot?: LockedLine[] };
};
type Row = {
  game_id: number;
  slate_date: string;
  locked_at: string;
  matchup: string;
  side: "home" | "away";
  odds_american: number | null;
  model_version: string;
  snapshot_json: StoredSnapshot | null;
  prediction_grades: Grade | Grade[] | null;
};
type Decision = {
  side: Side;
  probability: number;
  price: number | null;
  edge: number | null;
  result: Result;
  verdicts: Record<CandidateName, NhlVerdictKey>;
};
type Game = {
  id: number;
  date: string;
  lockedAt: string;
  matchup: string;
  release: string;
  phase: "selection" | "confirmation_a" | "confirmation_b";
  actualHome: number;
  actualAway: number;
  fast: NhlModelOutput;
  comparator: NhlModelOutput;
  snapshot: NhlFeatureSnapshot;
  row: Row;
  decision: Decision;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function implied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function side(model: NhlModelOutput, home: string): Side {
  return model.moneyline.pick.startsWith(home) ? 1 : -1;
}

function result(actualHome: number, actualAway: number, selected: Side): Result {
  return (actualHome > actualAway ? 1 : -1) === selected ? "win" : "loss";
}

function unit(outcome: Result, odds: number | null): number {
  if (odds === null || outcome === "loss") return outcome === "loss" ? -1 : 0;
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function actionable(verdict: NhlVerdictKey): boolean {
  return verdict === "best_angle" || verdict === "lean";
}

function bestLockedPrice(snapshot: StoredSnapshot, selected: Side): number | null {
  const targetSide = selected === 1 ? "home" : "away";
  const prices = (snapshot.market_at_lock?.lines_snapshot ?? []).flatMap((line): number[] => (
    line.market_type === "moneyline" && line.side === targetSide && Number.isFinite(line.odds_american)
      ? [Number(line.odds_american)] : []
  ));
  return prices.length ? Math.max(...prices) : null;
}

function bestMarketPrice(snapshot: StoredSnapshot, market: "moneyline" | "spread" | "total", selected: Side, targetLine: number | null): number | null {
  const targetSide = market === "total" ? selected === 1 ? "over" : "under" : selected === 1 ? "home" : "away";
  const prices = (snapshot.market_at_lock?.lines_snapshot ?? []).flatMap((line): number[] => {
    const lineMarket = line.market_type === "puck_line" ? "spread" : line.market_type;
    const lineMatches = targetLine === null || (
      line.line_value !== null && line.line_value !== undefined && Math.abs(line.line_value - targetLine) < 0.01
    );
    return lineMarket === market && line.side === targetSide && lineMatches && Number.isFinite(line.odds_american)
      ? [Number(line.odds_american)] : [];
  });
  return prices.length ? Math.max(...prices) : null;
}

function candidateVerdicts(args: {
  baseline: NhlVerdictKey;
  probability: number;
  edge: number | null;
  price: number | null;
  fastSide: Side;
  comparatorSide: Side;
  marketSide: Side | null;
}): Record<CandidateName, NhlVerdictKey> {
  const output = { baseline: args.baseline } as Record<CandidateName, NhlVerdictKey>;
  for (const name of CANDIDATES.slice(1) as Exclude<CandidateName, "baseline">[]) {
    if (args.price === null || args.price <= -900) {
      output[name] = "pass";
      continue;
    }
    if (args.baseline === "best_angle") {
      output[name] = "best_angle";
      continue;
    }
    const nonNegativeValue = args.edge !== null && args.edge >= 0;
    const qualifies = name === "price_value"
      ? args.probability >= 0.58 && nonNegativeValue
      : name === "dual_model"
        ? args.probability >= 0.56 && nonNegativeValue && args.fastSide === args.comparatorSide
        : name === "market_arbitrated"
          ? args.probability >= 0.56 && nonNegativeValue && (
            args.marketSide === args.fastSide || (args.probability >= 0.62 && args.edge! >= 0.03)
          )
          : args.probability >= 0.56 && nonNegativeValue && (
            args.fastSide === args.comparatorSide || args.marketSide === args.fastSide
          );
    output[name] = qualifies ? "lean" : "watchlist";
  }
  return output;
}

function round(value: number | null, digits = 5): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function summary(games: readonly Game[], candidate: CandidateName) {
  const selected = games.filter((game) => actionable(game.decision.verdicts[candidate]));
  const wins = selected.filter((game) => game.decision.result === "win").length;
  const units = selected.reduce((sum, game) => sum + unit(game.decision.result, game.decision.price), 0);
  return {
    games: games.length,
    actionables: selected.length,
    retainedPct: round(games.length ? selected.length / games.length : null),
    wins,
    losses: selected.length - wins,
    accuracy: round(selected.length ? wins / selected.length : null),
    units: round(units),
    roi: round(selected.length ? units / selected.length : null),
    brier: round(selected.length ? selected.reduce((sum, game) => (
      sum + (game.decision.probability - (game.decision.result === "win" ? 1 : 0)) ** 2
    ), 0) / selected.length : null),
    meanProbability: round(selected.length ? selected.reduce((sum, game) => sum + game.decision.probability, 0) / selected.length : null),
    meanEdge: round(selected.length ? selected.reduce((sum, game) => sum + (game.decision.edge ?? 0), 0) / selected.length : null),
    missingPrices: selected.filter((game) => game.decision.price === null).length,
  };
}

function impact(games: readonly Game[], candidate: Exclude<CandidateName, "baseline">) {
  return {
    promotions: games.filter((game) => !actionable(game.decision.verdicts.baseline) && actionable(game.decision.verdicts[candidate])).length,
    demotions: games.filter((game) => actionable(game.decision.verdicts.baseline) && !actionable(game.decision.verdicts[candidate])).length,
    unchangedActionability: games.filter((game) => actionable(game.decision.verdicts.baseline) === actionable(game.decision.verdicts[candidate])).length,
  };
}

function headSummary(games: readonly Game[], source: "fast" | "comparator") {
  const entries = games.map((game) => {
    const model = game[source];
    const selected = side(model, game.snapshot.home.abbreviation);
    const probability = model.moneyline.probability;
    return { result: result(game.actualHome, game.actualAway, selected), probability };
  });
  const wins = entries.filter((entry) => entry.result === "win").length;
  return {
    games: entries.length,
    wins,
    losses: entries.length - wins,
    accuracy: round(entries.length ? wins / entries.length : null),
    brier: round(entries.length ? entries.reduce((sum, entry) => (
      sum + (entry.probability - (entry.result === "win" ? 1 : 0)) ** 2
    ), 0) / entries.length : null),
  };
}

function readerSummary(games: readonly Game[]) {
  const entries = games.map((game) => {
    const independent: Side = game.fast.independent_goal_diff >= 0 ? 1 : -1;
    const final = side(game.fast, game.snapshot.home.abbreviation);
    const before = result(game.actualHome, game.actualAway, independent);
    const after = result(game.actualHome, game.actualAway, final);
    return { changed: independent !== final, before, after };
  });
  return {
    changes: entries.filter((entry) => entry.changed).length,
    corrections: entries.filter((entry) => entry.changed && entry.before === "loss" && entry.after === "win").length,
    harms: entries.filter((entry) => entry.changed && entry.before === "win" && entry.after === "loss").length,
    unchanged: entries.filter((entry) => !entry.changed).length,
  };
}

function gameCountDiagnostics(games: readonly Game[]) {
  const bucketFor = (game: Game) => {
    const maximum = Math.max(game.snapshot.home.current_season_games ?? 0, game.snapshot.away.current_season_games ?? 0);
    return maximum <= 3 ? "max_0_3" : maximum <= 6 ? "max_4_6" : maximum <= 9 ? "max_7_9" : "max_10_plus";
  };
  const buckets = new Map<string, Game[]>();
  for (const game of games) {
    const key = bucketFor(game);
    buckets.set(key, [...(buckets.get(key) ?? []), game]);
  }
  return Object.fromEntries([...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [key, {
    fast: headSummary(values, "fast"),
    comparator: headSummary(values, "comparator"),
    reader: readerSummary(values),
  }]));
}

type AllMarket = "moneyline" | "spread" | "total";

function handoffModel(game: Game): NhlModelOutput {
  const maximum = Math.max(game.snapshot.home.current_season_games ?? 0, game.snapshot.away.current_season_games ?? 0);
  return maximum < 7 ? game.fast : game.comparator;
}

function modelSide(model: NhlModelOutput, game: Game, market: AllMarket): Side {
  if (market === "total") return model.total.pick.startsWith("OVER") ? 1 : -1;
  const pick = market === "moneyline" ? model.moneyline.pick : model.puck_line.pick;
  return pick.startsWith(game.snapshot.home.abbreviation) ? 1 : -1;
}

function modelProbability(model: NhlModelOutput, market: AllMarket): number {
  return market === "moneyline" ? model.moneyline.probability : market === "spread" ? model.puck_line.probability : model.total.probability;
}

function modelVerdict(model: NhlModelOutput, market: AllMarket): NhlVerdictKey {
  return market === "moneyline" ? model.moneyline.verdict : market === "spread" ? model.puck_line.verdict : model.total.verdict;
}

function modelResult(game: Game, model: NhlModelOutput, market: AllMarket): "win" | "loss" | "push" {
  const selected = modelSide(model, game, market);
  const actualMargin = game.actualHome - game.actualAway;
  if (market === "moneyline") return result(game.actualHome, game.actualAway, selected);
  if (market === "spread") {
    const selectedLine = model.puck_line.puck_line_value;
    const axis = (selected === 1 ? actualMargin : -actualMargin) + selectedLine;
    return Math.abs(axis) < 1e-9 ? "push" : axis > 0 ? "win" : "loss";
  }
  const line = game.snapshot.market.market_total_line;
  if (line === null) return "push";
  const axis = game.actualHome + game.actualAway - line;
  if (Math.abs(axis) < 1e-9) return "push";
  return (axis > 0 ? 1 : -1) === selected ? "win" : "loss";
}

function modelPrice(game: Game, model: NhlModelOutput, market: AllMarket): number | null {
  const selected = modelSide(model, game, market);
  const targetLine = market === "moneyline" ? null
    : market === "spread" ? model.puck_line.puck_line_value : game.snapshot.market.market_total_line;
  if (market === "moneyline") {
    const storedSide: Side = game.row.side === "home" ? 1 : -1;
    if (storedSide === selected && game.row.odds_american !== null) return game.row.odds_american;
  }
  return bestMarketPrice(game.row.snapshot_json!, market, selected, targetLine);
}

function performance(games: readonly Game[], source: "fast" | "handoff") {
  const selectModel = (game: Game) => source === "fast" ? game.fast : handoffModel(game);
  const byMarket = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const entries = games.map((game) => {
      const model = selectModel(game);
      return { result: modelResult(game, model, market), probability: modelProbability(model, market) };
    });
    const resolved = entries.filter((entry) => entry.result !== "push");
    const wins = resolved.filter((entry) => entry.result === "win").length;
    return [market, {
      rows: entries.length,
      wins,
      losses: resolved.length - wins,
      pushes: entries.length - resolved.length,
      accuracy: round(resolved.length ? wins / resolved.length : null),
      brier: round(resolved.length ? resolved.reduce((sum, entry) => (
        sum + (entry.probability - (entry.result === "win" ? 1 : 0)) ** 2
      ), 0) / resolved.length : null),
    }];
  }));
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const score = {
    teamMae: round(mean(games.map((game) => {
      const model = selectModel(game);
      return (Math.abs(model.projected_home_goals - game.actualHome) + Math.abs(model.projected_away_goals - game.actualAway)) / 2;
    }))),
    marginMae: round(mean(games.map((game) => {
      const model = selectModel(game);
      return Math.abs(model.expected_goal_diff - (game.actualHome - game.actualAway));
    }))),
    totalMae: round(mean(games.map((game) => {
      const model = selectModel(game);
      return Math.abs(model.expected_total_goals - (game.actualHome + game.actualAway));
    }))),
  };
  return { byMarket, score };
}

type ActionabilitySource = "fast" | "handoff" | "handoff_spread56";

function allMarketActionability(games: readonly Game[], source: ActionabilitySource) {
  const selectModel = (game: Game) => source === "fast" ? game.fast : handoffModel(game);
  const entries = games.flatMap((game) => (["moneyline", "spread", "total"] as const).map((market) => {
    const model = selectModel(game);
    const probability = modelProbability(model, market);
    const price = modelPrice(game, model, market);
    const baseVerdict = resolveNhlPriceAwareVerdict(market, modelVerdict(model, market), price, probability);
    const exactPriceEdge = price === null ? null : probability - implied(price);
    const verdict = source === "handoff_spread56"
      && market === "spread"
      && baseVerdict === "watchlist"
      && probability >= 0.56
      && exactPriceEdge !== null
      && exactPriceEdge >= 0.015
      ? "lean"
      : baseVerdict;
    return {
      gameId: game.id,
      date: game.date,
      matchup: game.matchup,
      market,
      side: modelSide(model, game, market),
      verdict,
      probability,
      price,
      exactPriceEdge,
      result: modelResult(game, model, market),
    };
  }));
  const selected = entries.filter((entry) => actionable(entry.verdict));
  const summarize = (values: typeof entries) => {
    const resolved = values.filter((entry) => entry.result !== "push");
    const wins = resolved.filter((entry) => entry.result === "win").length;
    const units = values.reduce((sum, entry) => sum + (
      entry.result === "push" ? 0 : unit(entry.result, entry.price)
    ), 0);
    return {
      rows: values.length,
      wins,
      losses: resolved.length - wins,
      pushes: values.length - resolved.length,
      accuracy: round(resolved.length ? wins / resolved.length : null),
      units: round(units),
      brier: round(resolved.length ? resolved.reduce((sum, entry) => (
        sum + (entry.probability - (entry.result === "win" ? 1 : 0)) ** 2
      ), 0) / resolved.length : null),
      missingPrices: values.filter((entry) => entry.price === null).length,
    };
  };
  return {
    actionable: summarize(selected),
    byMarket: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market, summarize(selected.filter((entry) => entry.market === market))])),
    entries,
    decisions: entries.map((entry) => entry.verdict),
  };
}

function handoffPuckCalibration(games: readonly Game[]) {
  const incumbent = allMarketActionability(games, "fast");
  const handoff = allMarketActionability(games, "handoff");
  const calibrated = allMarketActionability(games, "handoff_spread56");
  const summarize = (source: ReturnType<typeof allMarketActionability>) => ({
    actionable: source.actionable,
    byMarket: source.byMarket,
  });
  const impact = (after: ReturnType<typeof allMarketActionability>, before: ReturnType<typeof allMarketActionability>) => ({
    promotions: after.decisions.filter((verdict, index) => actionable(verdict) && !actionable(before.decisions[index]!)).length,
    demotions: after.decisions.filter((verdict, index) => !actionable(verdict) && actionable(before.decisions[index]!)).length,
  });
  return {
    incumbent: summarize(incumbent),
    handoff: summarize(handoff),
    calibrated: summarize(calibrated),
    calibratedVsIncumbent: impact(calibrated, incumbent),
    calibratedVsHandoff: impact(calibrated, handoff),
    puckLineChangesVsIncumbent: calibrated.entries.flatMap((entry, index) => {
      const before = incumbent.entries[index]!;
      if (entry.market !== "spread" || entry.verdict === before.verdict) return [];
      return [{
        gameId: entry.gameId,
        date: entry.date,
        matchup: entry.matchup,
        before: {
          side: before.side,
          verdict: before.verdict,
          probability: round(before.probability),
          price: before.price,
          exactPriceEdge: round(before.exactPriceEdge),
          result: before.result,
        },
        after: {
          side: entry.side,
          verdict: entry.verdict,
          probability: round(entry.probability),
          price: entry.price,
          exactPriceEdge: round(entry.exactPriceEdge),
          result: entry.result,
        },
      }];
    }),
  };
}

function handoffComparison(games: readonly Game[]) {
  const incumbent = allMarketActionability(games, "fast");
  const candidate = allMarketActionability(games, "handoff");
  const markets = ["moneyline", "spread", "total"] as const;
  const impactRows = candidate.decisions.map((verdict, index) => ({
    index,
    before: incumbent.decisions[index]!,
    after: verdict,
  }));
  return {
    incumbent: performance(games, "fast"),
    candidate: performance(games, "handoff"),
    actionability: {
      incumbent: { actionable: incumbent.actionable, byMarket: incumbent.byMarket },
      candidate: { actionable: candidate.actionable, byMarket: candidate.byMarket },
      promotions: candidate.decisions.filter((verdict, index) => actionable(verdict) && !actionable(incumbent.decisions[index]!)).length,
      demotions: candidate.decisions.filter((verdict, index) => !actionable(verdict) && actionable(incumbent.decisions[index]!)).length,
      byMarketImpact: Object.fromEntries(markets.map((market, marketIndex) => {
        const scoped = impactRows.filter((row) => row.index % markets.length === marketIndex);
        return [market, {
          promotions: scoped.filter((row) => actionable(row.after) && !actionable(row.before)).length,
          demotions: scoped.filter((row) => !actionable(row.after) && actionable(row.before)).length,
        }];
      })),
    },
  };
}

function gate(args: {
  selection: readonly Game[];
  confirmationA: readonly Game[];
  confirmationB: readonly Game[];
  full: readonly Game[];
  candidate: Exclude<CandidateName, "baseline">;
}) {
  const selectionBase = summary(args.selection, "baseline");
  const selectionCandidate = summary(args.selection, args.candidate);
  const confirmationABase = summary(args.confirmationA, "baseline");
  const confirmationACandidate = summary(args.confirmationA, args.candidate);
  const confirmationBBase = summary(args.confirmationB, "baseline");
  const confirmationBCandidate = summary(args.confirmationB, args.candidate);
  const combined = [...args.confirmationA, ...args.confirmationB];
  const combinedBase = summary(combined, "baseline");
  const combinedCandidate = summary(combined, args.candidate);
  const fullBase = summary(args.full, "baseline");
  const fullCandidate = summary(args.full, args.candidate);
  const boardImpact = impact(args.full, args.candidate);
  const gates = {
    selectionAccuracyNonDecline: (selectionCandidate.accuracy ?? -Infinity) >= (selectionBase.accuracy ?? -Infinity),
    selectionUnitsNonDecline: (selectionCandidate.units ?? -Infinity) >= (selectionBase.units ?? -Infinity),
    confirmationAAccuracyNonDecline: (confirmationACandidate.accuracy ?? -Infinity) >= (confirmationABase.accuracy ?? -Infinity),
    confirmationBAccuracyNonDecline: (confirmationBCandidate.accuracy ?? -Infinity) >= (confirmationBBase.accuracy ?? -Infinity),
    combinedConfirmationUnitsWithin050: (combinedCandidate.units ?? -Infinity) >= (combinedBase.units ?? -Infinity) - 0.50,
    confirmationARetainsQuarter: (confirmationACandidate.retainedPct ?? 0) >= 0.25,
    confirmationBRetainsQuarter: (confirmationBCandidate.retainedPct ?? 0) >= 0.25,
    pairedPromotionAndDemotion: boardImpact.promotions > 0 && boardImpact.demotions > 0,
    fullBrierNonWorsening: (fullCandidate.brier ?? Infinity) <= (fullBase.brier ?? Infinity),
    zeroMissingPrices: fullCandidate.missingPrices === 0,
  };
  return {
    passes: Object.values(gates).every(Boolean),
    gates,
    boardImpact,
    selection: { baseline: selectionBase, candidate: selectionCandidate },
    confirmationA: { baseline: confirmationABase, candidate: confirmationACandidate },
    confirmationB: { baseline: confirmationBBase, candidate: confirmationBCandidate },
    combinedConfirmation: { baseline: combinedBase, candidate: combinedCandidate },
    full: { baseline: fullBase, candidate: fullCandidate },
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("game_id,slate_date,locked_at,matchup,side,odds_american,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(actual_home_score,actual_away_score,result)")
    .eq("sport", "nhl")
    .eq("market", "moneyline")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .not("locked_at", "is", null)
    .order("locked_at", { ascending: true });
  if (error) throw new Error(error.message);
  const stateByDate = new Map<string, Awaited<ReturnType<typeof loadNhlOpponentAdjustedState>>>();
  const games: Game[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const grade = one(row.prediction_grades);
    const stored = row.snapshot_json;
    const snapshot = stored?.feature_inputs;
    if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !stored || !snapshot) continue;
    let loaded = stateByDate.get(row.slate_date);
    if (!loaded) {
      loaded = await loadNhlOpponentAdjustedState(2026, row.slate_date);
      if (!loaded.complete) throw new Error(`incomplete state for ${row.slate_date}: ${loaded.error ?? "unknown"}`);
      stateByDate.set(row.slate_date, loaded);
    }
    const homeState = loaded.states.get(snapshot.home.abbreviation);
    const awayState = loaded.states.get(snapshot.away.abbreviation);
    const homeFast = loaded.fastStates.get(snapshot.home.abbreviation);
    const awayFast = loaded.fastStates.get(snapshot.away.abbreviation);
    if (!homeState || !awayState || !homeFast || !awayFast) throw new Error(`missing reconstructed state for ${row.matchup}`);
    const repaired: NhlFeatureSnapshot = {
      ...structuredClone(snapshot),
      home: {
        ...structuredClone(snapshot.home),
        opponent_adjusted_attack: homeState.attack,
        opponent_adjusted_defense_weakness: homeState.defenseWeakness,
        fast_state: homeFast,
      },
      away: {
        ...structuredClone(snapshot.away),
        opponent_adjusted_attack: awayState.attack,
        opponent_adjusted_defense_weakness: awayState.defenseWeakness,
        fast_state: awayFast,
      },
    };
    const fast = nhlRegularModelV1(repaired);
    const comparatorSnapshot = structuredClone(repaired);
    comparatorSnapshot.home.fast_state = null;
    comparatorSnapshot.away.fast_state = null;
    const comparator = nhlRegularModelV1(comparatorSnapshot);
    const selectedSide = side(fast, repaired.home.abbreviation);
    const storedSide: Side = row.side === "home" ? 1 : -1;
    const price = storedSide === selectedSide && row.odds_american !== null
      ? row.odds_american : bestLockedPrice(stored, selectedSide);
    const probability = fast.moneyline.probability;
    const edge = price === null ? null : probability - implied(price);
    const baseline = resolveNhlPriceAwareVerdict("moneyline", fast.moneyline.verdict, price, probability);
    const marketProbability = repaired.market.market_home_prob;
    const marketSide: Side | null = marketProbability === null ? null : marketProbability >= 0.5 ? 1 : -1;
    const verdicts = candidateVerdicts({
      baseline,
      probability,
      edge,
      price,
      fastSide: selectedSide,
      comparatorSide: side(comparator, repaired.home.abbreviation),
      marketSide,
    });
    games.push({
      id: row.game_id,
      date: row.slate_date,
      lockedAt: row.locked_at,
      matchup: row.matchup,
      release: row.model_version,
      phase: row.model_version === R18 ? "confirmation_a" : row.model_version === R19 || row.model_version === R20 ? "confirmation_b" : "selection",
      actualHome: grade.actual_home_score,
      actualAway: grade.actual_away_score,
      fast,
      comparator,
      snapshot: repaired,
      row,
      decision: {
        side: selectedSide,
        probability,
        price,
        edge,
        result: result(grade.actual_home_score, grade.actual_away_score, selectedSide),
        verdicts,
      },
    });
  }
  games.sort((left, right) => left.lockedAt.localeCompare(right.lockedAt));
  const selection = games.filter((game) => game.phase === "selection");
  const confirmationA = games.filter((game) => game.phase === "confirmation_a");
  const confirmationB = games.filter((game) => game.phase === "confirmation_b");
  const cohorts: Record<CohortName, Game[]> = {
    selection,
    confirmation_a: confirmationA,
    confirmation_b: confirmationB,
    combined_confirmation: [...confirmationA, ...confirmationB],
    full: games,
  };
  const evaluations = Object.fromEntries(PREFERENCE.map((candidate) => [candidate, gate({
    selection,
    confirmationA,
    confirmationB,
    full: games,
    candidate,
  })]));
  const selected = PREFERENCE.find((candidate) => evaluations[candidate]!.passes) ?? null;
  const headDiagnostics = Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, {
    fast: headSummary(values, "fast"),
    comparator: headSummary(values, "comparator"),
    reader: readerSummary(values),
    byMaximumTeamGames: gameCountDiagnostics(values),
  }]));
  const handoffValidation = Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, handoffComparison(values)]));
  const handoffPuckCalibrationValidation = Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, handoffPuckCalibration(values)]));
  if (process.argv.includes("--diagnostics-only")) {
    console.log(JSON.stringify({
      release: "nhl_moneyline_actionability_audit_2026_10_23_r1",
      readOnly: true,
      writes: 0,
      cohortSizes: Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, values.length])),
      headDiagnostics,
      handoffValidation,
      handoffPuckCalibrationValidation,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    release: "nhl_moneyline_actionability_audit_2026_10_23_r1",
    readOnly: true,
    writes: 0,
    provenance: {
      games: games.length,
      dates: stateByDate.size,
      strictlyPreSlateState: true,
      byRelease: Object.fromEntries([...new Set(games.map((game) => game.release))].map((release) => [release, games.filter((game) => game.release === release).length])),
    },
    cohortSizes: Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, values.length])),
    selectedCandidate: selected,
    cohortSummaries: Object.fromEntries(Object.entries(cohorts).map(([name, values]) => [name, Object.fromEntries(CANDIDATES.map((candidate) => [candidate, summary(values, candidate)]))])),
    headDiagnostics,
    handoffValidation,
    handoffPuckCalibrationValidation,
    evaluations,
  }, null, process.argv.includes("--compact") ? 0 : 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
