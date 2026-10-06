/**
 * SELECT-only WNBA comparison of the incumbent 25/75 spread center against
 * independent-first alternatives. It never calls a provider or writes.
 *
 * Usage:
 *   node --import tsx --env-file=.env.local scripts/operator/audit-wnba-independent-first-market-arbitration.ts
 */
import { supabase } from "../../lib/db/supabase";
import {
  readWnbaForwardEvidenceCapture,
  WNBA_FORWARD_EVIDENCE_CAPTURE_KEY,
  type WnbaForwardEvidenceCapture,
} from "../../lib/services/wnba/wnbaForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Candidate =
  | "incumbent"
  | "independent"
  | "qualified_incumbent_crossing"
  | "qualified_any_decision_crossing"
  | "qualified_confident_decision_crossing"
  | "qualified_reflection_crossing"
  | "corroborated_spread_flip";

type Game = {
  externalId: string;
  decisionAt: string;
  slateDate: string;
  release: string;
  actualHome: number;
  actualAway: number;
  total: number;
  incumbentMargin: number;
  independentMargin: number;
  homeLine: number | null;
  movementSide: "home" | "away" | null;
  splitSide: "home" | "away" | null;
  targetExcludedBooks: number;
  incumbentHomeProbability: number;
  championSpreadSide: string | null;
  evaluatedSpreadSide: string | null;
  evaluatedSpreadLine: number | null;
};

type ArchiveSplitRow = {
  canonical_event_id: unknown;
  market_type: unknown;
  selection_key: unknown;
  provider: unknown;
  source_book: unknown;
  source_type: unknown;
  bets_pct: unknown;
  money_pct: unknown;
  fetched_at: unknown;
  ingestion_run_id: unknown;
};

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function grade(row: Row): Row | null {
  const value = row.prediction_grades;
  return Array.isArray(value) ? object(value[0]) : object(value);
}

function majority<T extends string>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  return ranked[0]![0];
}

function movementSide(capture: WnbaForwardEvidenceCapture): "home" | "away" | null {
  const evaluated = capture.markets.spread.evaluation.evaluated_sportsbook?.trim().toLowerCase() ?? null;
  const targetExcluded = capture.markets.spread.same_book_movement.filter((move) =>
    move.sportsbook.trim().toLowerCase() !== evaluated
  );
  const directions = targetExcluded.flatMap((move) => {
    const lineDirection = move.line_delta !== null && Math.abs(move.line_delta) >= 0.5
      ? move.line_delta < 0 ? "home" as const : "away" as const
      : null;
    const priceDirection = Math.abs(move.fair_probability_delta) >= 0.01
      ? move.fair_probability_delta > 0 ? "home" as const : "away" as const
      : null;
    return lineDirection !== null && priceDirection !== null && lineDirection !== priceDirection
      ? []
      : [lineDirection ?? priceDirection].filter((value): value is "home" | "away" => value !== null);
  });
  return majority(directions);
}

function splitSide(capture: WnbaForwardEvidenceCapture): "home" | "away" | null {
  const pairs = capture.markets.spread.source_aware_public_pairs;
  const directions = pairs.flatMap((pair) => {
    const candidates = pair.sides.flatMap((side) => {
      if (side.side !== "home" && side.side !== "away") return [];
      if (side.money_pct === null || side.bets_pct === null) return [];
      return side.money_pct - side.bets_pct >= 0.1 ? [side.side] : [];
    });
    return candidates.length === 1 ? candidates : [];
  });
  return majority(directions);
}

function archiveSplitSide(
  rows: readonly ArchiveSplitRow[],
  externalId: string,
  decisionAt: string,
): "home" | "away" | null {
  const decisionMs = Date.parse(decisionAt);
  const groups = new Map<string, ArchiveSplitRow[]>();
  for (const row of rows) {
    if (String(row.canonical_event_id) !== externalId || row.market_type !== "spread") continue;
    const fetchedAt = typeof row.fetched_at === "string" ? Date.parse(row.fetched_at) : Number.NaN;
    if (!Number.isFinite(fetchedAt) || fetchedAt > decisionMs) continue;
    const key = [row.provider, row.source_book, row.source_type, row.ingestion_run_id ?? row.fetched_at].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const latestBySource = new Map<string, { fetchedAt: string; side: "home" | "away" }>();
  for (const group of groups.values()) {
    const home = group.find((row) => String(row.selection_key).split(":").at(-1) === "home");
    const away = group.find((row) => String(row.selection_key).split(":").at(-1) === "away");
    if (!home || !away) continue;
    const directional = [home, away].flatMap((row): Array<"home" | "away"> => {
      const bets = number(row.bets_pct);
      const money = number(row.money_pct);
      const side = String(row.selection_key).split(":").at(-1);
      if ((side !== "home" && side !== "away") || bets === null || money === null || money - bets < 0.1) return [];
      return [side];
    });
    if (directional.length !== 1) continue;
    const sourceKey = [home.provider, home.source_book, home.source_type].join("|");
    const fetchedAt = String(home.fetched_at) > String(away.fetched_at)
      ? String(home.fetched_at)
      : String(away.fetched_at);
    const prior = latestBySource.get(sourceKey);
    if (!prior || fetchedAt > prior.fetchedAt) latestBySource.set(sourceKey, { fetchedAt, side: directional[0]! });
  }
  return majority([...latestBySource.values()].map((entry) => entry.side));
}

function candidateMargin(game: Game, candidate: Candidate): number {
  if (candidate === "incumbent") return game.incumbentMargin;
  if (candidate === "independent" || game.homeLine === null) return game.independentMargin;
  const independentSide = game.independentMargin + game.homeLine >= 0 ? "home" : "away";
  const incumbentSide = game.incumbentMargin + game.homeLine >= 0 ? "home" : "away";
  const incumbentCrossesSpread = game.targetExcludedBooks >= 2 && incumbentSide !== independentSide;
  if (candidate === "qualified_incumbent_crossing") {
    return incumbentCrossesSpread ? game.incumbentMargin : game.independentMargin;
  }
  if (candidate === "qualified_any_decision_crossing") {
    const incumbentCrossesWinner = game.targetExcludedBooks >= 2 &&
      (game.incumbentMargin >= 0) !== (game.independentMargin >= 0);
    return incumbentCrossesSpread || incumbentCrossesWinner ? game.incumbentMargin : game.independentMargin;
  }
  if (candidate === "qualified_confident_decision_crossing") {
    const incumbentCrossesWinner = game.targetExcludedBooks >= 2 &&
      (game.incumbentMargin >= 0) !== (game.independentMargin >= 0);
    const incumbentWinnerProbability = game.incumbentMargin >= 0
      ? game.incumbentHomeProbability
      : 1 - game.incumbentHomeProbability;
    return incumbentCrossesSpread || incumbentCrossesWinner && incumbentWinnerProbability >= 0.54
      ? game.incumbentMargin
      : game.independentMargin;
  }
  if (candidate === "qualified_reflection_crossing") {
    return incumbentCrossesSpread ? -game.independentMargin - 2 * game.homeLine : game.independentMargin;
  }
  const corroborated = game.movementSide !== null &&
    game.movementSide === game.splitSide &&
    game.movementSide !== independentSide &&
    game.targetExcludedBooks >= 2;
  if (!corroborated) return game.independentMargin;
  // Reflect the independent margin around the evaluated spread's break-even
  // point. This changes direction without shrinking every forecast toward the
  // line and preserves the independent distance from that decision boundary.
  return -game.independentMargin - 2 * game.homeLine;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function summarize(games: readonly Game[], candidate: Candidate) {
  const evaluated = games.map((game) => {
    const margin = candidateMargin(game, candidate);
    const actualMargin = game.actualHome - game.actualAway;
    const actualTotal = game.actualHome + game.actualAway;
    const home = (game.total + margin) / 2;
    const away = (game.total - margin) / 2;
    const actualWinnerHome = actualMargin > 0;
    const predictedWinnerHome = margin > 0;
    const spread = game.homeLine === null || actualMargin + game.homeLine === 0
      ? null
      : (margin + game.homeLine > 0) === (actualMargin + game.homeLine > 0);
    return {
      margin,
      marginAbs: Math.abs(margin - actualMargin),
      teamAbs: (Math.abs(home - game.actualHome) + Math.abs(away - game.actualAway)) / 2,
      totalAbs: Math.abs(game.total - actualTotal),
      winner: predictedWinnerHome === actualWinnerHome,
      spread,
      changedFromIndependent: Math.abs(margin - game.independentMargin) > 1e-9,
      changedFromIncumbent: Math.abs(margin - game.incumbentMargin) > 1e-9,
    };
  });
  const spreads = evaluated.flatMap((row) => row.spread === null ? [] : [row.spread]);
  return {
    games: evaluated.length,
    margin_mae: round(mean(evaluated.map((row) => row.marginAbs))),
    team_score_mae: round(mean(evaluated.map((row) => row.teamAbs))),
    total_mae: round(mean(evaluated.map((row) => row.totalAbs))),
    winner_accuracy: `${evaluated.filter((row) => row.winner).length}/${evaluated.length}`,
    spread_accuracy: `${spreads.filter(Boolean).length}/${spreads.length}`,
    changed_from_independent: evaluated.filter((row) => row.changedFromIndependent).length,
    changed_from_incumbent: evaluated.filter((row) => row.changedFromIncumbent).length,
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id,slate_date,market,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "wnba")
    .eq("market", "spread")
    .not(`snapshot_json->${WNBA_FORWARD_EVIDENCE_CAPTURE_KEY}`, "is", null)
    .order("slate_date", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  const openedGames = ((data ?? []) as Row[]).flatMap((row): Game[] => {
    const snapshot = object(row.snapshot_json);
    const capture = readWnbaForwardEvidenceCapture(snapshot?.[WNBA_FORWARD_EVIDENCE_CAPTURE_KEY]);
    const result = grade(row);
    const actualHome = number(result?.actual_home_score);
    const actualAway = number(result?.actual_away_score);
    if (!capture || actualHome === null || actualAway === null || result?.result === "pending") return [];
    const total = number(capture.independent_model.projected_total);
    const independentMargin = number(capture.independent_model.projected_home_margin);
    const incumbentHome = number(capture.champion_output.projected_score.home);
    const incumbentAway = number(capture.champion_output.projected_score.away);
    const incumbentHomeProbability = number(capture.champion_output.model.final_home_win_prob);
    const selectedLine = number(capture.markets.spread.champion_target.line);
    const selectedSide = capture.markets.spread.champion_target.side;
    const homeLine = selectedLine === null
      ? null
      : selectedSide === "away" ? -selectedLine : selectedLine;
    if (total === null || independentMargin === null || incumbentHome === null || incumbentAway === null || incumbentHomeProbability === null) return [];
    return [{
      externalId: String(capture.game.external_id),
      decisionAt: capture.decision_at,
      slateDate: String(row.slate_date),
      release: capture.releases.model_version,
      actualHome,
      actualAway,
      total,
      incumbentMargin: incumbentHome - incumbentAway,
      independentMargin,
      homeLine,
      movementSide: movementSide(capture),
      splitSide: splitSide(capture),
      targetExcludedBooks: capture.markets.spread.evaluation.target_excluded_complete_pair_count,
      incumbentHomeProbability,
      championSpreadSide: capture.markets.spread.champion_target.side,
      evaluatedSpreadSide: capture.markets.spread.evaluation.tuple?.side ?? null,
      evaluatedSpreadLine: capture.markets.spread.evaluation.tuple?.line ?? null,
    }];
  });

  const eventIds = [...new Set(openedGames.map((game) => game.externalId))];
  const archiveResult = eventIds.length === 0
    ? { data: [] as ArchiveSplitRow[], error: null }
    : await supabase
        .from("market_split_observations_v2")
        .select("canonical_event_id,market_type,selection_key,provider,source_book,source_type,bets_pct,money_pct,fetched_at,ingestion_run_id")
        .eq("league", "wnba")
        .in("canonical_event_id", eventIds)
        .eq("market_type", "spread")
        .order("fetched_at", { ascending: false })
        .limit(5000);
  if (archiveResult.error) throw new Error(archiveResult.error.message);
  const archiveRows = (archiveResult.data ?? []) as ArchiveSplitRow[];
  const games = openedGames.map((game) => ({
    ...game,
    splitSide: game.splitSide ?? archiveSplitSide(archiveRows, game.externalId, game.decisionAt),
  }));

  const finalBlockSize = Math.min(14, Math.max(0, games.length));
  const cohorts = {
    all_opened_forward: games,
    earlier_block: games.slice(0, games.length - finalBlockSize),
    final_chronological_block: games.slice(games.length - finalBlockSize),
    active_release_only: games.filter((game) => game.release === "wnba_v1_5_coherent_expected_margin"),
  };
  const candidates: Candidate[] = [
    "incumbent",
    "independent",
    "qualified_incumbent_crossing",
    "qualified_any_decision_crossing",
    "qualified_confident_decision_crossing",
    "qualified_reflection_crossing",
    "corroborated_spread_flip",
  ];
  const evidence = {
    games: games.length,
    target_excluded_two_plus: games.filter((game) => game.targetExcludedBooks >= 2).length,
    movement_direction: games.filter((game) => game.movementSide !== null).length,
    source_aware_split_direction: games.filter((game) => game.splitSide !== null).length,
    movement_split_agreement: games.filter((game) => game.movementSide !== null && game.movementSide === game.splitSide).length,
    qualified_opposition: games.filter((game) => {
      if (game.homeLine === null || game.movementSide === null || game.movementSide !== game.splitSide || game.targetExcludedBooks < 2) return false;
      const independentSide = game.independentMargin + game.homeLine >= 0 ? "home" : "away";
      return independentSide !== game.movementSide;
    }).length,
  };

  console.log(JSON.stringify({
    mode: "select_only",
    writes: 0,
    provider_calls: 0,
    archive_split_rows: archiveRows.length,
    fixed_candidate: {
      rule: "independent default; reflect across the exact spread boundary only when target-excluded same-book movement and source-aware money-minus-ticket evidence agree against the independent cover side",
      movement_minimum: "0.5 spread point or 1pp no-vig probability",
      split_minimum: "10pp money-minus-ticket gap",
      minimum_target_excluded_books: 2,
    },
    evidence,
    line_identity_samples: games.slice(0, 8).map((game) => ({
      slate_date: game.slateDate,
      champion_side: game.championSpreadSide,
      champion_line: game.homeLine,
      evaluated_side: game.evaluatedSpreadSide,
      evaluated_line: game.evaluatedSpreadLine,
      independent_margin: round(game.independentMargin),
      incumbent_margin: round(game.incumbentMargin),
    })),
    cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, rows]) => [
      name,
      Object.fromEntries(candidates.map((candidate) => [candidate, summarize(rows, candidate)])),
    ])),
  }, null, 2));
}

void main();
