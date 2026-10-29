import assert from "node:assert/strict";
import { attenuateCbbPriorFromObservedRoster } from "../lib/cbb/rosterPriorResearch";
import type { CbbPlayerGame, CbbPlayerSeason, CbbRatingState } from "../lib/cbb/types";

const team = (id: number) => ({ id, conference_id: 1, name: `Team ${id}`, full_name: `Team ${id}`,
  college: `College ${id}`, abbreviation: `T${id}` });
const player = (id: number) => ({ id, first_name: "Test", last_name: String(id), team: team(1) });
const rating = { offense: 10, defense: -5, pace: 2, games: 25, factors: null, opponentFactors: null };
const prior: CbbRatingState = { release: "old", season: 2023, asOf: "2024-07-01T00:00:00Z",
  config: { id: "test", ridge: 1, priorCarry: 0.8, recencyDays: 90 }, leagueEfficiency: 100, leagueTempo: 70,
  homeEfficiency: 3, teams: { 1: rating }, trainingGames: 50 };
const priorPlayers: CbbPlayerSeason[] = [1, 2].map(id => ({ player: player(id), team: team(1), season: 2023,
  games_played: 30, min: 20, pts: 10, fga: 10, fgm: 5, fg3m: 1, fta: 3, ftm: 2, turnover: 1 }));
const appearance = (id: number, at: string): CbbPlayerGame => ({ player: player(id), team: team(1),
  game: { id: id + 10, date: at, season: 2024 }, min: 20 });
const past = appearance(1, "2024-11-01T18:00:00Z"), future = appearance(2, "2024-11-03T18:00:00Z");
const asOf = "2024-11-02T01:00:00Z";
const fitted = attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [past, future], 2024, asOf, 1);
assert.equal(fitted.diagnostics.get(1)?.observedPriorMinutesShare, 0.5);
assert.ok(fitted.prior.teams[1].offense < prior.teams[1].offense);
assert.deepEqual(attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [past, { ...future, player: player(999) }], 2024, asOf, 1), fitted,
  "future player identity cannot affect pregame prior");
assert.equal(attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [past, future], 2024, asOf, 0).prior.teams[1].offense, 10);
assert.equal(attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [{ ...past, min: null }], 2024, asOf, 1).prior.teams[1].offense, 10,
  "DNP-listed player is not evidence of participation");
assert.equal(attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [past], 2024, asOf, 1, new Set([1])).prior.teams[1].offense, 10,
  "source-hole team must retain exact unmodified prior");
assert.throws(() => attenuateCbbPriorFromObservedRoster(prior, priorPlayers, [past], 2023, asOf, 1), /invalid/);
console.log("CBB roster prior temporal and neutral-baseline tests passed");
