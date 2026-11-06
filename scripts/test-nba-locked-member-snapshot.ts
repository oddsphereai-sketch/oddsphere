import assert from "node:assert/strict";
import { sanitizeRetainedSharpSplitPresentation } from "../lib/providers/real_api/sharpApiCurrentSplits";

import type { NbaDailyEdgeDto, NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import type { NbaMemberGameEvidence } from "../lib/services/nba/nbaMemberMarketEvidence";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import { adaptNbaToDailyEdgeResponse } from "../lib/services/nba/adaptNbaToDailyEdgeResponse";
import {
  applyNbaLockedMemberSnapshotPrecedence,
  buildNbaLockedMemberCapture,
  NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE,
} from "../lib/services/nba/nbaLockedMemberSnapshot";

const dynamic = {
  game_external_id: 9001,
  matchup: "AWY @ HME",
  projection: { home_score: 120, away_score: 110, total: 230, spread_home: 10 },
  intelligence: { ml: { pick_side: "home", grade: "lean", named_book_posture: {
    release: "nba_named_book_posture_2026_10_31_r1_observed_opposition", market: "moneyline", pickedSide: "home",
    evaluatedAt: "2026-10-20T22:05:00Z", supportingSources: [], opposingSources: ["pinnacle"],
    conflictingSources: [], forecastAuthorityGranted: false,
  } } },
  injuries: {
    source: "espn",
    home_known: true,
    away_known: true,
    home_players: [{ player_id: null, name: "New Report", status: "out" }],
    away_players: [],
  },
} as unknown as NbaDailyEdgeGameDto;
const locked = {
  ...dynamic,
  projection: { home_score: 116, away_score: 113, total: 229, spread_home: 3 },
  intelligence: { ml: { pick_side: "home" } },
} as NbaDailyEdgeGameDto;
const map = new Map([[9001, 44]]);
const lockedMemberGame = {
  id: "nba-9001",
  external_id: 9001,
  gameStartAt: "2026-10-20T23:00:00.000Z",
  scheduledLockAt: "2026-10-20T22:00:00.000Z",
  lockState: "locking",
  lockedAt: null,
  predictions: {},
  breakdown: {
    sharpRead: { key: "no_data", sentence: "Exact legacy sharp summary." },
    modelBreakdown: "Exact legacy model summary.",
  },
  markets: {
    moneyline: {
      guidedWatchOut: "Exact legacy caution, even when current posture differs.",
      whyLine: "Exact legacy explanation.",
      publicSplits: [
        { side: "away", label: "AWY", betsPct: 42, moneyPct: 61 },
        { side: "home", label: "HME", betsPct: 58, moneyPct: 39 },
      ],
      oddsTrail: [{ label: "first", american: 105, line: null, observedAt: "2026-10-20T12:00:00Z" }],
      opposingOddsTrail: {
        side: "home",
        label: "HME",
        stops: [{ label: "first", american: -115, line: null, observedAt: "2026-10-20T12:00:00Z" }],
      },
    },
  },
} as unknown as DailyEdgeGameDto;
const capture = buildNbaLockedMemberCapture({ gameDto: locked, memberGame: lockedMemberGame });
const rows = ["moneyline", "spread", "total"].map((market) => ({
  game_id: 44,
  market,
  locked_at: "2026-10-20T22:00:00.000Z",
  snapshot_json: capture,
}));

const restored = applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows,
});
assert.deepEqual(restored.games, [{ ...locked, locked_at: "2026-10-20T22:00:00.000Z" }]);
assert.notEqual(restored.games[0], dynamic);
const r28Locked=structuredClone(locked);
r28Locked.intelligence.grade_policy_release="nba_grade_policy_2026_11_04_r28_composed_named_book_opposition";
r28Locked.intelligence.ml.grade="watch";
const r29Dynamic=structuredClone(dynamic);
r29Dynamic.intelligence.grade_policy_release="nba_grade_policy_2026_11_06_r29_confidence_led_lean";
r29Dynamic.intelligence.ml.grade="lean";
const r28Member=structuredClone(lockedMemberGame);
r28Member.markets.moneyline.verdict={key:"watchlist",label:"Watchlist"};
const r28Capture=buildNbaLockedMemberCapture({gameDto:r28Locked,memberGame:r28Member});
const r28Rows=rows.map(row=>({...row,snapshot_json:r28Capture}));
const r28Bytes=JSON.stringify(r28Rows);
const r28Restored=applyNbaLockedMemberSnapshotPrecedence({games:[r29Dynamic],dbIdByExternalId:map,rows:r28Rows});
assert.equal(r28Restored.games[0].intelligence.ml.grade,"watch","New confidence-led grading cannot relabel a stored R28 Watch");
assert.equal(r28Restored.games[0].intelligence.grade_policy_release,r28Locked.intelligence.grade_policy_release);
const r28Response=adaptNbaToDailyEdgeResponse({as_of:"2026-11-06T19:00:00Z",slate_date_et:"2026-10-20",market_signals_capability:"available",games:r28Restored.games} as NbaDailyEdgeDto,
 {lockedMemberGamesByExternalId:r28Restored.memberGamesByExternalId});
assert.equal(r28Response.games[0].markets.moneyline.verdict.key,"watchlist");
assert.equal(JSON.stringify(r28Rows),r28Bytes,"Legacy grade and evidence bytes stay unchanged");
const r29Locked=structuredClone(locked);
r29Locked.intelligence.grade_policy_release="nba_grade_policy_2026_11_06_r29_confidence_led_lean";
r29Locked.intelligence.ml.grade="best_angle";
r29Locked.intelligence.ml.model_confidence=55.5;
const r29Member=structuredClone(lockedMemberGame);
r29Member.markets.moneyline.verdict={key:"best_angle",label:"Best Angle"};
r29Member.markets.moneyline.recommendationConfidence=55.5;
const r29Capture=buildNbaLockedMemberCapture({gameDto:r29Locked,memberGame:r29Member});
const r29Rows=rows.map(row=>({...row,snapshot_json:r29Capture})),r29Bytes=JSON.stringify(r29Rows);
const r30Dynamic=structuredClone(r29Dynamic);r30Dynamic.intelligence.grade_policy_release="nba_grade_policy_2026_11_06_r30_causal_best_qualification";
const r29Restored=applyNbaLockedMemberSnapshotPrecedence({games:[r30Dynamic],dbIdByExternalId:map,rows:r29Rows});
assert.equal(r29Restored.games[0].intelligence.ml.grade,"best_angle","R30 must not retroactively correct an R29 locked public grade");
assert.equal(r29Restored.games[0].intelligence.ml.model_confidence,55.5);
const r29Response=adaptNbaToDailyEdgeResponse({as_of:"2026-11-06T20:30:00Z",slate_date_et:"2026-10-20",market_signals_capability:"available",games:r29Restored.games} as NbaDailyEdgeDto,
 {lockedMemberGamesByExternalId:r29Restored.memberGamesByExternalId});
assert.equal(r29Response.games[0].markets.moneyline.verdict.key,"best_angle");
assert.equal(r29Response.games[0].markets.moneyline.recommendationConfidence,55.5);
assert.equal(JSON.stringify(r29Rows),r29Bytes,"R29 grades, confidence and source payloads remain exact");
const r30PriceLocked=structuredClone(locked);
r30PriceLocked.intelligence.grade_policy_release="nba_grade_policy_2026_11_06_r30_causal_best_qualification";
r30PriceLocked.intelligence.ml.grade="best_angle";
r30PriceLocked.intelligence.ml.current_price={odds_american:-300,odds_decimal:4/3,sportsbook:"draftkings",fetched_at:"2026-10-20T21:59:00Z"};
const r30PriceMember=structuredClone(lockedMemberGame);
r30PriceMember.markets.moneyline.verdict={key:"best_angle",label:"Best Angle"};
r30PriceMember.markets.moneyline.priceAmerican=-300;
r30PriceMember.markets.moneyline.currentPriceAmerican=-300;
const r30PriceCapture=buildNbaLockedMemberCapture({gameDto:r30PriceLocked,memberGame:r30PriceMember});
const r30PriceRows=rows.map(row=>({...row,snapshot_json:r30PriceCapture})),r30PriceBytes=JSON.stringify(r30PriceRows);
const r31Dynamic=structuredClone(r29Dynamic);r31Dynamic.intelligence.grade_policy_release="nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries";
const r30PriceRestored=applyNbaLockedMemberSnapshotPrecedence({games:[r31Dynamic],dbIdByExternalId:map,rows:r30PriceRows});
assert.equal(r30PriceRestored.games[0].intelligence.ml.grade,"best_angle");assert.equal(r30PriceRestored.games[0].intelligence.ml.current_price.odds_american,-300);
const r30PriceResponse=adaptNbaToDailyEdgeResponse({as_of:"2026-11-06T21:00:00Z",slate_date_et:"2026-10-20",market_signals_capability:"available",games:r30PriceRestored.games} as NbaDailyEdgeDto,
 {lockedMemberGamesByExternalId:r30PriceRestored.memberGamesByExternalId});
assert.equal(r30PriceResponse.games[0].markets.moneyline.verdict.key,"best_angle");assert.equal(r30PriceResponse.games[0].markets.moneyline.priceAmerican,-300);
assert.equal(JSON.stringify(r30PriceRows),r30PriceBytes,"R31 price ceiling cannot retroactively regrade an R30 locked Best");
assert.equal(capture.nba_locked_member_snapshot_release, NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE);
assert.deepEqual(restored.memberGamesByExternalId.get(9001), {
  ...lockedMemberGame,
  lockState: "locked",
  lockedAt: "2026-10-20T22:00:00.000Z",
});
assert.deepEqual(rows[0]!.snapshot_json, capture, "reader precedence cannot mutate the stored capture");
const adaptedLocked = adaptNbaToDailyEdgeResponse({
  as_of: "2026-10-20T22:05:00.000Z",
  slate_date_et: "2026-10-20",
  market_signals_capability: "available",
  games: restored.games,
} as NbaDailyEdgeDto, {
  memberEvidenceByGame: new Map(),
  lockedMemberGamesByExternalId: restored.memberGamesByExternalId,
});
assert.deepEqual(
  adaptedLocked.games,
  [...restored.memberGamesByExternalId.values()],
  "a later empty provider read cannot replace any field of the fully captured locked card",
);
assert.equal(
  adaptedLocked.games[0]!.nbaAvailability,
  undefined,
  "new availability evidence cannot be overlaid onto an immutable locked card",
);
const roundTrippedCapture = JSON.parse(JSON.stringify(capture));
const roundTripRows = rows.map((row) => ({ ...row, snapshot_json: roundTrippedCapture }));
const roundTripRestored = applyNbaLockedMemberSnapshotPrecedence({ games: [dynamic], dbIdByExternalId: map, rows: roundTripRows });
const roundTripMember = adaptNbaToDailyEdgeResponse({ as_of: "2026-11-06T12:40:00Z", slate_date_et: "2026-10-20",
  market_signals_capability: "available", games: roundTripRestored.games } as NbaDailyEdgeDto, {
  lockedMemberGamesByExternalId: roundTripRestored.memberGamesByExternalId,
}).games[0]!;
assert.deepEqual(roundTripMember.breakdown, lockedMemberGame.breakdown,
  "R2 summary must not reinterpret a JSON-round-tripped legacy lock");
assert.equal(roundTripMember.markets.moneyline.guidedWatchOut, lockedMemberGame.markets.moneyline.guidedWatchOut);
assert.equal(roundTripMember.markets.moneyline.whyLine, lockedMemberGame.markets.moneyline.whyLine);

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: rows.slice(0, 2),
}), /locked member DTO is incomplete/);

const legacy = applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: rows.map((row) => ({ ...row, snapshot_json: { predicted_total: 229 } })),
});
assert.deepEqual(legacy.games, [dynamic]);
assert.equal(legacy.memberGamesByExternalId.size, 0, "legacy locks are preserved without reconstruction");

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: [
    rows[0]!,
    { ...rows[1]!, snapshot_json: { ...capture, nba_game_dto_at_capture: dynamic } },
    rows[2]!,
  ],
}), /locked member DTO mismatch/);

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: [
    rows[0]!,
    { ...rows[1]!, snapshot_json: { nba_game_dto_at_capture: locked } },
    rows[2]!,
  ],
}), /locked member card is incomplete/);

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: [
    rows[0]!,
    {
      ...rows[1]!,
      snapshot_json: {
        ...capture,
        nba_daily_edge_game_at_capture: { ...lockedMemberGame, markets: {} },
      },
    },
    rows[2]!,
  ],
}), /locked member card mismatch/);

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: [rows[0]!, { ...rows[1]!, locked_at: "2026-10-20T22:00:01.000Z" }, rows[2]!],
}), /locked member DTO mismatch/);

console.log("NBA locked member snapshot precedence tests passed");


for (const observedAt of [null, "2026-10-20T17:44:03.791Z"]) {
  const storedMember = structuredClone(lockedMemberGame);
  storedMember.markets.moneyline.sportsbookSplits = {
    label: "Sharp Book Splits", sourceBook: "circa", sourceObservedAt: observedAt,
    lastUpdated: observedAt, signal: null, rows: [
      { side: "away", label: "AWY", moneyPct: 62, betsPct: 54, observedAt, freshnessCheckedAt: observedAt, isStale: true },
      { side: "home", label: "HME", moneyPct: 38, betsPct: 46, observedAt, freshnessCheckedAt: observedAt, isStale: true },
    ],
  };
  const originalMember = JSON.stringify(storedMember);
  const clockCapture = buildNbaLockedMemberCapture({ gameDto: locked, memberGame: storedMember });
  assert.equal(JSON.stringify(storedMember), originalMember, "writer capture must not modify null or native-clock legacy evidence");
  const clockRows = rows.map(row => ({ ...row, snapshot_json: clockCapture }));
  const storedBytes = JSON.stringify(clockRows);
  const clockRestored = applyNbaLockedMemberSnapshotPrecedence({ games: [dynamic], dbIdByExternalId: map, rows: clockRows });
  const currentEvidence = { ...storedMember.markets.moneyline.sportsbookSplits,
    sourceObservedAt: "2026-10-20T22:05:00Z", lastUpdated: "2026-10-20T22:05:00Z" };
  const response = adaptNbaToDailyEdgeResponse({ as_of: "2026-10-20T22:05:00Z", slate_date_et: "2026-10-20",
    market_signals_capability: "available", games: clockRestored.games } as NbaDailyEdgeDto, {
    lockedMemberGamesByExternalId: clockRestored.memberGamesByExternalId,
    memberEvidenceByGame: new Map([[9001, { moneyline: { sportsbookSplits: currentEvidence } } as unknown as NbaMemberGameEvidence]]),
  });
  const exactReader = JSON.stringify(response);
  assert.equal(sanitizeRetainedSharpSplitPresentation(response), 0);
  assert.equal(JSON.stringify(response), exactReader, "NBA response cleanup cannot reinterpret a locked native or null clock");
  assert.deepEqual(response.games[0]!.markets.moneyline.sportsbookSplits, storedMember.markets.moneyline.sportsbookSplits,
    "exact locked source evidence must win over fresh dynamic clocks");
  assert.equal(JSON.stringify(clockRows), storedBytes, "reader precedence cannot mutate stored locked bytes");
}
