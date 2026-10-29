import assert from "node:assert/strict";
import { resolveCbbTeamIdentities } from "../lib/cbb/teamIdentity";
import type { CbbTeam } from "../lib/cbb/types";

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
assert.throws(() => resolveCbbTeamIdentities([bdl[0], bdl[0]], espn), /duplicate BDL/);
console.log("CBB team identity tests passed");
