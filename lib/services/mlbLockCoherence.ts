import {
  canonicalActionPromotionIdentity,
  DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE,
  expectedValueAtAmericanOdds,
} from "./dailyEdge/actionPromotionStability";

export const MLB_LOCK_COHERENCE_RELEASE =
  "mlb_lock_coherence_2026_09_02_r3_failed_economics_tuple" as const;

type LockComparableRow = {
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  line_value?: number | null;
  model_probability?: number | null;
  market_probability?: number | null;
  edge?: number | null;
  published_at?: string | null;
  snapshot_json?: unknown;
};

const FIELDS = [
  "pick",
  "side",
  "odds_american",
  "confidence",
  "play_grade",
  "best_angle",
  "no_bet",
] as const;

function isSafeStoredOnlyMarket(rows: LockComparableRow[]): boolean {
  // The first-inning writer intentionally omits a row from `proposed` when
  // fresh data cannot support a current prediction. An existing member row
  // may still truthfully remain as a held Toss-Up. That fail-closed row should
  // freeze with the game instead of blocking otherwise coherent ML/total
  // records. Never tolerate an extra actionable or picked market here.
  return rows.length === 1
    && rows[0]?.market === "first_inning"
    && rows[0]?.no_bet === true
    && (rows[0]?.pick === null || rows[0]?.pick === "Toss-Up");
}

type JsonRecord = Record<string, unknown>;

const GRADE_RANK = { no_play: 0, watchlist: 1, lean: 2, best_angle: 3 } as const;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function lockGrade(row: LockComparableRow): keyof typeof GRADE_RANK {
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true || row.play_grade === "best_angle") return "best_angle";
  if (row.play_grade === "lean") return "lean";
  if (row.play_grade === "market_aligned" || row.play_grade === "watchlist") return "watchlist";
  return "no_play";
}

function sameScalar(first: unknown, second: unknown): boolean {
  return first === second || (typeof first === "number" && typeof second === "number" && Object.is(first, second));
}

function sameEvaluationPrice(candidate: JsonRecord, expectedSnapshot: JsonRecord): boolean {
  const candidatePrice = record(candidate.evaluation_price);
  const expectedPrice = record(expectedSnapshot.ml_evaluation_price);
  if (!candidatePrice || !expectedPrice) return false;
  return sameScalar(candidatePrice.evaluated_book, expectedPrice.evaluated_book) &&
    sameScalar(candidatePrice.evaluated_odds, expectedPrice.evaluated_odds) &&
    sameScalar(candidatePrice.evaluated_observed_at, expectedPrice.evaluated_observed_at);
}

function sameEvaluationIdentity(
  storedSnapshot: JsonRecord,
  expectedSnapshot: JsonRecord,
): boolean {
  const storedPrice = record(storedSnapshot.ml_evaluation_price);
  const expectedPrice = record(expectedSnapshot.ml_evaluation_price);
  if (!storedPrice || !expectedPrice) return false;
  return sameScalar(storedPrice.evaluated_book, expectedPrice.evaluated_book) &&
    sameScalar(storedPrice.evaluated_odds, expectedPrice.evaluated_odds) &&
    sameScalar(storedPrice.evaluated_observed_at, expectedPrice.evaluated_observed_at);
}

function hasCoherentEvaluationPrice(row: LockComparableRow, snapshot: JsonRecord): boolean {
  const evaluation = record(snapshot.ml_evaluation_price);
  const book = evaluation?.evaluated_book;
  const observedAt = evaluation?.evaluated_observed_at;
  return typeof book === "string" && book.trim().length > 0 &&
    typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt)) &&
    sameScalar(evaluation?.evaluated_odds, row.odds_american);
}

const FAILED_ECONOMICS_TUPLE_FIELDS = [
  "pick",
  "side",
  "line_value",
  "odds_american",
  "confidence",
  "model_probability",
  "market_probability",
  "edge",
  "published_at",
] as const;

/**
 * The Moneyline action-stability writer can safely stand an otherwise
 * actionable raw candidate down when its exact evaluated quote is incomplete
 * or fails the sport-owned economics floor. The pregame lock gate compares a
 * fresh raw proposal to that already-finalized public row, so the three public
 * action fields are intentionally different. Recognize only the complete,
 * reproducible failed-economics tuple; every unrelated mismatch still blocks.
 */
function isExactFailedEconomicsStanddown(
  expected: LockComparableRow,
  stored: LockComparableRow,
): boolean {
  if (expected.market !== "moneyline" || stored.market !== "moneyline") return false;
  const expectedGrade = lockGrade(expected);
  if (GRADE_RANK[expectedGrade] < GRADE_RANK.lean) return false;
  if (stored.play_grade !== null || stored.best_angle !== false || stored.no_bet !== true) return false;
  if (!FAILED_ECONOMICS_TUPLE_FIELDS.every((field) => sameScalar(stored[field], expected[field]))) {
    return false;
  }

  const storedSnapshot = record(stored.snapshot_json);
  const expectedSnapshot = record(expected.snapshot_json);
  const state = record(storedSnapshot?.action_promotion_stability_v1);
  const decision = record(storedSnapshot?.decision_pipeline);
  const expectedDecision = record(expectedSnapshot?.decision_pipeline);
  const storedLayers = record(storedSnapshot?.model_layer_versions);
  const layers = record(expectedSnapshot?.model_layer_versions);
  const forecastRelease = typeof layers?.active_probability_head === "string"
    ? layers.active_probability_head
    : typeof layers?.moneyline_probability_head === "string"
      ? layers.moneyline_probability_head
      : null;
  if (
    !storedSnapshot ||
    !expectedSnapshot ||
    !state ||
    !decision ||
    !expectedDecision ||
    !storedLayers ||
    !layers ||
    !forecastRelease
  ) return false;
  if (storedSnapshot.action_promotion_candidate_v1 !== null) return false;
  if (!sameEvaluationIdentity(storedSnapshot, expectedSnapshot)) return false;
  const releaseFields = [
    "decision_release_id",
    "rule_bundle_version",
    "calibration_version",
    "active_probability_head",
    "moneyline_probability_head",
  ];
  if (!releaseFields.every((field) => sameScalar(storedLayers[field], layers[field]))) return false;
  const decisionIdentityFields = ["final_side", "original_side", "action_rule_id", "grade_source"];
  if (!decisionIdentityFields.every((field) => sameScalar(decision[field], expectedDecision[field]))) {
    return false;
  }
  if (
    state.contractRelease !== DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE ||
    state.status !== "failed_economics" ||
    state.candidateGrade !== expectedGrade ||
    !Array.isArray(state.qualifyingCycleIds) ||
    state.qualifyingCycleIds.length !== 0 ||
    state.firstQualifiedAt !== null ||
    state.lastQualifiedAt !== null
  ) return false;
  const selectedSide = expected.side ?? expected.pick;
  if (selectedSide === null) return false;
  const canonicalIdentity = canonicalActionPromotionIdentity({
    sport: "mlb",
    gameId: expected.game_id,
    market: "moneyline",
    selectedSide,
    evaluatedLine: expected.line_value ?? null,
    forecastRelease,
  });
  if (state.canonicalIdentity !== canonicalIdentity) return false;

  const expectedValue = expectedValueAtAmericanOdds(
    expected.model_probability ?? null,
    expected.odds_american,
  );
  if (!sameScalar(state.exactPriceExpectedValue, expectedValue)) return false;
  if (
    decision.board_action !== "no_play" ||
    decision.actionable_grade !== null ||
    decision.transition_candidate_grade !== expectedGrade ||
    decision.transition_final_grade !== "no_play"
  ) return false;

  const reason = decision.transition_reason;
  if (reason === "incoherent_exact_price") {
    return !hasCoherentEvaluationPrice(expected, expectedSnapshot);
  }
  if (reason === "exact_price_economics_failed") {
    return hasCoherentEvaluationPrice(expected, expectedSnapshot) &&
      typeof state.minimumExpectedValue === "number" &&
      expectedValue !== null &&
      expectedValue < state.minimumExpectedValue;
  }
  return false;
}

/**
 * A pending upward Moneyline transition intentionally retains the previous
 * public tuple. The fresh candidate is stored separately in the same row. At
 * T-60 we may freeze that retained public tuple only when the internal
 * candidate exactly accounts for every otherwise-coherence-breaking field.
 */
function isExactPendingPromotion(expected: LockComparableRow, stored: LockComparableRow): boolean {
  if (expected.market !== "moneyline" || stored.market !== "moneyline") return false;
  if (expected.pick !== stored.pick || expected.side !== stored.side) return false;
  const expectedGrade = lockGrade(expected);
  const storedGrade = lockGrade(stored);
  if (GRADE_RANK[expectedGrade] <= GRADE_RANK[storedGrade] || GRADE_RANK[expectedGrade] < GRADE_RANK.lean) return false;

  const storedSnapshot = record(stored.snapshot_json);
  const expectedSnapshot = record(expected.snapshot_json);
  const state = record(storedSnapshot?.action_promotion_stability_v1);
  const candidate = record(storedSnapshot?.action_promotion_candidate_v1);
  const decision = record(storedSnapshot?.decision_pipeline);
  if (!storedSnapshot || !expectedSnapshot || !state || !candidate || !decision) return false;
  if (state.contractRelease !== DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE || state.status !== "pending") return false;
  if (decision.transition_reason !== "promotion_pending_confirmation") return false;

  const candidateFields: Array<[unknown, unknown]> = [
    [candidate.candidate_grade, expectedGrade],
    [candidate.selected_side, expected.side ?? expected.pick],
    [candidate.line_value, expected.line_value ?? null],
    [candidate.odds_american, expected.odds_american],
    [candidate.model_probability, expected.model_probability ?? null],
    [candidate.market_probability, expected.market_probability ?? null],
    [candidate.edge, expected.edge ?? null],
    [candidate.published_at, expected.published_at ?? null],
  ];
  return candidateFields.every(([first, second]) => sameScalar(first, second)) &&
    sameEvaluationPrice(candidate, expectedSnapshot);
}

export function assessMlbLockCoherence(args: {
  gameIds: number[];
  expectedRows: LockComparableRow[];
  storedRows: LockComparableRow[];
}): {
  checked: number;
  coherentGameIds: number[];
  blockedGameIds: number[];
  errors: string[];
} {
  const coherentGameIds: number[] = [];
  const blockedGameIds: number[] = [];
  const errors: string[] = [];

  for (const gameId of args.gameIds) {
    const expected = args.expectedRows.filter((row) => row.game_id === gameId);
    const stored = args.storedRows.filter((row) => row.game_id === gameId);
    const expectedMarkets = [...new Set(expected.map((row) => row.market))].sort();
    const storedMarkets = [...new Set(stored.map((row) => row.market))].sort();
    const gameErrors: string[] = [];

    if (expected.length === 0) gameErrors.push("writer proposed no member records");
    const missingMarkets = expectedMarkets.filter((market) => !storedMarkets.includes(market));
    if (missingMarkets.length > 0) {
      gameErrors.push(`missing stored markets=${missingMarkets.join(",")} expected=${expectedMarkets.join(",")} stored=${storedMarkets.join(",")}`);
    }
    for (const market of storedMarkets.filter((value) => !expectedMarkets.includes(value))) {
      const storedOnlyRows = stored.filter((row) => row.market === market);
      if (!isSafeStoredOnlyMarket(storedOnlyRows)) {
        gameErrors.push(`unexpected stored market=${market} is not a held first-inning Toss-Up`);
      }
    }

    for (const expectedRow of expected) {
      const storedRow = stored.find((row) => row.market === expectedRow.market);
      if (!storedRow) continue;
      const exactPendingPromotion = isExactPendingPromotion(expectedRow, storedRow);
      const exactFailedEconomicsStanddown = isExactFailedEconomicsStanddown(expectedRow, storedRow);
      for (const field of FIELDS) {
        if (
          (exactPendingPromotion && field !== "pick" && field !== "side") ||
          (exactFailedEconomicsStanddown && (
            field === "play_grade" || field === "best_angle" || field === "no_bet"
          ))
        ) continue;
        if (storedRow[field] !== expectedRow[field]) {
          gameErrors.push(`${expectedRow.market}.${field} expected=${String(expectedRow[field])} stored=${String(storedRow[field])}`);
        }
      }
    }

    if (gameErrors.length === 0) {
      coherentGameIds.push(gameId);
    } else {
      blockedGameIds.push(gameId);
      errors.push(...gameErrors.map((error) => `game_id=${gameId}: ${error}`));
    }
  }

  return { checked: args.gameIds.length, coherentGameIds, blockedGameIds, errors };
}
