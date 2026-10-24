import assert from "node:assert/strict";
import {
  cfbProviderTeamMatches,
  CFB_PROVIDER_TEAM_ALIASES,
} from "../lib/services/football/cfbProviderTeamIdentity";
import { CFB_TEAM_IDENTITIES } from "../lib/services/football/cfbTeamIdentity";

const confirmedProviderLabels = [
  ["APP", "App State Mountaineers", "Appalachian State"],
  ["NICH", "Nicholls Colonels", "Nicholls State Colonels"],
  ["MIA", "Miami Hurricanes", "Miami Florida"],
  ["SHSU", "Sam Houston Bearkats", "Sam Houston State Bearkats"],
  ["MTSU", "Middle Tennessee Blue Raiders", "Middle Tenn ST Blue Raiders"],
  ["MASS", "Massachusetts Minutemen", "UMass"],
  ["NMSU", "New Mexico State Aggies", "NM State"],
  ["UVA", "Virginia Cavaliers", "Virginia"],
  ["IU", "Indiana Hoosiers", "Indiana"],
  ["MICH", "Michigan Wolverines", "Michigan"],
  ["OU", "Oklahoma Sooners", "Oklahoma"],
  ["NU", "Northwestern Wildcats", "Northwestern"],
  ["FAU", "Florida Atlantic Owls", "Florida Atlantic"],
  ["KU", "Kansas Jayhawks", "Kansas"],
  ["ORE", "Oregon Ducks", "Oregon"],
  ["ILL", "Illinois Fighting Illini", "Illinois"],
  ["TENN", "Tennessee Volunteers", "Tennessee"],
  ["SC", "South Carolina Gamecocks", "South Carolina"],
  ["MSU", "Michigan State Spartans", "Michigan State"],
  ["LT", "Louisiana Tech Bulldogs", "Louisiana Tech"],
  ["COLO", "Colorado Buffaloes", "Colorado"],
  ["OKST", "Oklahoma State Cowboys", "Oklahoma State"],
  ["VT", "Virginia Tech Hokies", "Virginia Tech"],
  ["TEX", "Texas Longhorns", "Texas"],
  ["UNC", "North Carolina Tar Heels", "North Carolina"],
  ["ARIZ", "Arizona Wildcats", "Arizona"],
  ["UNM", "New Mexico Lobos", "New Mexico"],
  ["HOU", "Houston Cougars", "Houston"],
  ["TTU", "Texas Tech Red Raiders", "Texas Tech"],
  ["TA&M", "Texas A&M Aggies", "Texas A&M"],
  ["KSU", "Kansas State Wildcats", "Kansas State"],
  ["ASU", "Arizona State Sun Devils", "Arizona State"],
  ["CSU", "Colorado State Rams", "Colorado State"],
  ["TXST", "Texas State Bobcats", "Texas State"],
] as const;

for (const [abbreviation, expectedName, observed] of confirmedProviderLabels) {
  assert.equal(
    cfbProviderTeamMatches({ abbreviation, expectedName, observed }),
    true,
    `${observed} must resolve to ${abbreviation}`,
  );
}

assert.equal(
  cfbProviderTeamMatches({ abbreviation: "APP", expectedName: "App State Mountaineers", observed: "(24) Appalachian State" }),
  true,
  "ranking prefixes cannot hide an explicit provider alias",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "FSU", expectedName: "Florida State Seminoles", observed: "Florida" }),
  false,
  "generic Florida cannot attach to Florida State",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "ALST", expectedName: "Alabama State Hornets", observed: "Alabama" }),
  false,
  "generic Alabama cannot attach to Alabama State",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "VT", expectedName: "Virginia Tech Hokies", observed: "Virginia" }),
  false,
  "Virginia's exact school alias cannot attach to Virginia Tech",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "M-OH", expectedName: "Miami (OH) RedHawks", observed: "Miami FL" }),
  false,
  "Miami provider aliases cannot cross between the Florida and Ohio programs",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "IU", expectedName: "Indiana Hoosiers", observed: "Indiana State" }),
  false,
  "Indiana's exact school alias cannot attach to Indiana State",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "MICH", expectedName: "Michigan Wolverines", observed: "Michigan State" }),
  false,
  "Michigan's exact school alias cannot attach to Michigan State",
);
assert.equal(
  cfbProviderTeamMatches({ abbreviation: "OU", expectedName: "Oklahoma Sooners", observed: "Oklahoma State" }),
  false,
  "Oklahoma's exact school alias cannot attach to Oklahoma State",
);

for (const [abbreviation, expectedName, observed] of [
  ["NWST", "Northwestern State Demons", "Northwestern"],
  ["FLA", "Florida Gators", "Florida Atlantic"],
  ["KSU", "Kansas State Wildcats", "Kansas"],
  ["ORST", "Oregon State Beavers", "Oregon"],
  ["ILST", "Illinois State Redbirds", "Illinois"],
  ["TNST", "Tennessee State Tigers", "Tennessee"],
  ["SCST", "South Carolina State Bulldogs", "South Carolina"],
  ["MICH", "Michigan Wolverines", "Michigan State"],
  ["UL", "Louisiana Ragin' Cajuns", "Louisiana Tech"],
  ["CSU", "Colorado State Rams", "Colorado"],
  ["OU", "Oklahoma Sooners", "Oklahoma State"],
  ["UVA", "Virginia Cavaliers", "Virginia Tech"],
  ["TXST", "Texas State Bobcats", "Texas"],
  ["NCST", "North Carolina State Wolfpack", "North Carolina"],
  ["ASU", "Arizona State Sun Devils", "Arizona"],
  ["NMSU", "New Mexico State Aggies", "New Mexico"],
  ["HCU", "Houston Christian Huskies", "Houston"],
  ["TEX", "Texas Longhorns", "Texas Tech"],
  ["TEX", "Texas Longhorns", "Texas A&M"],
  ["KU", "Kansas Jayhawks", "Kansas State"],
  ["ARIZ", "Arizona Wildcats", "Arizona State"],
  ["COLO", "Colorado Buffaloes", "Colorado State"],
  ["TEX", "Texas Longhorns", "Texas State"],
] as const) {
  assert.equal(
    cfbProviderTeamMatches({ abbreviation, expectedName, observed }),
    false,
    `${observed} must not cross-attach to ${abbreviation}`,
  );
}

for (const abbreviation of Object.keys(CFB_PROVIDER_TEAM_ALIASES)) {
  if (!(abbreviation in CFB_TEAM_IDENTITIES)) continue;
  for (const alias of CFB_PROVIDER_TEAM_ALIASES[abbreviation] ?? []) {
    assert.equal(
      cfbProviderTeamMatches({
        abbreviation,
        expectedName: CFB_TEAM_IDENTITIES[abbreviation as keyof typeof CFB_TEAM_IDENTITIES].displayName,
        observed: alias,
      }),
      true,
      `${alias} must remain a valid ${abbreviation} alias`,
    );
  }
}

console.log("CFB centralized provider team identity tests passed.");
