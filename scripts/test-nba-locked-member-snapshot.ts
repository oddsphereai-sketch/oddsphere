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
  markets: {
    moneyline: {
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
