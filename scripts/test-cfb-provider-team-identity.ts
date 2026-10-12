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
  cfbProviderTeamMatches({ abbreviation: "M-OH", expectedName: "Miami (OH) RedHawks", observed: "Miami FL" }),
  false,
  "Miami provider aliases cannot cross between the Florida and Ohio programs",
);

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
