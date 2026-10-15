import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  scoreNbaPortableModel,
  type NbaPortableFeatureRow,
  type NbaPortableModelArtifact,
  type NbaPortableScore,
} from "../../lib/automodel/nba/nbaPortableScoreModel";

type Fixture = {
  artifact: NbaPortableModelArtifact;
  rows: Array<{
    gameId: number;
    features: NbaPortableFeatureRow;
    expected: NbaPortableScore;
  }>;
};

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error("usage: verify-nba-portable-artifact-parity.ts <fixture.json>");
  const fixture = JSON.parse(await readFile(path, "utf8")) as Fixture;
  assert.ok(fixture.rows.length > 0, "parity fixture must contain rows");

  let maximumAbsoluteDifference = 0;
  for (const row of fixture.rows) {
    const actual = scoreNbaPortableModel(fixture.artifact, row.features);
    for (const key of ["homeScore", "awayScore", "marginHome", "total"] as const) {
      const difference = Math.abs(actual[key] - row.expected[key]);
      maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, difference);
      assert.ok(difference <= 1e-9, `game ${row.gameId} ${key} parity difference ${difference}`);
    }
  }
  console.log(JSON.stringify({
    release: fixture.artifact.release,
    rows: fixture.rows.length,
    maximumAbsoluteDifference,
    parity: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
