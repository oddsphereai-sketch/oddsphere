import assert from "node:assert/strict";
import type { NcaafGame, NcaafTeam } from "../lib/services/football/balldontlieNcaafSlate";
import {
  matchCfbPlaybookRow,
  resolveCfbPlaybookEvidence,
  resolveCfbPlaybookRow,
} from "../lib/services/football/cfbPlaybookEvidence";

const kickoff = "2026-09-05T23:00:00.000Z";

const verifiedAliases = [
  [team(75, "SHSU", "Sam Houston Bearkats"), "Sam Houston State Bearkats"],
  [team(188, "YSU", "Youngstown State Penguins"), "Youngstown St Penguins"],
  [team(236, "HCU", "Houston Christian Huskies"), "Houston Baptist Huskies"],
  [team(191, "LIU", "Long Island University Sharks"), "LIU Sharks"],
  [team(160, "UALB", "UAlbany Great Danes"), "Albany"],
  [team(231, "CIT", "The Citadel Bulldogs"), "Citadel Bulldogs"],
  [team(240, "NICH", "Nicholls Colonels"), "Nicholls State Colonels"],
  [team(123, "APP", "App State Mountaineers"), "Appalachian State Mountaineers"],
  [team(133, "USM", "Southern Miss Golden Eagles"), "Southern Mississippi Golden Eagles"],
  [team(242, "SELA", "SE Louisiana Lions"), "Southeastern Louisiana Lions"],
] as const;

for (const [canonical, providerName] of verifiedAliases) {
  const game = makeGame(team(132, "USA", "South Alabama Jaguars"), canonical);
  assert.equal(matchCfbPlaybookRow(game, row("verified", game.away.name, providerName)), true, providerName);
}

const game = makeGame(team(75, "SHSU", "Sam Houston Bearkats"), team(135, "TROY", "Troy Trojans"));
const line = row("pbk-one", "Sam Houston State Bearkats", "Troy Trojans");
const split = row("pbk-one", "Sam Houston State Bearkats", "Troy Trojans");
assert.equal(matchCfbPlaybookRow(game, row("exact", game.away.name, game.home.name)), true);
assert.equal(matchCfbPlaybookRow(game, { ...line, startTime: "2026-09-06T03:00:00.001Z" }), false);
assert.equal(matchCfbPlaybookRow(game, row("reversed", "Troy Trojans", "Sam Houston State Bearkats")), false);
assert.equal(resolveCfbPlaybookRow(game, [line, { ...line }]), line, "duplicate payload rows for one event ID remain deterministic");
assert.equal(resolveCfbPlaybookRow(game, [line, { ...line, gameId: "pbk-two" }]), null, "conflicting event IDs fail closed");
assert.deepEqual(resolveCfbPlaybookEvidence({ game, lines: [line], splits: [split] }), {
  eventId: "pbk-one",
  lineRow: line,
  splitRow: split,
});
assert.equal(resolveCfbPlaybookEvidence({ game, lines: [line], splits: [{ ...split, gameId: "pbk-two" }] }), null);
assert.equal(resolveCfbPlaybookEvidence({ game, lines: [line], splits: [] }), null);

console.log("CFB Playbook event identity: verified aliases, strict time/orientation, and duplicate-event failure passed.");

function makeGame(away: NcaafTeam, home: NcaafTeam): NcaafGame {
  return {
    providerGameId: "457609",
    providerWeek: 2,
    season: 2026,
    scheduledStart: kickoff,
    status: "scheduled",
    awayScore: null,
    homeScore: null,
    away,
    home,
  };
}

function team(id: number, abbreviation: string, name: string): NcaafTeam {
  return { id, conferenceId: null, abbreviation, name, fbs: false };
}

function row(gameId: string, awayTeamName: string, homeTeamName: string): Record<string, unknown> {
  return { gameId, awayTeamName, homeTeamName, startTime: kickoff };
}
