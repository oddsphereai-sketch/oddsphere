import assert from "node:assert/strict";
import { allocateNbaRegulationMinutes, buildNbaPlayerStateSnapshot, nbaPlayerStateHash, qualifyNbaPlayerStateLedger,
  type NbaPlayerStateObservation, type NbaPlayerStateTarget } from "../lib/research/nba/nbaPlayerStateLedger";
const target: NbaPlayerStateTarget = { gameId: 999, season: 2026, homeTeamId: 1, awayTeamId: 2,
  startAt: "2026-11-20T23:00:00Z", cutoff: "2026-11-20T22:00:00Z" };
const before = "2026-11-19T12:00:00Z", future = "2026-11-20T22:01:00Z";
function receipt(id: string) { return { id, provider: "balldontlie" as const, publishedAt: before, fetchedAt: before,
  effectiveAt: before, payloadSha256: nbaPlayerStateHash(id), collectorRelease: "frozen-test-source" }; }
const native = (id: number) => `balldontlie:${id}` as const;
function fixture(): NbaPlayerStateObservation[] {
  const rows: NbaPlayerStateObservation[] = [];
  for (const teamId of [1, 2]) {
    const players = Array.from({ length: 8 }, (_, i) => teamId * 100 + i);
    for (const id of players) rows.push({ ...receipt(`identity:${id}`), kind: "identity", nativePlayer: native(id), playerId: id });
    rows.push({ ...receipt(`roster:${teamId}`), kind: "roster", teamId, complete: true,
      members: players.map(id => ({ nativePlayer: native(id), validFrom: "2026-10-01T00:00:00Z", validTo: null })) });
    rows.push({ ...receipt(`availability:${teamId}`), kind: "availability", teamId, gameId: target.gameId, complete: true,
      players: players.map(id => ({ nativePlayer: native(id), status: "available" })) });
    for (let day = 1; day <= 10; day++) rows.push({ ...receipt(`stat:${teamId}:${day}`), kind: "stat", teamId, gameId: teamId * 1000 + day,
      season: 2026, startedAt: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`, final: true, complete: true,
      players: players.map((id, i) => ({ nativePlayer: native(id), minutes: 30, estimatedNet: 16 - i * 4, pie: .20 - i * .02 })) });
  }
  return rows;
}
const build = (observations: readonly NbaPlayerStateObservation[]) => buildNbaPlayerStateSnapshot({ target, observations });
const baseline = build(fixture());
assert.equal(baseline.status, "complete"); assert.deepEqual(baseline.features, [0, 0, 0, 0, 0, 0]);
for (const team of baseline.teams) { assert.equal(team.players.reduce((n, p) => n + p.expectedMinutes, 0), 240); assert.equal(team.netShock, 0); }
const original = fixture(), bytes = JSON.stringify(original);
assert.equal(build([...original].reverse()).hash, baseline.hash, "input order must not affect cutoff snapshot");
const out = fixture(); const homeReport = out.find(o => o.kind === "availability" && o.teamId === 1)!;
assert.equal(homeReport.kind, "availability"); if (homeReport.kind !== "availability") throw Error();
homeReport.players = homeReport.players.map((p, i) => ({ ...p, status: i === 0 ? "out" : i === 1 ? "questionable" : i === 2 ? "probable" : "available" }));
const changed = build(out); assert.equal(changed.status, "complete"); assert(changed.teams[0].netShock! < 0);
const ps = changed.teams[0].players;
assert.equal(ps[0].expectedMinutes, 0); assert.equal(ps[1].expectedMinutes, 30); assert.equal(ps[2].expectedMinutes, 30);
assert(ps.slice(3).every(p => p.expectedMinutes === 36)); assert.equal(ps.reduce((n, p) => n + p.expectedMinutes, 0), 240);
assert.equal(changed.teams[0].outMinuteShare, .125); assert.equal(changed.teams[0].topOneOutShare, .125);
assert.deepEqual(changed.features?.slice(0, 2), [changed.teams[0].netShock, changed.teams[0].netShock]);
const later = fixture().map(o => ({ ...o, id: `later:${o.id}`, fetchedAt: future, publishedAt: future, effectiveAt: future }));
assert.equal(build([...original, ...later]).hash, baseline.hash);
const targetResult: NbaPlayerStateObservation = { ...receipt("target-result"), kind: "stat", gameId: target.gameId, teamId: 1,
  season: 2026, startedAt: target.startAt, final: true, complete: true, players: [] };
assert.equal(build([...original, targetResult]).hash, baseline.hash, "even falsely backdated target-game stats are excluded");
assert.equal(build([...original, { ...targetResult, players: [{ nativePlayer: native(100), minutes: 79, estimatedNet: -900, pie: 5 }] }]).hash, baseline.hash);
const futureIdentity: NbaPlayerStateObservation = { ...receipt("future-identity"), kind: "identity", nativePlayer: native(100), playerId: 99999, fetchedAt: future };
assert.equal(build([...original, futureIdentity]).hash, baseline.hash);
assert.equal(build(original.map(o => o.kind === "stat" ? { ...o, fetchedAt: future } : o)).status, "unknown", "current cache cannot populate an old cutoff");
assert.equal(build(original.filter(o => o.kind !== "identity")).status, "unknown");
assert.equal(build(original.filter(o => o.kind !== "roster")).status, "unknown");
assert.equal(build(original.filter(o => o.kind !== "availability")).status, "unknown");
assert.equal(build(original.map(o => o.kind === "availability" ? { ...o, complete: false } : o)).status, "unknown");
assert.equal(build(original.map(o => o.kind === "availability" ? { ...o, players: o.players.slice(1) } : o)).status, "unknown", "unlisted is not available");
assert.equal(build(original.map(o => o.kind === "stat" ? { ...o, players: o.players.map(p => ({ ...p, pie: null })) } : o)).status, "unknown");
const conflict: NbaPlayerStateObservation = { ...receipt("identity-conflict"), kind: "identity", nativePlayer: native(100), playerId: 101 };
assert.equal(build([...original, conflict]).status, "unknown");
assert.equal(build([...original, { ...original[0], payloadSha256: "a".repeat(64) }]).status, "unknown");
const duplicate = original.map(o => o.kind === "stat" && o.teamId === 1 ? { ...o, players: [...o.players, o.players[0]] } : o);
assert.equal(build(duplicate).teams[0].status, "unknown");
const noReplacement = out.map(o => o.kind === "availability" ? { ...o, players: o.players.map(p => ({ ...p, status: p.status === "out" ? "out" as const : "questionable" as const })) } : o);
assert.equal(build(noReplacement).teams[0].status, "unknown", "unknown/questionable players cannot receive invented replacement minutes");
const overtime = original.map(o => o.kind === "stat" ? { ...o, players: o.players.map(p => ({ ...p, minutes: p.minutes * 265 / 240 })) } : o);
assert.equal(build(overtime).status, "complete"); assert.equal(build(overtime).teams[0].players.reduce((n, p) => n + p.expectedMinutes, 0), 240);
const capped = allocateNbaRegulationMinutes(new Map([[1, 1000], [2, 100], [3, 30], [4, 30], [5, 30], [6, 30]]))!;
assert.equal(capped.get(1), 48); assert([...capped.values()].every(m => m <= 48));
assert.equal(allocateNbaRegulationMinutes(new Map([[1, 100]])), null);
assert.equal(allocateNbaRegulationMinutes(new Map([[1, NaN]])), null);
assert.equal(JSON.stringify(original), bytes);
const gate = qualifyNbaPlayerStateLedger([baseline, changed]); assert.equal(gate.mayFit, false); assert.equal(gate.selectionComplete, 0);
assert(gate.issues.includes("selection_complete_below_1000")); assert(gate.issues.includes("verified_change_games_below_300"));
assert(qualifyNbaPlayerStateLedger([baseline, baseline]).issues.includes("duplicate_game_cutoff"));
assert(qualifyNbaPlayerStateLedger([{ ...baseline, hash: "a".repeat(64) }]).issues.includes("snapshot_hash_mismatch"));
console.log("NBA expected rotation: exact240/caps, verified-OUT/available-only redistribution, no-shock symmetry, cutoff/target/future mutation invariance, unknown identity/roster/availability/stat refusal and no-fit coverage gates passed; no network/writes/outcome fitting.");
