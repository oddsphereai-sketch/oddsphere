import assert from "node:assert/strict";
import {
  __NBA_ROSTER_REGIME_TEST__,
  applyNbaRosterRegime,
  fetchNbaLiveRosterSnapshot,
  NBA_ROSTER_REGIME_RELEASE,
  type NbaLiveRosterSnapshot,
} from "../lib/automodel/nba/nbaRosterRegime";

async function main(): Promise<void> {
const artifact = __NBA_ROSTER_REGIME_TEST__.artifact;
assert.equal(artifact.release, NBA_ROSTER_REGIME_RELEASE);
assert.equal(artifact.features.length, 6);
assert.equal(artifact.winnerConfirmation.policy, "primary_flip_requires_symmetric_confirmation");
assert.equal(artifact.winnerConfirmation.retainedMinutesThreshold, 0.55);
assert.equal(artifact.winnerConfirmation.margin.coefficients.length, 3);

const unconfirmedFlip = __NBA_ROSTER_REGIME_TEST__.confirmedMarginCorrection({
  independentMargin: 3,
  primaryCorrection: -5,
  confirmationCorrection: -1,
});
assert.deepEqual(unconfirmedFlip, { correction: -1, applied: true });
const confirmedFlip = __NBA_ROSTER_REGIME_TEST__.confirmedMarginCorrection({
  independentMargin: 3,
  primaryCorrection: -5,
  confirmationCorrection: -4,
});
assert.deepEqual(confirmedFlip, { correction: -5, applied: false });
const noPrimaryFlip = __NBA_ROSTER_REGIME_TEST__.confirmedMarginCorrection({
  independentMargin: 3,
  primaryCorrection: -1,
  confirmationCorrection: -5,
});
assert.deepEqual(noPrimaryFlip, { correction: -1, applied: false });

const rosterMap = new Map(artifact.teamRosters.map((team) => [team.teamId, [...team.playerIds]]));
const live: NbaLiveRosterSnapshot = {
  release: NBA_ROSTER_REGIME_RELEASE,
  status: "complete",
  observedAt: "2026-10-22T12:00:00.000Z",
  reason: null,
  playerIdsByTeam: rosterMap,
};
const home = artifact.teamRosters.find((team) => team.team === "ATL")!;
const away = artifact.teamRosters.find((team) => team.team === "BOS")!;
const independent = { homeScore: 113, awayScore: 110, marginHome: 3, total: 223 };

const stable = applyNbaRosterRegime({
  independent,
  providerSeason: artifact.providerSeason,
  homeTeam: home.team,
  awayTeam: away.team,
  homeCurrentGames: 2,
  awayCurrentGames: 2,
  homeInjuries: [],
  awayInjuries: [],
  liveRoster: live,
});
assert.equal(stable.audit.status, "stable_roster");
assert.deepEqual(stable.score, independent);

const changedRosterMap = new Map(rosterMap);
changedRosterMap.set(home.teamId, away.playerIds.slice(0, 10));
const changed = applyNbaRosterRegime({
  independent,
  providerSeason: artifact.providerSeason,
  homeTeam: home.team,
  awayTeam: away.team,
  homeCurrentGames: 2,
  awayCurrentGames: 2,
  homeInjuries: [],
  awayInjuries: [],
  liveRoster: { ...live, playerIdsByTeam: changedRosterMap },
});
assert.equal(changed.audit.status, "applied");
assert.notEqual(changed.audit.marginCorrection, 0);
assert.ok(Number.isFinite(changed.audit.primaryMarginCorrection));
assert.ok(Number.isFinite(changed.audit.winnerConfirmationMarginCorrection));
assert.equal(changed.score.homeScore, (changed.score.total + changed.score.marginHome) / 2);
assert.equal(changed.score.awayScore, (changed.score.total - changed.score.marginHome) / 2);

const firstChangedPlayer = artifact.players.find((player) => player.id === away.playerIds[0])!;
const availabilityAware = applyNbaRosterRegime({
  independent,
  providerSeason: artifact.providerSeason,
  homeTeam: home.team,
  awayTeam: away.team,
  homeCurrentGames: 2,
  awayCurrentGames: 2,
  homeInjuries: [{ player_id: null, name: firstChangedPlayer.name, status: "out" }],
  awayInjuries: [],
  liveRoster: { ...live, playerIdsByTeam: changedRosterMap },
});
assert.ok(availabilityAware.audit.homeExcludedOutPlayers.includes(firstChangedPlayer.name));
assert.notEqual(availabilityAware.audit.marginCorrection, changed.audit.marginCorrection);

const questionableIsNotForcedOut = applyNbaRosterRegime({
  independent,
  providerSeason: artifact.providerSeason,
  homeTeam: home.team,
  awayTeam: away.team,
  homeCurrentGames: 2,
  awayCurrentGames: 2,
  homeInjuries: [{ player_id: null, name: firstChangedPlayer.name, status: "questionable" }],
  awayInjuries: [],
  liveRoster: { ...live, playerIdsByTeam: changedRosterMap },
});
assert.deepEqual(questionableIsNotForcedOut.score, changed.score);
assert.deepEqual(questionableIsNotForcedOut.audit.homeExcludedOutPlayers, []);

const unavailable = applyNbaRosterRegime({
  independent,
  providerSeason: artifact.providerSeason,
  homeTeam: home.team,
  awayTeam: away.team,
  homeCurrentGames: 2,
  awayCurrentGames: 2,
  homeInjuries: [],
  awayInjuries: [],
  liveRoster: { ...live, status: "unavailable", reason: "test_gap", playerIdsByTeam: new Map() },
});
assert.equal(unavailable.audit.status, "unavailable");
assert.deepEqual(unavailable.score, independent);
assert.equal(unavailable.audit.winnerConfirmationApplied, false);

const playerRows = artifact.teamRosters.flatMap((team) => team.playerIds.map((id) => ({
  id,
  team: { id: team.teamId },
})));
let fetchedUrl = "";
const fetched = await fetchNbaLiveRosterSnapshot({
  apiKey: "test",
  now: "2026-10-22T12:00:00.000Z",
  fetchImpl: async (input) => {
    fetchedUrl = String(input);
    return new Response(JSON.stringify({ data: playerRows, meta: { next_cursor: null } }), { status: 200 });
  },
});
assert.equal(fetched.status, "complete");
assert.equal(fetched.playerIdsByTeam.size, 30);
assert.equal(new URL(fetchedUrl).pathname, "/v1/players/active");

console.log("NBA roster-regime tests passed.");
}

void main();
