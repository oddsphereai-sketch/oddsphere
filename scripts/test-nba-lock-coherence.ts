import assert from "node:assert/strict";
import { NBA_PREDICTION_RECORD_RELEASE } from "../lib/automodel/nba/nbaChampionRuntime";
import { assessNbaLockCoherence, type NbaLockRow } from "../lib/services/nba/nbaLockCoherence";
import { resolveExistingNbaPredictionRecords } from "../lib/services/nba/buildNbaPredictionRecords";

const snapshot = {
  predicted_home_score: 118.4,
  predicted_away_score: 112.1,
  predicted_total: 230.5,
  predicted_spread_home: 6.3,
  displayed_context_markets: {
    spread: { displayed_at_lock: true, side: "home" as const, line: -4.5, pick: "HOME -4.5" },
  },
};
const rows: NbaLockRow[] = [
  { game_id: 1, market: "moneyline", pick: "home", line_value: null, model_version: NBA_PREDICTION_RECORD_RELEASE, locked_at: null, snapshot_json: snapshot },
  { game_id: 1, market: "total", pick: "over", line_value: 228.5, model_version: NBA_PREDICTION_RECORD_RELEASE, locked_at: null, snapshot_json: snapshot },
];

assert.deepEqual(assessNbaLockCoherence({ gameIds: [1], rows }).coherentGameIds, [1]);
assert.deepEqual(
  assessNbaLockCoherence({ gameIds: [1], rows: rows.slice(0, 1) }).blockedGameIds,
  [1],
);

const legacyLocked = {
  id: 10,
  game_id: 2,
  market: "moneyline",
  model_version: "nba_independent_first_2026_10_06_r1",
  locked_at: "2026-10-20T22:00:00.000Z",
};
const resolvedLegacyLock = resolveExistingNbaPredictionRecords([legacyLocked]);
assert.equal(resolvedLegacyLock.conflicts.size, 0);
assert.deepEqual(resolvedLegacyLock.byKey.get("2::moneyline"), legacyLocked);

const duplicateLocked = resolveExistingNbaPredictionRecords([
  legacyLocked,
  { ...legacyLocked, id: 11, model_version: NBA_PREDICTION_RECORD_RELEASE },
]);
assert.equal(duplicateLocked.byKey.has("2::moneyline"), false);
assert.match(duplicateLocked.conflicts.get("2::moneyline") ?? "", /multiple immutable/);

const legacyUnlocked = { ...legacyLocked, id: 12, locked_at: null };
const resolvedLegacyUnlocked = resolveExistingNbaPredictionRecords([legacyUnlocked]);
assert.deepEqual(resolvedLegacyUnlocked.byKey.get("2::moneyline"), legacyUnlocked);
assert.deepEqual(
  assessNbaLockCoherence({
    gameIds: [1],
    rows: rows.map((row) => ({
      ...row,
      snapshot_json: {
        ...snapshot,
        displayed_context_markets: {
          spread: { displayed_at_lock: true, side: "away", line: 4.5, pick: "AWAY +4.5" },
        },
      },
    })),
  }).blockedGameIds,
  [1],
);
assert.deepEqual(
  assessNbaLockCoherence({
    gameIds: [1],
    rows: rows.map((row) => row.market === "total" ? { ...row, model_version: "old" } : row),
  }).blockedGameIds,
  [1],
);

console.log("NBA lock-coherence tests passed");
