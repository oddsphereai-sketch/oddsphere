import assert from "node:assert/strict";
import { completeCbbTeamIdentitiesFromEvents, resolveCbbTeamIdentities } from "../lib/cbb/teamIdentity";
import { fetchCbbTeamIdentities } from "../lib/services/cbb/fetchCbbTeamIdentities";
import { cbbCanonicalTeamPayload } from "../lib/cbb/canonicalFixture";
import type { CbbGame, CbbTeam } from "../lib/cbb/types";

const team = (id: number, full_name: string, abbreviation: string): CbbTeam => ({
  id, full_name, abbreviation, conference_id: 1, name: full_name.split(" ").at(-1)!, college: full_name,
});
const bdl = [team(1, "Texas Longhorns", "TEX"), team(2, "Texas A&M-San Antonio Jaguars", "TEX"),
  team(3, "Butler Bulldogs", "BUT"), team(4, "New Orleans Privateers", "UNO")];
const espn = [
  { id: "251", displayName: "Texas Longhorns", abbreviation: "TEX", logos: [{ href: "https://a.espncdn.com/i/teamlogos/ncaa/500/251.png" }] },
  { id: "2086", displayName: "Butler Bulldogs", abbreviation: "BTLR", logos: [{ href: "https://a.espncdn.com/i/teamlogos/ncaa/500/2086.png" }] },
  { id: "2443", displayName: "LSU New Orleans Privateers", abbreviation: "UNO", logos: [{ href: "https://a.espncdn.com/i/teamlogos/ncaa/500/2443.png" }] },
];
const identities = resolveCbbTeamIdentities(bdl, espn);
assert.equal(identities.get(1)?.espnTeamId, "251");
assert.equal(identities.get(2)?.logoUrl, null); // Same abbreviation is never sufficient.
assert.equal(identities.get(3)?.espnAbbreviation, "BTLR"); // Distinct verified source abbreviation.
assert.equal(identities.get(4)?.logoUrl, null); // Similar mascot is not an identity.
assert.equal(resolveCbbTeamIdentities([bdl[0]], [...espn, espn[0]]).get(1)?.status, "ambiguous");
assert.equal(resolveCbbTeamIdentities([bdl[0]], [{ ...espn[0],
  logos: [{ href: "https://a.espncdn.com/i/teamlogos/ncaa/500/999.png" }] }]).get(1)?.logoUrl, null);
assert.throws(() => resolveCbbTeamIdentities([bdl[0], bdl[0]], espn), /duplicate BDL/);
const game: CbbGame = { id: 100, date: "2026-11-02T19:00:00Z", season: 2026,
  home_team: bdl[2], visitor_team: bdl[1], status: "pre", status_state: "scheduled", period: 0,
  home_score: 0, away_score: 0 };
const event = { id: "espn-100", date: game.date, competitions: [{ neutralSite: false, timeValid: true,
  competitors: [
    { homeAway: "home", team: { id: "2086", displayName: bdl[2].full_name,
      abbreviation: "BTLR", logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2086.png" } },
    { homeAway: "away", team: { id: "9999", displayName: bdl[1].full_name,
      abbreviation: "TEX", logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/9999.png" } },
  ] }] };
const eventIdentities = completeCbbTeamIdentitiesFromEvents({ identities,
  games: [game], events: [event], fetchedAt: "2026-10-29T18:00:00Z" });
assert.equal(eventIdentities.get(2)?.status, "verified_exact_event");
assert.equal(eventIdentities.get(2)?.espnTeamId, "9999");
assert.equal(eventIdentities.get(2)?.logoUrl, "https://a.espncdn.com/i/teamlogos/ncaa/500/9999.png");
assert.equal(cbbCanonicalTeamPayload(bdl[1], eventIdentities.get(2)).logo_url,
  "https://a.espncdn.com/i/teamlogos/ncaa/500/9999.png");
assert.throws(() => cbbCanonicalTeamPayload(bdl[0], eventIdentities.get(2)), /crossed canonical/);
assert.equal(completeCbbTeamIdentitiesFromEvents({ identities, games: [game],
  events: [{ ...event, competitions: [{ ...event.competitions[0], competitors: [event.competitions[0].competitors[0],
    { ...event.competitions[0].competitors[1], team: { ...event.competitions[0].competitors[1].team,
      logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/8888.png" } }] }] }],
  fetchedAt: "2026-10-29T18:00:00Z" }).get(2)?.logoUrl, null);
assert.equal(identities.get(2)?.logoUrl, null); // The catalog input is not mutated.
assert.equal(completeCbbTeamIdentitiesFromEvents({ identities, games: [game],
  events: [{ ...event, competitions: [{ ...event.competitions[0], timeValid: false }] }],
  fetchedAt: "2026-10-29T18:00:00Z" }).get(2)?.logoUrl, null);
assert.equal(completeCbbTeamIdentitiesFromEvents({ identities, games: [game],
  events: [{ ...event, competitions: [{ ...event.competitions[0], competitors: [event.competitions[0].competitors[0],
    { ...event.competitions[0].competitors[1], team: { ...event.competitions[0].competitors[1].team,
      displayName: "Other Texas Jaguars" } }] }] }],
  fetchedAt: "2026-10-29T18:00:00Z" }).get(2)?.logoUrl, null);
const conflictingEvent = structuredClone(event);
conflictingEvent.competitions[0].competitors[0].team.id = "9998";
assert.throws(() => completeCbbTeamIdentitiesFromEvents({ identities,
  games: [game], events: [conflictingEvent], fetchedAt: "2026-10-29T18:00:00Z" }), /identity conflict/);
const catalog = [...espn, ...Array.from({ length: 300 }, (_, index) => ({ id: String(10000 + index),
  displayName: `Example Team ${index}` }))];
const calls: string[] = [];
fetchCbbTeamIdentities({ games: [game], slateDate: "2026-11-02", fetcher: (async input => {
  const url = String(input); calls.push(url);
  return Response.json(url.includes("/scoreboard?") ? { events: [event] } : {
    sports: [{ leagues: [{ teams: catalog.map(item => ({ team: item })) }] }],
  });
}) as typeof fetch }).then(resolved => {
  assert.equal(calls.length, 2);
  assert.equal(resolved.get(2)?.espnTeamId, "9999");
  assert.equal(resolved.get(3)?.espnTeamId, "2086");
  console.log("CBB team identity tests passed");
}).catch(error => { console.error(error); process.exitCode = 1; });
