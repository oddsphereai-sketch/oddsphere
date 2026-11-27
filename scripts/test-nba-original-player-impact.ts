import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitNbaOriginalImpact, reconstructNbaOriginalImpact, verifyNbaOriginalPlayerImpact } from "../lib/research/nba/nbaOriginalPlayerImpact";

function fixture() {
  const names = ["points", "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted", "freeThrowsMade", "freeThrowsAttempted", "reboundsOffensive", "reboundsDefensive", "assists", "steals", "blocks", "foulsPersonal", "turnovers"] as const;
  const team = (teamId: number, ids: number[], score: number) => ({ teamId, teamTricode: String(teamId), score, players: ids.map(personId => ({ personId, name: `Native ${personId}`, played: "1", starter: personId === 6 ? "0" : "1", statistics: { ...(Object.fromEntries(names.map(n => [n, 0])) as Record<typeof names[number], number>), minutes: personId === 1 ? "PT38M00S" : personId === 6 ? "PT10M00S" : "PT48M00S", plus: teamId === 100 ? personId === 6 ? 0 : 4 : 2, minus: teamId === 100 ? personId === 6 ? 0 : 2 : 4 } })) });
  const game = { gameId: "0022300001", gameTimeUTC: "2023-10-25T00:00:00Z", gameStatus: 3, period: 4, homeTeam: team(100, [1, 2, 3, 4, 5, 6], 4), awayTeam: team(200, [11, 12, 13, 14, 15], 2) };
  type Event = { actionNumber: number; orderNumber: number; period: number; clock: string; actionType: string; subType?: string; personId?: number; teamId?: number; description?: string; shotResult?: string; timeActual: string; edited: string };
  const actions: Event[] = [];
  const add = (period: number, clock: string, actionType: string, personId = 0, subType = "", extra: Partial<Event> = {}) => {
    const teamId = personId ? personId < 10 ? 100 : 200 : 0;
    actions.push({ actionNumber: actions.length + 1, orderNumber: (actions.length + 1) * 10, period, clock, actionType, subType, personId, teamId, timeActual: "2023-10-25T03:59:00Z", edited: "2023-10-25T03:59:00Z", ...extra });
    const p = [...game.homeTeam.players, ...game.awayTeam.players].find(p => p.personId === personId);
    if (actionType === "rebound" && p) p.statistics.reboundsDefensive!++;
    if (actionType === "foul" && p) p.statistics.foulsPersonal!++;
    if (actionType === "2pt" && p) { p.statistics.points! += 2; p.statistics.fieldGoalsMade!++; p.statistics.fieldGoalsAttempted!++; }
    if (actionType === "freethrow" && p) { p.statistics.points!++; p.statistics.freeThrowsMade!++; p.statistics.freeThrowsAttempted!++; }
  };
  for (let period = 1; period <= 4; period++) {
    add(period, "PT12M00S", "period", 0, "start");
    for (const id of [1, 2, 3, 4, 5, 11, 12, 13, 14, 15]) add(period, "PT12M00S", "rebound", id, "defensive");
    if (period === 1) {
      add(1, "PT11M00S", "2pt", 1, "Jump Shot", { shotResult: "Made" });
      add(1, "PT10M30S", "2pt", 11, "Jump Shot", { shotResult: "Made" });
      add(1, "PT10M00S", "foul", 11, "personal", { description: "shooting personal FOUL (2 FT)" });
      add(1, "PT10M00S", "freethrow", 2, "1 of 2", { shotResult: "Made" });
      add(1, "PT10M00S", "substitution", 1, "out"); add(1, "PT10M00S", "substitution", 6, "in");
      add(1, "PT10M00S", "freethrow", 2, "2 of 2", { shotResult: "Made" });
    }
    for (let i = 0; i < 20; i++) add(period, "PT00M00S", "memo");
    add(period, "PT00M00S", "period", 0, "end");
  }
  return { game, actions };
}
const f = fixture(), original = JSON.stringify(f), result = reconstructNbaOriginalImpact(f.game, f.actions);
assert.deepEqual(result.issues, []);
assert.equal(JSON.stringify(f), original, "native source and roster remain immutable");
assert.equal(result.players.find(p => p.playerId === 1)!.pointsFor, 4, "both free throws belong to foul-start lineup");
assert.equal(result.players.find(p => p.playerId === 6)!.pointsFor, 0);
assert.equal(result.players.find(p => p.playerId === 6)!.pie, 0, "observed zero-event stint follows the published zero convention");
assert.equal(result.players.find(p => p.playerId === 6)!.estimatedNet, 0);
const raw = (kind: "boxscore" | "playbyplay", omitMeta = false) => {
  const bytes = Buffer.from(JSON.stringify({ meta: omitMeta ? {} : { time: "2023-10-25 00:00:00.500000" }, game: kind === "boxscore" ? f.game : { gameId: f.game.gameId, actions: f.actions } }));
  return { bytes, receipt: { status: 200, url: `https://cdn.nba.com/static/json/liveData/${kind}/${kind}_${f.game.gameId}.json`, sha256: createHash("sha256").update(bytes).digest("hex"), requestedAt: "2026-11-21T12:00:00Z", receivedAt: "2026-11-21T12:00:01Z", lastModified: "Wed, 25 Oct 2023 04:00:01 GMT" } };
};
const box = raw("boxscore"), pbp = raw("playbyplay");
const args = { gameId: f.game.gameId, boxBytes: box.bytes, boxReceipt: box.receipt, pbpBytes: pbp.bytes, pbpReceipt: pbp.receipt, computedAt: "2026-11-21T12:01:00Z" };
const verified = verifyNbaOriginalPlayerImpact(args);
assert.equal(verified.sources[0]!.fetchedAt, "2026-11-21T12:00:01Z", "actual current retrieval is never backdated");
assert.equal(verified.sourceAvailableAt, "2023-10-25T04:00:01.999Z");
assert.equal(admitNbaOriginalImpact(verified, { gameId: "0022300002", cutoff: "2023-10-26T00:00:00Z" }), true);
assert.equal(admitNbaOriginalImpact(verified, { gameId: f.game.gameId, cutoff: "2023-10-26T00:00:00Z" }), false);
assert.equal(admitNbaOriginalImpact(verified, { gameId: "0022300002", cutoff: "2023-10-25T04:00:01.998Z" }), false);
assert.throws(() => verifyNbaOriginalPlayerImpact({ ...args, boxReceipt: { ...box.receipt, sha256: "0".repeat(64) } }), /receipt/);
assert.throws(() => verifyNbaOriginalPlayerImpact({ ...args, boxReceipt: { ...box.receipt, lastModified: "Fri, 21 Nov 2025 04:00:01 GMT" } }), /publication/);
const noMeta = raw("playbyplay", true);
assert.deepEqual(verifyNbaOriginalPlayerImpact({ ...args, pbpBytes: noMeta.bytes, pbpReceipt: noMeta.receipt }).players, verified.players);
const bad = fixture(); bad.actions.find(a => a.actionType === "substitution")!.personId = 5;
assert(reconstructNbaOriginalImpact(bad.game, bad.actions).issues.some(i => i.endsWith("original_stint_minutes_mismatch")));
const revised = fixture(); revised.game.homeTeam.players[0]!.statistics.steals = 1;
const revisedResult = reconstructNbaOriginalImpact(revised.game, revised.actions);
assert(revisedResult.issues.some(i => i.endsWith("original_count_mismatch:stl")), "never substitute a newer count to hide original disagreement");
assert(revisedResult.players.find(p => p.playerId === 2)!.issues.includes("original_context_count_disagreement"));
assert.deepEqual(revisedResult.players.find(p => p.playerId === 6)!.issues, [], "a disjoint zero-event stint is not tainted by another player's missing count");
const physical = fixture(); physical.game.homeTeam.players[0]!.statistics.plus = 3; physical.game.homeTeam.players[5]!.statistics.plus = 1;
const physicalResult = reconstructNbaOriginalImpact(physical.game, physical.actions);
assert.deepEqual(physicalResult.issues, []);
assert.equal(physicalResult.players.find(p => p.playerId === 1)!.scoringContextConvention, "physical");
assert.deepEqual(physicalResult.players.map(p => [p.playerId, p.estimatedNet, p.pie]), result.players.map(p => [p.playerId, p.estimatedNet, p.pie]), "live aggregate convention cannot select or change the impact calculation");
const conflicting = fixture(); conflicting.game.homeTeam.players[0]!.statistics.plus = 2;
const conflicted = reconstructNbaOriginalImpact(conflicting.game, conflicting.actions).players.find(p => p.playerId === 1)!;
assert(conflicted.diagnostics!.includes("live_box_scoring_context_disagreement"));
assert.equal(conflicted.estimatedNet, result.players.find(p => p.playerId === 1)!.estimatedNet, "a conflicting derived aggregate is retained, never inserted into the metric");
console.log("Original NBA impact: native identity/counts, FT lineup, source/hash/clocks, zero-event convention, target/future refusal, actual fetch clocks and source immutability passed.");
import { verifyNbaOriginalTeamGame } from "../lib/research/nba/nbaOriginalTeamFeatures";
const teamSource=verifyNbaOriginalTeamGame({gameId:f.game.gameId,season:2023,bytes:box.bytes,receipt:box.receipt});
assert.equal(teamSource.game.homeScore,4); assert.equal(teamSource.boxes.reduce((n,b)=>n+b.points,0),6);
assert.equal(teamSource.sourceAvailableAt,verified.sources[0]!.sourceAvailableAt);
assert.throws(()=>verifyNbaOriginalTeamGame({gameId:f.game.gameId,season:2022,bytes:box.bytes,receipt:box.receipt}),/season_mismatch/);
import { verifyNbaOriginalTwoWayImpact } from "../lib/research/nba/nbaOriginalPlayerImpact";
const twoWay=verifyNbaOriginalTwoWayImpact(args);
assert(twoWay.players.filter(p=>p.played).every(p=>p.estimatedOffense!=null&&p.estimatedDefense!=null&&Math.abs(p.estimatedOffense-p.estimatedDefense-p.estimatedNet!)<1e-10));
assert(verifyNbaOriginalPlayerImpact(args).players.every(p=>!Object.hasOwn(p,"estimatedOffense")&&!Object.hasOwn(p,"estimatedDefense")),"original R4 payload remains exact");
