/**
 * READ ONLY. Exhaustive MLB full-game market-pattern audit.
 *
 * Uses every settled, priced prediction row with locked split evidence and
 * joins the frozen prediction snapshot for movement, projection, quality, and
 * provider-aware agreement. Candidate rules are generated from predeclared
 * market atoms and evaluated chronologically. No production writes.
 *
 * Usage:
 *   node scripts/operator/audit-mlb-full-market-exhaustive.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = "/tmp/oddsphere-audit";
const HISTORY = `${DIR}/deep-market-history-reconstructed-rows-2026-08-11.json`;
const OUTPUT = `${DIR}/mlb-full-market-exhaustive.json`;

const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const implied = (odds) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
const pct = (value) => {
  const parsed = finite(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
};
const sideFromKey = (key) => String(key ?? "").split(":").at(-1);

function snapshotProjection(row, snapshot) {
  const scores = snapshot?.predicted_scores_at_lock ?? {};
  const audit = snapshot?.v2_2_audit ?? {};
  const home = Number(scores.home ?? audit.posterior_home_runs ?? audit.projected_home_runs);
  const away = Number(scores.away ?? audit.posterior_away_runs ?? audit.projected_away_runs);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (row.market === "moneyline") return row.side === "home" ? home - away : away - home;
  const line = finite(row.lockedLine);
  if (line === null) return null;
  const totalGap = home + away - line;
  return row.side === "under" ? -totalGap : totalGap;
}

function sourceSplit(snapshot, provider, market, side) {
  const hit = (snapshot?.source_aware_split_rows_at_lock ?? []).find((split) =>
    split.provider === provider && split.market_type === market && sideFromKey(split.selection_key) === side
  );
  return hit ? { bets: pct(hit.bets_pct), money: pct(hit.money_pct) } : null;
}

function enrich(row, record) {
  const snapshot = record?.snapshot_json ?? {};
  const sharp = sourceSplit(snapshot, "sharpapi", row.market, row.side);
  const playbook = sourceSplit(snapshot, "playbook", row.market, row.side);
  const split = row.split;
  const bets = finite(split?.betsPct);
  const money = finite(split?.moneyPct);
  const movement = String(snapshot?.line_movement?.direction ?? "unknown");
  const decision = snapshot?.decision_pipeline ?? {};
  const projection = snapshotProjection(row, snapshot);
  const modelP = finite(row.modelProbability);
  const price = finite(row.lockedPrice);
  return {
    ...row,
    price,
    breakEven: price === null ? null : implied(price),
    bets,
    money,
    gap: bets === null || money === null ? null : money - bets,
    splitAge: finite(split?.ageMinutes),
    movement,
    finalSideChanged: decision.final_side_changed === true,
    marketAwareCorrectionApplied: decision.market_aware_correction_applied === true,
    inversionTriggered: decision.inversion_triggered === true,
    projection,
    projectionAligned: projection !== null && projection > 0,
    highQuality: snapshot?.v2_data_quality_tier === "high",
    modelP,
    storedEdge: finite(record?.edge),
    activeProbabilityHead: snapshot?.model_layer_versions?.active_probability_head ?? null,
    decisionRelease: snapshot?.decision_pipeline?.release_id ?? null,
    gradePolicy: snapshot?.model_layer_versions?.grade_policy ?? null,
    linesAtLock: Array.isArray(snapshot?.lines_at_lock) ? snapshot.lines_at_lock : [],
    modelEdgeToPrice: modelP === null || price === null ? null : modelP - implied(price),
    sharp,
    playbook,
    sharpGap: sharp ? sharp.money - sharp.bets : null,
    playbookGap: playbook ? playbook.money - playbook.bets : null,
    crossSourceMoneyAgreement: sharp && playbook ? (sharp.money - 50) * (playbook.money - 50) > 0 : null,
    crossSourceTicketAgreement: sharp && playbook ? (sharp.bets - 50) * (playbook.bets - 50) > 0 : null,
    result: row.result,
    y: row.result === "win" ? 1 : row.result === "loss" ? 0 : null,
    noBet: record?.no_bet === true,
    held: record?.held === true || snapshot?.held === true,
  };
}

function oppositeRow(row) {
  const oppositeSide = row.market === "moneyline"
    ? row.side === "home" ? "away" : "home"
    : row.side === "under" ? "over" : "under";
  const sameMarket = row.linesAtLock.filter((offer) =>
    offer.market_type === row.market &&
    (row.market !== "total" || Math.abs(Number(offer.line_value) - Number(row.lockedLine)) < 0.001)
  );
  const selectedOffers = sameMarket.filter((offer) => offer.side === row.side && finite(offer.odds_american) !== null);
  const selectedOffer = selectedOffers.sort((left, right) =>
    Math.abs(Number(left.odds_american) - row.price) - Math.abs(Number(right.odds_american) - row.price)
  )[0];
  const oppositeOffers = sameMarket.filter((offer) => offer.side === oppositeSide && finite(offer.odds_american) !== null);
  const sameBook = selectedOffer
    ? oppositeOffers.filter((offer) => offer.sportsbook === selectedOffer.sportsbook).sort((a, b) => Number(b.odds_american) - Number(a.odds_american))[0]
    : null;
  const offer = sameBook ?? oppositeOffers.sort((a, b) => Number(b.odds_american) - Number(a.odds_american))[0];
  if (!offer) return null;
  return {
    ...row,
    id: `opposite:${row.id}`,
    side: oppositeSide,
    price: Number(offer.odds_american),
    result: row.result === "win" ? "loss" : row.result === "loss" ? "win" : "push",
    y: row.y === 1 ? 0 : row.y === 0 ? 1 : null,
    oppositePriceMode: sameBook ? "same_book" : "best_available_fallback",
  };
}

function oppositeSideAudit(rows) {
  const definitions = [
    ["all_with_opposite_price", () => true],
    ["gap_lte_-5", (row) => row.gap <= -5],
    ["gap_lte_-10", (row) => row.gap <= -10],
    ["gap_lte_-15", (row) => row.gap <= -15],
    ["movement_against", (row) => row.movement === "against_pick"],
    ["gap_lte_-10__movement_against", (row) => row.gap <= -10 && row.movement === "against_pick"],
    ["projection_opposed", (row) => row.projection !== null && row.projection <= 0],
    ["gap_lte_-10__projection_opposed", (row) => row.gap <= -10 && row.projection !== null && row.projection <= 0],
  ];
  return Object.fromEntries(definitions.map(([id, test]) => {
    const originals = rows.filter(test);
    const opposites = originals.map(oppositeRow).filter(Boolean);
    const split = partitions(opposites);
    return [id, {
      originals: metrics(originals.filter((row) => opposites.some((opposite) => opposite.id === `opposite:${row.id}`))),
      opposites: metrics(opposites),
      oppositeTrain: metrics(split.train),
      oppositeValidation: metrics(split.validation),
      oppositeHoldout: metrics(split.holdout),
      oppositeBootstrap: clusterBootstrap(opposites, 20000),
      sameBookPrices: opposites.filter((row) => row.oppositePriceMode === "same_book").length,
      bestAvailableFallbackPrices: opposites.filter((row) => row.oppositePriceMode === "best_available_fallback").length,
    }];
  }));
}

function namedCandidate(rows, id, test) {
  const split = partitions(rows);
  const matched = rows.filter(test);
  const byProbabilityHead = Object.fromEntries(
    [...Map.groupBy(matched, (row) => row.activeProbabilityHead ?? "unknown").entries()]
      .map(([head, values]) => [head, metrics(values)])
  );
  const byDecisionRelease = Object.fromEntries(
    [...Map.groupBy(matched, (row) => row.decisionRelease ?? "unknown").entries()]
      .map(([release, values]) => [release, metrics(values)])
  );
  return {
    id,
    train: metrics(matched.filter((row) => split.train.includes(row))),
    validation: metrics(matched.filter((row) => split.validation.includes(row))),
    holdout: metrics(matched.filter((row) => split.holdout.includes(row))),
    combined: metrics(matched),
    bootstrap: clusterBootstrap(matched, 20000),
    byProbabilityHead,
    byDecisionRelease,
  };
}

function namedMarketCandidate(rows, id, test) {
  const candidate = namedCandidate(rows, id, test);
  const matched = rows.filter(test);
  const split = partitions(rows);
  return {
    ...candidate,
    bySide: Object.fromEntries([...Map.groupBy(matched, (row) => row.side).entries()].map(([side, values]) => [side, metrics(values)])),
    bySideChronology: Object.fromEntries([...Map.groupBy(matched, (row) => row.side).entries()].map(([side, values]) => [side, {
      train: metrics(values.filter((row) => split.train.includes(row))),
      validation: metrics(values.filter((row) => split.validation.includes(row))),
      holdout: metrics(values.filter((row) => split.holdout.includes(row))),
    }])),
    byFinalSideChanged: Object.fromEntries([...Map.groupBy(matched, (row) => String(row.finalSideChanged)).entries()].map(([changed, values]) => [changed, metrics(values)])),
    byCorrectionState: Object.fromEntries([...Map.groupBy(matched, (row) => row.marketAwareCorrectionApplied || row.inversionTriggered ? "corrected_or_inverted" : "correction_safe").entries()].map(([state, values]) => [state, metrics(values)])),
    bySplitSource: Object.fromEntries([...Map.groupBy(matched, (row) => row.split?.source ?? "missing").entries()].map(([source, values]) => [source, metrics(values)])),
    rowIds: matched.map((row) => row.id),
  };
}

function totalUnderNamedSensitivity(rows) {
  const under = rows.filter((row) => row.side === "under");
  const base = (row) => row.gap <= -5;
  const fresh = (row) => row.splitAge !== null && row.splitAge <= 60;
  const notAgainst = (row) => row.movement !== "against_pick";
  const playable = (row) => row.price >= -145 && row.price <= 110;
  const currentPrice = (row) => row.price >= -145 && row.price <= -105;
  const modelNonnegative = (row) => row.modelEdgeToPrice !== null && row.modelEdgeToPrice >= 0;
  const storedNonnegative = (row) => row.storedEdge !== null && row.storedEdge >= 0;
  return [
    namedCandidate(under, "under_gap_lte_-5", base),
    namedCandidate(under, "under_gap_lte_-5__not_against", (row) => base(row) && notAgainst(row)),
    namedCandidate(under, "under_gap_lte_-5__fresh_60", (row) => base(row) && fresh(row)),
    namedCandidate(under, "under_gap_lte_-5__not_against__fresh_60", (row) => base(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "under_gap_lte_-5__playable__not_against__fresh_60", (row) => base(row) && playable(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "under_gap_lte_-5__playable__not_against__fresh_60__high_quality", (row) => base(row) && playable(row) && notAgainst(row) && fresh(row) && row.highQuality),
    namedCandidate(under, "under_gap_lte_-5__playable__not_against__fresh_60__projection_aligned", (row) => base(row) && playable(row) && notAgainst(row) && fresh(row) && row.projectionAligned),
    namedCandidate(under, "under_gap_lte_-5__playable__not_against__fresh_60__high_quality__projection_aligned", (row) => base(row) && playable(row) && notAgainst(row) && fresh(row) && row.highQuality && row.projectionAligned),
    namedCandidate(under, "under_gap_lte_-5__tickets_lte_50__playable__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "candidate_tickets_lte_50__current_price__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && currentPrice(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "candidate_tickets_lte_50__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 50 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality),
    namedCandidate(under, "candidate_tickets_lte_35__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality),
    namedCandidate(under, "incremental_r30_model_or_projection_rejects__tickets_lte_35__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && !(row.projectionAligned && row.modelP >= 0.55 && modelNonnegative(row) && row.modelEdgeToPrice < 0.05)),
    namedCandidate(under, "exact35_projection_opposed__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && row.projection !== null && row.projection <= 0),
    namedCandidate(under, "exact35_model_p_below_55__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && row.modelP < 0.55),
    namedCandidate(under, "exact35_recomputed_edge_negative__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && row.modelEdgeToPrice < 0),
    namedCandidate(under, "candidate_exact35_projection_aligned__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && row.projectionAligned),
    namedCandidate(under, "incremental_r30_model_or_edge_rejects__exact35_projection_aligned__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 35 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && row.projectionAligned && !(row.modelP >= 0.55 && modelNonnegative(row) && row.modelEdgeToPrice < 0.05)),
    namedCandidate(under, "production_candidate_exact35__current_price__high_quality__projection_aligned", (row) => base(row) && row.bets <= 35 && currentPrice(row) && row.highQuality && row.projectionAligned),
    namedCandidate(under, "production_incremental_remove_model_probability_and_edge_guards", (row) => base(row) && row.bets <= 35 && currentPrice(row) && row.highQuality && row.projectionAligned && !(row.modelP >= 0.55 && modelNonnegative(row) && row.modelEdgeToPrice < 0.05)),
    namedCandidate(under, "incremental_tickets_35_to_50__current_price__not_against__fresh_60", (row) => base(row) && row.bets > 35 && row.bets <= 50 && currentPrice(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "incremental_tickets_35_to_50__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets > 35 && row.bets <= 50 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality),
    namedCandidate(under, "incremental_r30_model_or_projection_rejects__tickets_lte_50__current_price__not_against__fresh_60__high_quality", (row) => base(row) && row.bets <= 50 && currentPrice(row) && notAgainst(row) && fresh(row) && row.highQuality && !(row.projectionAligned && row.modelP >= 0.55 && modelNonnegative(row) && row.modelEdgeToPrice < 0.05)),
    namedCandidate(under, "incremental_tickets_35_to_50__playable__not_against__fresh_60", (row) => base(row) && row.bets > 35 && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row)),
    namedCandidate(under, "incremental_price_above_-105_to_110__tickets_lte_35__not_against__fresh_60", (row) => base(row) && row.bets <= 35 && row.price > -105 && row.price <= 110 && notAgainst(row) && fresh(row)),
    namedCandidate(under, "excluded_movement_against__tickets_lte_50__playable__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && row.movement === "against_pick" && fresh(row)),
    namedCandidate(under, "excluded_stale_over_60__tickets_lte_50__playable__not_against", (row) => base(row) && row.bets <= 50 && playable(row) && row.splitAge !== null && row.splitAge > 60 && notAgainst(row)),
    namedCandidate(under, "excluded_projection_opposed__tickets_lte_50__playable__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row) && row.projection !== null && row.projection <= 0),
    namedCandidate(under, "excluded_non_high_quality__tickets_lte_50__playable__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row) && !row.highQuality),
    namedCandidate(under, "excluded_model_p_below_55__tickets_lte_50__playable__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row) && row.modelP < 0.55),
    namedCandidate(under, "excluded_recomputed_edge_negative__tickets_lte_50__playable__not_against__fresh_60", (row) => base(row) && row.bets <= 50 && playable(row) && notAgainst(row) && fresh(row) && row.modelEdgeToPrice < 0),
    namedCandidate(under, "under_gap_lte_-5__tickets_lte_35__current_price", (row) => base(row) && row.bets <= 35 && currentPrice(row)),
    namedCandidate(under, "r30_guarded_approx_recomputed_edge", (row) => base(row) && row.bets <= 35 && currentPrice(row) && row.highQuality && row.projectionAligned && row.modelP >= 0.55 && modelNonnegative(row) && row.modelEdgeToPrice < 0.05),
    namedCandidate(under, "r30_guarded_stored_edge", (row) => base(row) && row.bets <= 35 && currentPrice(row) && row.highQuality && row.projectionAligned && row.modelP >= 0.55 && storedNonnegative(row) && row.storedEdge < 0.05),
  ];
}

function unitProfit(row) {
  if (row.result === "push") return 0;
  if (row.result === "loss") return -1;
  return row.price > 0 ? row.price / 100 : 100 / Math.abs(row.price);
}

function metrics(rows) {
  const settled = rows.filter((row) => row.y !== null && row.price !== null);
  if (!settled.length) return { n: 0, dates: 0, record: "0-0", units: 0, roiPct: null, hitRatePct: null };
  const wins = settled.filter((row) => row.result === "win").length;
  const losses = settled.filter((row) => row.result === "loss").length;
  const pushes = settled.filter((row) => row.result === "push").length;
  const units = settled.reduce((sum, row) => sum + unitProfit(row), 0);
  return {
    n: settled.length,
    dates: new Set(settled.map((row) => row.date)).size,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: +units.toFixed(3),
    roiPct: +(100 * units / settled.length).toFixed(1),
    hitRatePct: wins + losses ? +(100 * wins / (wins + losses)).toFixed(1) : null,
  };
}

function clusterBootstrap(rows, iterations = 10000) {
  const groups = [...Map.groupBy(rows, (row) => row.date).values()];
  if (!groups.length) return null;
  let state = 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 16), 0x21f0aaad) + 0x735a2d97) | 0;
    return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
  };
  const rois = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = [];
    for (let index = 0; index < groups.length; index++) sample.push(...groups[Math.floor(random() * groups.length)]);
    rois.push(100 * sample.reduce((sum, row) => sum + unitProfit(row), 0) / sample.length);
  }
  rois.sort((a, b) => a - b);
  const q = (p) => rois[Math.min(rois.length - 1, Math.floor(p * rois.length))];
  return {
    iterations,
    dateClusters: groups.length,
    roiP05: +q(0.05).toFixed(1),
    roiMedian: +q(0.5).toFixed(1),
    roiP95: +q(0.95).toFixed(1),
    probabilityPositiveRoi: +(rois.filter((value) => value > 0).length / rois.length).toFixed(4),
  };
}

function partitions(rows) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const trainEnd = Math.floor(dates.length * 0.6);
  const validationEnd = Math.floor(dates.length * 0.8);
  const trainDates = new Set(dates.slice(0, trainEnd));
  const validationDates = new Set(dates.slice(trainEnd, validationEnd));
  return {
    boundaries: {
      dates: dates.length,
      train: [dates[0], dates[trainEnd - 1]],
      validation: [dates[trainEnd], dates[validationEnd - 1]],
      holdout: [dates[validationEnd], dates.at(-1)],
    },
    train: rows.filter((row) => trainDates.has(row.date)),
    validation: rows.filter((row) => validationDates.has(row.date)),
    holdout: rows.filter((row) => !trainDates.has(row.date) && !validationDates.has(row.date)),
  };
}

function atom(id, kind, test) { return { id, kind, test }; }

function atomsFor(market) {
  const splitAtoms = [
    ...[55, 60, 65, 70, 75, 80].map((threshold) => atom(`money_gte_${threshold}`, "split", (row) => row.money >= threshold)),
    ...[40, 50, 60, 70, 80].map((threshold) => atom(`bets_gte_${threshold}`, "split", (row) => row.bets >= threshold)),
    ...[5, 10, 15, 20].map((threshold) => atom(`gap_gte_${threshold}`, "split", (row) => row.gap >= threshold)),
    ...[5, 10, 15, 20].map((threshold) => atom(`gap_lte_minus_${threshold}`, "split", (row) => row.gap <= -threshold)),
    ...[55, 60, 65, 70].map((threshold) => atom(`money_and_bets_gte_${threshold}`, "split", (row) => row.money >= threshold && row.bets >= threshold)),
  ];
  const contexts = [
    atom("movement_toward", "movement", (row) => row.movement === "toward_pick"),
    atom("movement_not_against", "movement", (row) => row.movement !== "against_pick"),
    atom("movement_neutral", "movement", (row) => row.movement === "neutral"),
    atom("movement_against", "movement", (row) => row.movement === "against_pick"),
    atom("projection_aligned", "projection", (row) => row.projectionAligned),
    atom("projection_gap_gte_0_5", "projection", (row) => row.projection >= 0.5),
    atom("projection_gap_gte_1", "projection", (row) => row.projection >= 1),
    atom("projection_opposed", "projection", (row) => row.projection !== null && row.projection <= 0),
    atom("high_quality", "quality", (row) => row.highQuality),
    atom("split_age_lte_30", "age", (row) => row.splitAge !== null && row.splitAge <= 30),
    atom("split_age_lte_60", "age", (row) => row.splitAge !== null && row.splitAge <= 60),
    atom("cross_source_money_agree", "source", (row) => row.crossSourceMoneyAgreement === true),
    atom("cross_source_both_agree", "source", (row) => row.crossSourceMoneyAgreement === true && row.crossSourceTicketAgreement === true),
    atom("sharp_gap_lte_minus_5", "sharp_split", (row) => row.sharpGap !== null && row.sharpGap <= -5),
    atom("sharp_gap_lte_minus_10", "sharp_split", (row) => row.sharpGap !== null && row.sharpGap <= -10),
    atom("sharp_gap_lte_minus_15", "sharp_split", (row) => row.sharpGap !== null && row.sharpGap <= -15),
    atom("sharp_gap_gte_5", "sharp_split", (row) => row.sharpGap !== null && row.sharpGap >= 5),
    atom("sharp_gap_gte_10", "sharp_split", (row) => row.sharpGap !== null && row.sharpGap >= 10),
    atom("playbook_gap_lte_minus_5", "playbook_split", (row) => row.playbookGap !== null && row.playbookGap <= -5),
    atom("playbook_gap_lte_minus_10", "playbook_split", (row) => row.playbookGap !== null && row.playbookGap <= -10),
    atom("playbook_gap_gte_5", "playbook_split", (row) => row.playbookGap !== null && row.playbookGap >= 5),
    atom("playbook_gap_gte_10", "playbook_split", (row) => row.playbookGap !== null && row.playbookGap >= 10),
  ];
  const priceBands = market === "moneyline" ? [
    [-220, -181], [-180, -161], [-160, -141], [-140, -121], [-120, -101], [-100, 120], [121, 160], [161, 200],
  ] : [[-145, -121], [-120, -111], [-110, -101], [-100, 110], [111, 145]];
  contexts.push(...priceBands.map(([low, high]) => atom(`price_${low}_to_${high}`, "price", (row) => row.price >= low && row.price <= high)));
  const sides = market === "moneyline" ? ["home", "away"] : ["under", "over"];
  contexts.push(...sides.map((side) => atom(`side_${side}`, "side", (row) => row.side === side)));
  const weakModel = [
    atom("model_p_gte_50", "model", (row) => row.modelP >= 0.5),
    atom("model_p_gte_54", "model", (row) => row.modelP >= 0.54),
    atom("model_p_gte_58", "model", (row) => row.modelP >= 0.58),
    atom("model_edge_nonnegative", "model", (row) => row.modelEdgeToPrice >= 0),
  ];
  return { splitAtoms, contexts, weakModel };
}

function validCombination(atoms) {
  const kinds = atoms.map((value) => value.kind);
  return new Set(kinds).size === kinds.length;
}

function generateRules(market, includeModel) {
  const { splitAtoms, contexts, weakModel } = atomsFor(market);
  const optional = includeModel ? [...contexts, ...weakModel] : contexts;
  const rules = [];
  for (const split of splitAtoms) {
    rules.push([split]);
    for (const first of optional) rules.push([split, first]);
    for (let i = 0; i < optional.length; i++) for (let j = i + 1; j < optional.length; j++) {
      const values = [split, optional[i], optional[j]];
      if (validCombination(values)) rules.push(values);
    }
  }
  return rules;
}

function evaluateRules(rows, market, includeModel) {
  const split = partitions(rows);
  const availableAtoms = atomsFor(market);
  const definitions = new Map([
    ...availableAtoms.splitAtoms,
    ...availableAtoms.contexts,
    ...availableAtoms.weakModel,
  ].map((value) => [value.id, value]));
  const seen = new Set();
  const evaluated = [];
  for (const atoms of generateRules(market, includeModel)) {
    const matched = rows.filter((row) => atoms.every((value) => value.test(row)));
    const signature = matched.map((row) => row.id).sort().join(",");
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    const train = matched.filter((row) => split.train.includes(row));
    const validation = matched.filter((row) => split.validation.includes(row));
    const holdout = matched.filter((row) => split.holdout.includes(row));
    if (train.length < 20 || validation.length < 8 || holdout.length < 8) continue;
    const trainMetrics = metrics(train);
    const validationMetrics = metrics(validation);
    if ((trainMetrics.roiPct ?? -999) <= 0 || (validationMetrics.roiPct ?? -999) <= 0) continue;
    evaluated.push({
      id: atoms.map((value) => value.id).join("__"),
      conditions: atoms.map((value) => value.id),
      usesModel: atoms.some((value) => value.kind === "model"),
      train: trainMetrics,
      validation: validationMetrics,
      holdout: metrics(holdout),
      combined: metrics(matched),
    });
  }
  const holdoutPositive = evaluated.filter((rule) => (rule.holdout.roiPct ?? -999) > 0)
    .map((rule) => {
      const matched = rows.filter((row) => rule.conditions.every((condition) => {
        const definition = definitions.get(condition);
        return definition?.test(row) === true;
      }));
      return { ...rule, bootstrap: clusterBootstrap(matched, 2000) };
    });
  return {
    boundaries: split.boundaries,
    uniqueCandidatesTested: seen.size,
    trainValidationPositive: evaluated.length,
    robust: holdoutPositive.filter((rule) =>
      (rule.bootstrap?.roiP05 ?? -999) > 0
    ).sort((a, b) => b.holdout.roiPct - a.holdout.roiPct || b.holdout.n - a.holdout.n),
    holdoutPositive: holdoutPositive
      .sort((a, b) => (b.bootstrap?.probabilityPositiveRoi ?? 0) - (a.bootstrap?.probabilityPositiveRoi ?? 0) || b.holdout.n - a.holdout.n)
      .slice(0, 50),
  };
}

function focusedTotalUnderSearch(rows) {
  const split = partitions(rows);
  const options = {
    gap: [
      { id: "gap_lte_-5", test: (row) => row.gap <= -5 },
      { id: "gap_lte_-10", test: (row) => row.gap <= -10 },
      { id: "gap_lte_-15", test: (row) => row.gap <= -15 },
    ],
    movement: [
      { id: "movement_any", test: () => true },
      { id: "movement_not_against", test: (row) => row.movement !== "against_pick" },
      { id: "movement_toward", test: (row) => row.movement === "toward_pick" },
    ],
    projection: [
      { id: "projection_any", test: () => true },
      { id: "projection_aligned", test: (row) => row.projectionAligned },
      { id: "projection_gap_gte_0_5", test: (row) => row.projection >= 0.5 },
    ],
    quality: [
      { id: "quality_any", test: () => true },
      { id: "quality_high", test: (row) => row.highQuality },
    ],
    price: [
      { id: "price_any", test: () => true },
      { id: "price_-145_to_110", test: (row) => row.price >= -145 && row.price <= 110 },
      { id: "price_-120_to_110", test: (row) => row.price >= -120 && row.price <= 110 },
      { id: "price_-110_to_110", test: (row) => row.price >= -110 && row.price <= 110 },
    ],
    age: [
      { id: "age_any", test: () => true },
      { id: "age_lte_60", test: (row) => row.splitAge !== null && row.splitAge <= 60 },
      { id: "age_lte_30", test: (row) => row.splitAge !== null && row.splitAge <= 30 },
    ],
    bets: [
      { id: "bets_any", test: () => true },
      { id: "bets_lte_65", test: (row) => row.bets <= 65 },
      { id: "bets_lte_50", test: (row) => row.bets <= 50 },
      { id: "bets_lte_35", test: (row) => row.bets <= 35 },
    ],
    model: [
      { id: "model_unused", test: () => true },
      { id: "model_p_gte_50", test: (row) => row.modelP >= 0.5 },
      { id: "model_p_gte_54", test: (row) => row.modelP >= 0.54 },
      { id: "model_p_gte_55", test: (row) => row.modelP >= 0.55 },
      { id: "model_edge_nonnegative", test: (row) => row.modelEdgeToPrice >= 0 },
    ],
  };
  const seen = new Set();
  const candidates = [];
  for (const gap of options.gap)
    for (const movement of options.movement)
      for (const projection of options.projection)
        for (const quality of options.quality)
          for (const price of options.price)
            for (const age of options.age)
              for (const bets of options.bets)
                for (const model of options.model) {
                  const conditions = [gap, movement, projection, quality, price, age, bets, model];
                  const matched = rows.filter((row) => conditions.every((condition) => condition.test(row)));
                  const signature = matched.map((row) => row.id).sort().join(",");
                  if (!signature || seen.has(signature)) continue;
                  seen.add(signature);
                  const train = matched.filter((row) => split.train.includes(row));
                  const validation = matched.filter((row) => split.validation.includes(row));
                  const holdout = matched.filter((row) => split.holdout.includes(row));
                  if (train.length < 20 || validation.length < 8 || holdout.length < 8) continue;
                  const trainMetrics = metrics(train);
                  const validationMetrics = metrics(validation);
                  const holdoutMetrics = metrics(holdout);
                  if ((trainMetrics.roiPct ?? -999) <= 0 || (validationMetrics.roiPct ?? -999) <= 0 || (holdoutMetrics.roiPct ?? -999) <= 0) continue;
                  candidates.push({
                    id: conditions.map((condition) => condition.id).join("__"),
                    conditions: conditions.map((condition) => condition.id),
                    usesModel: model.id !== "model_unused",
                    train: trainMetrics,
                    validation: validationMetrics,
                    holdout: holdoutMetrics,
                    combined: metrics(matched),
                    matched,
                  });
                }
  const ranked = candidates
    .sort((left, right) => right.combined.n - left.combined.n || right.holdout.roiPct - left.holdout.roiPct)
    .slice(0, 250)
    .map((candidate) => ({ ...candidate, bootstrap: clusterBootstrap(candidate.matched, 5000) }));
  const compact = (candidate) => {
    const { matched, ...rest } = candidate;
    return rest;
  };
  return {
    boundaries: split.boundaries,
    uniqueCandidateRowSets: seen.size,
    positiveAllSegments: candidates.length,
    robust: ranked.filter((candidate) => (candidate.bootstrap?.roiP05 ?? -999) > 0).map(compact),
    largestPositiveAllSegments: ranked.slice(0, 50).map(compact),
  };
}

const cacheFiles = (await readdir(DIR)).filter((name) => /^cache-prediction-records-mlb-.*\.json$/.test(name));
const records = new Map();
for (const file of cacheFiles) {
  for (const row of JSON.parse(await readFile(`${DIR}/${file}`, "utf8"))) records.set(row.id, row);
}
const history = JSON.parse(await readFile(HISTORY, "utf8"));
const allRows = history
  .filter((row) => row.sport === "mlb" && ["moneyline", "total"].includes(row.market) && !row.launchDay)
  .map((row) => enrich(row, records.get(row.id) ?? {}))
  .filter((row) => row.price !== null && row.bets !== null && row.money !== null && row.y !== null);

const output = {
  generatedAt: new Date().toISOString(),
  databaseWrites: false,
  scope: "all settled non-launch MLB full-game rows with a price and locked split evidence",
  featureCoverage: {},
  markets: {},
};
for (const market of ["moneyline", "total"]) {
  const rows = allRows.filter((row) => row.market === market);
  const nonactionable = rows.filter((row) => !row.actionable && !row.noBet && !row.held);
  output.featureCoverage[market] = {
    rows: rows.length,
    nonactionable: nonactionable.length,
    excludedNoBetOrHeld: rows.filter((row) => !row.actionable && (row.noBet || row.held)).length,
    dates: new Set(rows.map((row) => row.date)).size,
    movement: rows.filter((row) => row.movement !== "unknown").length,
    projection: rows.filter((row) => row.projection !== null).length,
    sourceAwareBoth: rows.filter((row) => row.sharp && row.playbook).length,
    highQuality: rows.filter((row) => row.highQuality).length,
  };
  output.markets[market] = {
    baseline: metrics(rows),
    nonactionableBaseline: metrics(nonactionable),
    marketOnly: evaluateRules(nonactionable, market, false),
    weakModel: evaluateRules(nonactionable, market, true),
    oppositeSideAudit: oppositeSideAudit(rows),
    ...(market === "total" ? {
      focusedTotalUnder: focusedTotalUnderSearch(nonactionable.filter((row) => row.side === "under")),
      totalUnderNamedSensitivity: totalUnderNamedSensitivity(nonactionable),
      namedMarketCandidates: [
        namedMarketCandidate(nonactionable, "sharpapi_money_over_tickets_10__movement_not_against__high_quality__playable_price", (row) =>
          row.gap >= 10 && row.movement !== "against_pick" && row.highQuality && row.price >= -145 && row.price <= 145
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_over_tickets_5__movement_not_against__high_quality__playable_price", (row) =>
          row.gap >= 5 && row.movement !== "against_pick" && row.highQuality && row.price >= -145 && row.price <= 145
        ),
      ],
    } : {
      namedMarketCandidates: [
        namedMarketCandidate(nonactionable, "sharpapi_money_gte_55__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 55 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_55__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 55 && row.bets >= 55 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_60__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 60 && row.bets >= 60 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_65__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 65 && row.bets >= 65 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_tickets_gte_70__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.bets >= 70 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_70__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 70 && row.bets >= 70 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_75__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 75 && row.bets >= 75 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
        namedMarketCandidate(nonactionable, "sharpapi_money_and_tickets_gte_80__movement_neutral__high_quality__price_minus200_to_plus200", (row) =>
          row.money >= 80 && row.bets >= 80 && row.movement === "neutral" && row.highQuality && row.price >= -200 && row.price <= 200 && !row.marketAwareCorrectionApplied && !row.inversionTriggered
        ),
      ],
    }),
  };
}

await writeFile(OUTPUT, JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  output: OUTPUT,
  featureCoverage: output.featureCoverage,
  summary: Object.fromEntries(Object.entries(output.markets).map(([market, value]) => [market, {
    baseline: value.baseline,
    nonactionableBaseline: value.nonactionableBaseline,
    marketOnlyTested: value.marketOnly.uniqueCandidatesTested,
    marketOnlyTrainValidationPositive: value.marketOnly.trainValidationPositive,
    marketOnlyRobust: value.marketOnly.robust.length,
    weakModelTested: value.weakModel.uniqueCandidatesTested,
    weakModelTrainValidationPositive: value.weakModel.trainValidationPositive,
    weakModelRobust: value.weakModel.robust.length,
  }]))
}, null, 2));
