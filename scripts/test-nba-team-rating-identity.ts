import assert from "node:assert/strict";
import { normalizeTeamAbbr } from "../lib/providers/playbook/playbookTeamNormalizer";
import {
  matchBbrRatingToNbaTeam,
  NBA_TEAM_RATINGS_REFRESH_RELEASE,
  type NbaTeamRow,
} from "../lib/services/nba/nbaTeamRatingIdentity";
import type { BbrTeamRatings } from "../lib/providers/real_api/_basketballReferenceClient";

const storedTeams: NbaTeamRow[] = [
  { id: 1, abbreviation: "GS" },
  { id: 2, abbreviation: "WSH" },
  { id: 3, abbreviation: "UTAH" },
  { id: 4, abbreviation: "NO" },
  { id: 5, abbreviation: "NY" },
  { id: 6, abbreviation: "SA" },
  { id: 7, abbreviation: "BKN" },
  { id: 8, abbreviation: "CHA" },
  { id: 9, abbreviation: "PHX" },
];

function bbr(abbreviation: string): BbrTeamRatings {
  return {
    team_name: abbreviation,
    abbreviation,
    off_rating: 115,
    def_rating: 114,
    net_rating: 1,
    pace: 99,
    off_efg_pct: 0.55,
    off_tov_pct: 0.12,
    off_orb_pct: 0.25,
    off_ft_rate: 0.22,
    def_efg_pct: 0.54,
    def_tov_pct: 0.13,
    def_drb_pct: 0.74,
    def_ft_rate_allowed: 0.21,
    source_url: "https://example.test",
    fetched_at: "2026-10-21T00:00:00.000Z",
  };
}

const expected = new Map([
  ["GSW", 1], ["WAS", 2], ["UTA", 3], ["NOP", 4], ["NYK", 5], ["SAS", 6],
  ["BRK", 7], ["CHO", 8], ["PHO", 9],
]);
for (const [providerAbbreviation, teamId] of expected) {
  assert.equal(
    matchBbrRatingToNbaTeam(bbr(providerAbbreviation), storedTeams)?.id,
    teamId,
    `${providerAbbreviation} must resolve to the one exact stored NBA identity`,
  );
}

assert.equal(normalizeTeamAbbr("nba", "GS"), "GSW");
assert.equal(normalizeTeamAbbr("nba", "WSH"), "WAS");
assert.equal(normalizeTeamAbbr("nba", "UTAH"), "UTA");
assert.equal(normalizeTeamAbbr("nba", "NO"), "NOP");
assert.equal(matchBbrRatingToNbaTeam(bbr("SEA"), storedTeams), null);
assert.equal(
  matchBbrRatingToNbaTeam(bbr("GSW"), [...storedTeams, { id: 10, abbreviation: "GSW" }]),
  null,
  "ambiguous stored identities must fail closed",
);
assert.match(NBA_TEAM_RATINGS_REFRESH_RELEASE, /exact_team_identity_prior_recovery/);

console.log("NBA team-rating identity tests passed");
