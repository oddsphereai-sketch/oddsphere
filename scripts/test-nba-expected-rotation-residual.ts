import assert from "node:assert/strict";
import { buildNbaPlayerStateSnapshot, nbaPlayerStateHash, NBA_PLAYER_STATE_SCHEMA_HASH, qualifyNbaPlayerStateLedger,
  type NbaPlayerStateObservation, type NbaPlayerStateSnapshot } from "../lib/research/nba/nbaPlayerStateLedger";
import { applyNbaExpectedRotationResidual, fitNbaExpectedRotationResidual, type NbaRotationResidualTrainingRow } from "../lib/research/nba/nbaExpectedRotationResidual";
const target = { gameId: 1, season: 2022, homeTeamId: 1, awayTeamId: 2, startAt: "2022-12-20T23:00:00Z", cutoff: "2022-12-20T22:00:00Z" };
const receipt = (id: string) => ({ id, provider: "balldontlie" as const, publishedAt: "2022-12-19T12:00:00Z", fetchedAt: "2022-12-19T12:00:00Z",
  effectiveAt: "2022-12-19T12:00:00Z", payloadSha256: nbaPlayerStateHash(id), collectorRelease: "synthetic-unit-test" });
const observations: NbaPlayerStateObservation[] = [];
for (const teamId of [1, 2]) {
  const ids = Array.from({ length: 8 }, (_, i) => teamId * 100 + i), native = (id: number) => `balldontlie:${id}` as const;
  for (const id of ids) observations.push({ ...receipt(`id:${id}`), kind: "identity", nativePlayer: native(id), playerId: id });
  observations.push({ ...receipt(`roster:${teamId}`), kind: "roster", teamId, complete: true, members: ids.map(id => ({ nativePlayer: native(id), validFrom: "2022-10-01T00:00:00Z", validTo: null })) },
    { ...receipt(`availability:${teamId}`), kind: "availability", teamId, gameId: 1, complete: true, players: ids.map(id => ({ nativePlayer: native(id), status: "available" })) },
    { ...receipt(`stat:${teamId}`), kind: "stat", teamId, gameId: 50 + teamId, season: 2022, startedAt: "2022-12-18T23:00:00Z", complete: true, final: true,
      players: ids.map(id => ({ nativePlayer: native(id), minutes: 30, estimatedNet: 2, pie: .1 })) });
}
const base = buildNbaPlayerStateSnapshot({ target, observations }); assert.equal(base.status, "complete");
const rehash = (s: NbaPlayerStateSnapshot) => { const { hash: _hash, ...core } = s; void _hash; return { ...core, hash: nbaPlayerStateHash(core) }; };
const trainingSnapshots = Array.from({ length: 12 }, (_, i) => rehash({ ...base, target: { ...base.target, gameId: i + 1 }, features: Array.from({ length: 6 }, (_, j) => j === i % 6 ? 2 : 0) }));
const selection = Array.from({ length: 1000 }, (_, i) => rehash({ ...base, target: { ...base.target, gameId: 10000 + i, season: 2023, startAt: "2023-12-20T23:00:00Z", cutoff: "2023-12-20T22:00:00Z" },
  teams: base.teams.map(t => ({ ...t, rosterChange: i < 300 })) }));
const snapshots = [...trainingSnapshots, ...selection], gate = qualifyNbaPlayerStateLedger(snapshots);
const proof = { schemaHash: NBA_PLAYER_STATE_SCHEMA_HASH, ledgerHash: gate.ledgerHash, mutationSuiteSha256: "a".repeat(64), receiptsVerified: true };
const training: NbaRotationResidualTrainingRow[] = trainingSnapshots.map((s, i) => ({ snapshotHash: s.hash, baselineRelease: "synthetic-portable-A",
  baselineInputCutoff: s.target.cutoff, baselineTrainingEnd: "2022-10-01T00:00:00Z", baselineGeneratedAt: "2026-11-20T00:00:00Z",
  baselineMargin: 4, baselineTotal: 220, actualMargin: 4 + 2 * (i % 6 + 1), actualTotal: 220 - 2 * (i % 6 + 1), finalAvailableAt: "2022-12-21T03:00:00Z" }));
const bytes = JSON.stringify({ snapshots, training });
const head = fitNbaExpectedRotationResidual({ snapshots, proof, training });
for (let i = 0; i < 6; i++) { assert(Math.abs(head.margin[i] - 8 * (i + 1) / 1008) < 1e-12); assert.equal(head.total[i], -head.margin[i]); }
assert.equal(fitNbaExpectedRotationResidual({ snapshots: [...snapshots].reverse(), proof, training: [...training].reverse() }).hash, head.hash);
const baseline = { release: "synthetic-portable-A", margin: 4, total: 220 }, noShock = applyNbaExpectedRotationResidual(head, selection[0], baseline);
assert.equal(noShock.margin, 4); assert.equal(noShock.total, 220); assert.equal(noShock.homeScore, 112); assert.equal(noShock.awayScore, 108);
const shifted = rehash({ ...selection[0], features: [2, 0, 0, 0, 0, 0] });
assert(applyNbaExpectedRotationResidual(head, shifted, baseline).margin > 4);
assert.equal(JSON.stringify({ snapshots, training }), bytes);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots: [], proof, get training(): readonly NbaRotationResidualTrainingRow[] { throw Error("outcomes_read_before_gate"); } }), /player_state_data_gate_closed/);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots, proof: { ...proof, receiptsVerified: false }, training }), /gate_closed/);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots, proof, training: [{ ...training[0], snapshotHash: selection[0].hash }, ...training.slice(1)] }), /selection_leakage/);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots, proof, training: [training[0], ...training.slice(0, 11)] }), /duplicate_training_game/);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots, proof, training: training.map(r => ({ ...r, baselineInputCutoff: "2024-01-01T00:00:00Z" })) }), /asof/);
assert.throws(() => fitNbaExpectedRotationResidual({ snapshots, proof, training: training.map(r => ({ ...r, finalAvailableAt: "2024-01-01T00:00:00Z" })) }), /selection_boundary/);
assert.throws(() => applyNbaExpectedRotationResidual({ ...head, total: [99, 0, 0, 0, 0, 0] }, shifted, baseline), /invalid_frozen/);
assert.throws(() => applyNbaExpectedRotationResidual(head, shifted, { ...baseline, release: "different" }), /incompatible/);
assert.throws(() => applyNbaExpectedRotationResidual(head, trainingSnapshots[0], baseline), /incompatible/);
console.log("Fixed six-feature alpha1000 zero-intercept rotation heads: analytical ridge result, exact no-shock, deterministic replay, input immutability, pre-outcome source gate, training/selection separation and version/hash checks passed on synthetic data only.");
