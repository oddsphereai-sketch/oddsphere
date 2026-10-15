import assert from "node:assert/strict";
import parityJson from "../lib/automodel/nba/modelArtifacts/nbaProfessionalBootstrapParity.json";
import {
  __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__,
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_BOOTSTRAP_RELEASE,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { scoreNbaPortableModel } from "../lib/automodel/nba/nbaPortableScoreModel";
import { buildNbaPointInTimeFeatures } from "../lib/services/nba/nbaPointInTimeFeatures";

type ParityFixture = {
  release: string;
  modelRelease: string;
  rows: Array<{ gameId: number; features: Record<string, number | null> }>;
};

const parity = parityJson as ParityFixture;
assert.equal(parity.release, NBA_PROFESSIONAL_BOOTSTRAP_RELEASE);
assert.equal(parity.modelRelease, NBA_PROFESSIONAL_MODEL_ARTIFACT.release);

const selectedIds = new Set(parity.rows.map((row) => row.gameId));
const rebuilt = buildNbaPointInTimeFeatures({
  games: __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__.bootstrapGames,
  boxes: __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__.bootstrapBoxes,
  emitGameIds: selectedIds,
});
assert.equal(rebuilt.length, parity.rows.length);
const rebuiltByGame = new Map(rebuilt.map((row) => [row.game_id, row]));
for (const expected of parity.rows) {
  const actual = rebuiltByGame.get(expected.gameId);
  assert.ok(actual, `missing compact parity row ${expected.gameId}`);
  for (const [feature, expectedValue] of Object.entries(expected.features)) {
    const actualValue: string | number | null = actual[feature];
    if (expectedValue === null) assert.equal(actualValue, null, `${expected.gameId}:${feature}`);
    else {
      assert.equal(typeof actualValue, "number", `${expected.gameId}:${feature}`);
      assert.ok(Math.abs((actualValue as number) - expectedValue) < 1e-10, `${expected.gameId}:${feature}`);
    }
  }
}

const opening = buildNbaProfessionalRuntimeFeatures({
  upcomingGames: [
    {
      gameId: 9_100_001,
      season: 2026,
      startTime: "2026-10-20T23:30:00.000Z",
      awayTeam: "HOU",
      homeTeam: "OKC",
    },
    {
      gameId: 9_100_002,
      season: 2026,
      startTime: "2026-10-21T02:00:00.000Z",
      awayTeam: "GSW",
      homeTeam: "LAL",
    },
  ],
});
assert.equal(opening.size, 2);
for (const [gameId, row] of opening) {
  assert.equal(row.game_id, gameId);
  assert.equal(row.target_home_score, null);
  assert.equal(row.target_away_score, null);
  const score = scoreNbaPortableModel(
    NBA_PROFESSIONAL_MODEL_ARTIFACT,
    selectNbaProfessionalPortableFeatures(row),
  );
  assert.ok(Number.isFinite(score.homeScore));
  assert.ok(Number.isFinite(score.awayScore));
  assert.ok(Number.isFinite(score.marginHome));
  assert.ok(Number.isFinite(score.total));
}

console.log("NBA professional runtime artifacts: compact historical parity and opening-night scoring passed.");
