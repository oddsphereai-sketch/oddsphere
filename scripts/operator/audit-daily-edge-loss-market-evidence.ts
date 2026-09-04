import { writeFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

const DAILY_EDGE_SPORTS = ["mlb", "wnba", "soccer", "ucl", "nfl", "cfb", "nba", "nhl"] as const;
type Sport = typeof DAILY_EDGE_SPORTS[number];

type JsonObject = Record<string, unknown>;

type PredictionRecord = {
  id: number;
  sport: string;
  slate_date: string;
  matchup: string | null;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  no_bet: boolean | null;
  locked_at: string;
  snapshot_json: JsonObject | null;
  prediction_grades:
    | { result?: string | null; win?: boolean | null; loss?: boolean | null; push?: boolean | null; void?: boolean | null }
    | Array<{ result?: string | null; win?: boolean | null; loss?: boolean | null; push?: boolean | null; void?: boolean | null }>
    | null;
};

type AuditRow = ReturnType<typeof compactAuditRow>;

const PAGE_SIZE = 750;
const MAX_ROWS = 50_000;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function decisionRelease(snapshotValue: unknown): string {
  const snapshot = object(snapshotValue);
  const tuple = object(snapshot.decision_tuple);
  const pipeline = object(snapshot.decision_pipeline);
  const recommendation = object(snapshot.recommendationDecision ?? snapshot.recommendation_decision);
  const decision = object(snapshot.decision);
  const versions = object(snapshot.model_layer_versions);

  return (
    string(tuple.decisionRelease ?? tuple.decision_release ?? tuple.release_id) ??
    string(pipeline.decisionRelease ?? pipeline.decision_release ?? pipeline.release_id) ??
    string(recommendation.decisionRelease ?? recommendation.decision_release ?? recommendation.release_id) ??
    string(decision.decisionRelease ?? decision.decision_release ?? decision.release_id) ??
    string(versions.decision_release_id) ??
    string(snapshot.decision_release ?? snapshot.release) ??
    "unknown"
  );
}

function decisionObject(snapshot: JsonObject): JsonObject {
  return object(
    snapshot.decision_tuple ??
      snapshot.decision_pipeline ??
      snapshot.recommendationDecision ??
      snapshot.recommendation_decision ??
      snapshot.decision,
  );
}

function resultOf(row: PredictionRecord): string {
  const grade = first(row.prediction_grades);
  return (
    string(grade?.result) ??
    (grade?.loss ? "loss" : grade?.win ? "win" : grade?.push ? "push" : grade?.void ? "void" : "pending")
  );
}

function pickedPublicDirection(publicSplits: JsonObject): string {
  if (boolean(publicSplits.conflict) === true) return "conflict";
  if (boolean(publicSplits.support) === true) return "support";
  return Object.keys(publicSplits).length > 0 ? "not_support" : "unknown";
}

function selectedBookRange(row: PredictionRecord, snapshot: JsonObject) {
  const books = array(snapshot.current_books_at_lock).map(object);
  const side = row.side?.toLowerCase() ?? "";
  const offers: Array<{ sportsbook: string | null; line: number | null; price: number | null }> = [];

  for (const book of books) {
    let line: number | null = null;
    let price: number | null = null;
    if (row.market === "moneyline") {
      price = number(object(book.moneyline)[`${side}Price`]);
    } else if (row.market === "spread") {
      line = number(object(book.spread)[`${side}Line`]);
      price = number(object(book.spread)[`${side}Price`]);
    } else if (row.market === "total") {
      line = number(object(book.total).line);
      price = number(object(book.total)[`${side}Price`]);
    }
    if (line !== null || price !== null) {
      offers.push({ sportsbook: string(book.sportsbook), line, price });
    }
  }

  const prices = offers.flatMap((offer) => (offer.price === null ? [] : [offer.price]));
  const lines = offers.flatMap((offer) => (offer.line === null ? [] : [offer.line]));
  return {
    offerCount: offers.length,
    betterPriceCount: offers.filter(
      (offer) => offer.price !== null && row.odds_american !== null && offer.price > row.odds_american,
    ).length,
    priceMin: prices.length > 0 ? Math.min(...prices) : null,
    priceMax: prices.length > 0 ? Math.max(...prices) : null,
    lineMin: lines.length > 0 ? Math.min(...lines) : null,
    lineMax: lines.length > 0 ? Math.max(...lines) : null,
  };
}

export function compactAuditRow(row: PredictionRecord) {
  const snapshot = object(row.snapshot_json);
  const decision = decisionObject(snapshot);
  const gradeAdjustment = object(decision.gradeAdjustment ?? decision.grade_adjustment);
  const coverage = object(snapshot.coverage_at_lock ?? snapshot.coverageAtLock);
  const forecast = object(snapshot.forecast);
  const movement = object(
    forecast.marketMovementAdjustment ??
      object(decision.resolvedMarketRead).movement ??
      snapshot.line_movement,
  );
  const framework = object(snapshot.framework_grades_at_lock);
  const publicSplits = object(snapshot.public_splits);
  const stability = object(snapshot.action_promotion_stability_v1);
  const fullGameEvidence = object(snapshot.mlb_fullgame_market_evidence_v1);
  const marketPrefix = row.market === "moneyline" ? "ml" : row.market === "total" ? "ou" : "nrfi";

  return {
    id: row.id,
    date: row.slate_date,
    matchup: row.matchup,
    market: row.market,
    pick: row.pick,
    side: row.side,
    line: row.line_value,
    price: row.odds_american,
    modelProbability: row.model_probability,
    marketProbability: row.market_probability,
    edge: row.edge,
    grade: row.play_grade,
    actionable: row.no_bet !== true && ["best_angle", "lean"].includes(row.play_grade ?? ""),
    result: resultOf(row),
    release: decisionRelease(snapshot),
    expectedValue: number(decision.expectedValue ?? decision.expected_value ?? stability.exactPriceExpectedValue),
    probabilityGrade:
      string(decision.probabilityGrade ?? decision.probability_grade ?? decision.transition_candidate_grade) ??
      string(snapshot[`${marketPrefix}_play_grade`]),
    movementDirection:
      string(gradeAdjustment.movementDirection ?? gradeAdjustment.movement_direction) ??
      string(movement.directionRelativeToPick ?? movement.direction ?? movement.status) ??
      "unknown",
    sharpDirection:
      string(gradeAdjustment.sharpDirection ?? gradeAdjustment.sharp_direction) ??
      string(framework[`${marketPrefix}_market_signal`]) ??
      "unknown",
    publicDirection:
      string(gradeAdjustment.publicDirection ?? gradeAdjustment.public_direction) ??
      pickedPublicDirection(publicSplits),
    publicSplits: {
      pickedBetsPct: number(publicSplits.picked_bets_pct),
      pickedMoneyPct: number(publicSplits.picked_money_pct),
      support: boolean(publicSplits.support),
      conflict: boolean(publicSplits.conflict),
    },
    coverage: {
      playbookSplits: coverage.playbookSplits ?? null,
      sharpApiSplits: coverage.sharpApiSplits ?? null,
      targetExcludedConsensusReady: coverage.targetExcludedConsensusReady ?? null,
      weather: coverage.weather ?? null,
      injuries: coverage.injuries ?? null,
      warnings: coverage.availabilityWarnings ?? coverage.healthHolds ?? [],
    },
    evaluatedBook:
      string(object(decision.evaluatedQuote ?? decision.evaluated_quote).sportsbook) ??
      string(object(snapshot[`${marketPrefix}_evaluation_price`]).evaluated_book) ??
      string(object(fullGameEvidence.evaluated_price).sportsbook),
    exactPriceState: {
      candidateGrade: string(stability.candidateGrade),
      expectedValue: number(stability.exactPriceExpectedValue),
      priceOnlyCap: string(snapshot[`${marketPrefix}_price_only_action_cap`]),
      evaluatedPrice:
        number(object(snapshot[`${marketPrefix}_evaluation_price`]).evaluated_odds) ??
        number(object(fullGameEvidence.evaluated_price).odds_american),
    },
    multiBook: selectedBookRange(row, snapshot),
  };
}

export function summarizeReleaseCohorts(rows: AuditRow[]) {
  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const key = [row.release, row.market, row.grade ?? "ungraded"].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([key, cohort]) => ({
      key,
      records: cohort.length,
      settled: cohort.filter((row) => ["win", "loss", "push", "void"].includes(row.result)).length,
      wins: cohort.filter((row) => row.result === "win").length,
      losses: cohort.filter((row) => row.result === "loss").length,
      pushes: cohort.filter((row) => row.result === "push").length,
      actionableRecords: cohort.filter((row) => row.actionable).length,
      actionableWins: cohort.filter((row) => row.actionable && row.result === "win").length,
      actionableLosses: cohort.filter((row) => row.actionable && row.result === "loss").length,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function summarizeSignalCohorts(rows: AuditRow[]) {
  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const key = [
      row.release,
      row.market,
      row.actionable ? "actionable" : "held",
      row.movementDirection,
      row.sharpDirection,
      row.publicDirection,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([key, cohort]) => ({
      key,
      settled: cohort.filter((row) => ["win", "loss", "push", "void"].includes(row.result)).length,
      wins: cohort.filter((row) => row.result === "win").length,
      losses: cohort.filter((row) => row.result === "loss").length,
      pushes: cohort.filter((row) => row.result === "push").length,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

type EvidenceVote = "support" | "resistance" | "unknown";

function evidenceVote(value: string): EvidenceVote {
  const normalized = value.toLowerCase();
  if (["support", "toward_pick", "aligned", "market_confirmed", "consensus_support"].includes(normalized)) {
    return "support";
  }
  if (["resistance", "against_pick", "market_resistance", "consensus_resistance", "conflict"].includes(normalized)) {
    return "resistance";
  }
  return "unknown";
}

/**
 * Outcome-blind evidence ballot. Each independently persisted channel gets one
 * vote; there is deliberately no activation threshold and no automatic flip.
 * The same ballot is reported for winners and losers so analysts cannot invent
 * a rule from losses alone.
 */
export function marketEvidenceBallot(row: AuditRow) {
  const channels = [
    ["movement", evidenceVote(row.movementDirection)],
    ["sharp", evidenceVote(row.sharpDirection)],
    ["public", evidenceVote(row.publicDirection)],
  ] as const;
  const supportedBy = channels.filter(([, vote]) => vote === "support").map(([channel]) => channel);
  const opposedBy = channels.filter(([, vote]) => vote === "resistance").map(([channel]) => channel);
  const availableChannels = supportedBy.length + opposedBy.length;
  return {
    availableChannels,
    supportVotes: supportedBy.length,
    resistanceVotes: opposedBy.length,
    netSupportVotes: supportedBy.length - opposedBy.length,
    supportedBy,
    opposedBy,
    mixed: supportedBy.length > 0 && opposedBy.length > 0,
  };
}

export function summarizeEvidenceBallots(rows: AuditRow[]) {
  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const ballot = marketEvidenceBallot(row);
    const key = [row.release, row.market, `net_${ballot.netSupportVotes}`, `available_${ballot.availableChannels}`].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, cohort]) => ({
    key,
    records: cohort.length,
    wins: cohort.filter((row) => row.result === "win").length,
    losses: cohort.filter((row) => row.result === "loss").length,
    pushes: cohort.filter((row) => row.result === "push").length,
  })).sort((left, right) => left.key.localeCompare(right.key));
}

export function rankCounterfactualEvidenceReviews(rows: AuditRow[]) {
  return rows
    .filter((row) => row.result === "win" || row.result === "loss" || row.result === "push")
    .map((row) => ({
      id: row.id,
      date: row.date,
      matchup: row.matchup,
      market: row.market,
      pick: row.pick,
      grade: row.grade,
      actionable: row.actionable,
      result: row.result,
      release: row.release,
      ...marketEvidenceBallot(row),
    }))
    .sort((left, right) =>
      left.netSupportVotes - right.netSupportVotes ||
      right.availableChannels - left.availableChannels ||
      left.date.localeCompare(right.date) ||
      left.id - right.id,
    );
}

function parseArgs(): { sport: Sport; out: string | null; start: string | null; end: string | null; includeRows: boolean } {
  const sportArg = process.argv.find((arg) => arg.startsWith("--sport="))?.slice("--sport=".length);
  if (!DAILY_EDGE_SPORTS.includes(sportArg as Sport)) {
    throw new Error(`Expected --sport=${DAILY_EDGE_SPORTS.join("|")}`);
  }
  const start = process.argv.find((arg) => arg.startsWith("--start="))?.slice("--start=".length) ?? null;
  const end = process.argv.find((arg) => arg.startsWith("--end="))?.slice("--end=".length) ?? start;
  if ((start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end !== null && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
    throw new Error("Expected --start and --end in YYYY-MM-DD form");
  }
  return {
    sport: sportArg as Sport,
    out: process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) ?? null,
    start,
    end,
    includeRows: process.argv.includes("--include-rows"),
  };
}

async function loadRows(sport: Sport, startDate: string | null, endDate: string | null): Promise<PredictionRecord[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");

  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows: PredictionRecord[] = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    let query = client
      .from("prediction_records")
      .select(
        "id,sport,slate_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,no_bet,locked_at,snapshot_json,prediction_grades(result,win,loss,push,void)",
      )
      .eq("sport", sport)
      .not("locked_at", "is", null)
      .order("slate_date", { ascending: true })
      .order("id", { ascending: true });
    if (startDate !== null) query = query.gte("slate_date", startDate);
    if (endDate !== null) query = query.lte("slate_date", endDate);
    const { data, error } = await query.range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as PredictionRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Audit exceeded explicit ${MAX_ROWS}-row safety cap for ${sport}`);
}

async function main() {
  const { sport, out, start, end, includeRows } = parseArgs();
  const rows = (await loadRows(sport, start, end)).map(compactAuditRow);
  const report = {
    generatedAt: new Date().toISOString(),
    sport,
    range: { start, end },
    contract: "immutable_locked_records_release_separated_v1",
    records: rows.length,
    losses: rows.filter((row) => row.result === "loss"),
    releaseCohorts: summarizeReleaseCohorts(rows),
    signalCohorts: summarizeSignalCohorts(rows),
    evidenceBallotCohorts: summarizeEvidenceBallots(rows),
    counterfactualEvidenceReview: rankCounterfactualEvidenceReviews(rows),
    ...(includeRows ? { rows } : {}),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await writeFile(out, json, "utf8");
    console.log(JSON.stringify({ sport, records: rows.length, losses: report.losses.length, out }));
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
