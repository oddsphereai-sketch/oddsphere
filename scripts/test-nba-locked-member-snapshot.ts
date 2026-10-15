import assert from "node:assert/strict";

import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import { applyNbaLockedMemberSnapshotPrecedence } from "../lib/services/nba/nbaLockedMemberSnapshot";

const dynamic = {
  game_external_id: 9001,
  matchup: "AWY @ HME",
  projection: { home_score: 120, away_score: 110, total: 230, spread_home: 10 },
  intelligence: { ml: { pick_side: "home" } },
} as NbaDailyEdgeGameDto;
const locked = {
  ...dynamic,
  projection: { home_score: 116, away_score: 113, total: 229, spread_home: 3 },
  intelligence: { ml: { pick_side: "home" } },
} as NbaDailyEdgeGameDto;
const map = new Map([[9001, 44]]);
const rows = ["moneyline", "total"].map((market) => ({
  game_id: 44,
  market,
  locked_at: "2026-10-20T22:00:00.000Z",
  snapshot_json: { nba_game_dto_at_capture: locked },
}));

const restored = applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows,
});
assert.deepEqual(restored, [locked]);
assert.notEqual(restored[0], dynamic);

const legacy = applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: rows.map((row) => ({ ...row, snapshot_json: { predicted_total: 229 } })),
});
assert.deepEqual(legacy, [dynamic]);

assert.throws(() => applyNbaLockedMemberSnapshotPrecedence({
  games: [dynamic],
  dbIdByExternalId: map,
  rows: [
    rows[0]!,
    { ...rows[1]!, snapshot_json: { nba_game_dto_at_capture: dynamic } },
  ],
}), /locked member DTO mismatch/);

console.log("NBA locked member snapshot precedence tests passed");
