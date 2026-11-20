import assert from "node:assert/strict";
import { packNbaPlayerStatEvidence, nbaPlayerStatEvidenceKey, NBA_PLAYER_STAT_EVIDENCE_RELEASE } from "../lib/services/nba/nbaPlayerStatEvidence";
import { NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE, type NbaPlayerPropsCurrentState } from "../lib/services/nba/nbaPlayerPropsCurrentState";
import { normalizeNbaHistoricalGame, normalizeNbaHistoricalPlayerBox, normalizeNbaHistoricalPlayerAdvanced } from "../lib/services/nba/nbaPointInTimeFeatures";
import { nbaPlayerStateStatsFromRetainedEvidence } from "../lib/research/nba/nbaPlayerStateStatEvidence";
const at = "2026-11-20T11:00:00Z";
const game = normalizeNbaHistoricalGame({ id: 100, season: 2026, datetime: "2026-11-19T01:00:00Z", status: "Final", status_state: "final",
  home_team: { id: 1, abbreviation: "ATL" }, visitor_team: { id: 2, abbreviation: "BOS" }, home_team_score: 80, visitor_team_score: 80 });
const actors = [1, 2].flatMap(team => Array.from({ length: 8 }, (_, i) => ({ team, id: team * 100 + i })));
const state: NbaPlayerPropsCurrentState = { release: NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE, publicEnabled: false, season: 2026,
  createdAt: at, updatedAt: at, games: [game], players: [],
  boxes: actors.map(({ team, id }) => normalizeNbaHistoricalPlayerBox({ id, game: { id: 100 }, team: { id: team }, player: { id }, min: "30",
    fgm: 4, fga: 10, fg3m: 0, fg3a: 1, ftm: 2, fta: 2, oreb: 1, dreb: 3, ast: 2, stl: 1, blk: 1, turnover: 1, pf: 2, pts: 10, plus_minus: 0 })),
  advanced: actors.map(({ team, id }) => normalizeNbaHistoricalPlayerAdvanced({ id, game_id: 100, team_id: team, player_id: id, period: 0,
    possessions: 60, estimated_net_rating: 1, pie: .1 })) };
const a = packNbaPlayerStatEvidence({ state, gameId: 100, retainedAt: "2026-11-20T12:00:00Z" });
const b = packNbaPlayerStatEvidence({ state: { ...state, updatedAt: "2026-11-20T13:00:00Z", advanced: state.advanced.map(r => ({ ...r, estimatedNetRating: 8 })) }, gameId: 100, retainedAt: "2026-11-20T13:01:00Z" });
const reference = (body: typeof a, sourceStateUpdatedAt = body.sourceStateUpdatedAt, firstRetainedAt = body.firstRetainedAt) => ({
  release: NBA_PLAYER_STAT_EVIDENCE_RELEASE, kind: "nba_player_stat_observation_v1", gameId: 100, season: 2026,
  bodyKey: nbaPlayerStatEvidenceKey(100, body.bodySha256), bodySha256: body.bodySha256, sourceStateUpdatedAt, firstRetainedAt });
const refs = [reference(a), reference(b), reference(a, "2026-11-20T14:00:00Z", "2026-11-20T14:01:00Z")];
const bodies = new Map([[refs[0].bodyKey, a], [refs[1].bodyKey, b]]);
const read = (cutoff: string, targetGameId = 999, observations: readonly unknown[] = refs) => nbaPlayerStateStatsFromRetainedEvidence({ cutoff, targetGameId, observations, bodies });
assert.deepEqual(read("2026-11-20T11:59:59Z"), [], "newly archived season cache cannot populate older forecasts");
const first = read("2026-11-20T12:00:00Z"), corrected = read("2026-11-20T13:01:00Z"), reverted = read("2026-11-20T14:01:00Z");
assert.equal(first.filter(o => o.kind === "stat").length, 2); assert.equal(first.filter(o => o.kind === "identity").length, 16);
for (const o of first) if (o.kind === "stat") { assert(o.players.every(p => p.estimatedNet === 1)); assert.equal(o.players.reduce((n, p) => n + p.minutes, 0), 240); }
for (const o of corrected) if (o.kind === "stat") assert(o.players.every(p => p.estimatedNet === 8));
for (const o of reverted) if (o.kind === "stat") { assert(o.players.every(p => p.estimatedNet === 1)); assert.equal(o.fetchedAt, "2026-11-20T14:01:00Z"); }
assert.deepEqual(read("2026-11-20T14:01:00Z", 100), [], "target-game results excluded before any feature building");
const frozen = JSON.stringify(first);
bodies.set(refs[1].bodyKey, { ...b, data: "corrupted_future_body" });
assert.equal(JSON.stringify(read("2026-11-20T12:00:00Z")), frozen, "future correction mutation cannot affect prior snapshot");
assert.deepEqual(read("2026-11-20T13:01:00Z"), [], "corrupt selected body is unavailable, not fallback to old facts");
assert.equal(JSON.stringify(read("2026-11-20T12:00:00Z", 999, [...refs, { ...refs[1], bodySha256: "malformed_future_reference" }])), frozen);
assert.equal(state.updatedAt, at);
console.log("NBA retained-stat adapter: exact native identities, conservative observation clocks, correction/reversion selection, target exclusion, future mutation invariance and corrupt-current refusal passed; zero network/writes.");
