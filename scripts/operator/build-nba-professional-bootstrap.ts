/**
 * Build the compact, production-portable NBA point-in-time bootstrap.
 *
 * The raw BALLDONTLIE player box archive is intentionally ignored and is too
 * large to ship. The selected r15 scorer only consumes schedule, score,
 * possession, rolling rating, and regime features. One aggregate team box per
 * game preserves every input used by those selected features while excluding
 * unused player-level detail.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerBox,
} from "../../lib/services/nba/nbaPointInTimeFeatures";

const RELEASE = "nba_professional_bootstrap_2026_10_15_r1_selected_feature_parity";
const SOURCE_RELEASE = "nba_bdl_historical_research_2026_10_15_r2_resumable_game_scoped";
const SEASONS = [2021, 2022, 2023, 2024, 2025] as const;
const OUTPUT = path.resolve("lib/automodel/nba/modelArtifacts/nbaProfessionalBootstrap.json");
const MODEL_SOURCE = path.resolve(
  "nba-research/reports/nba_professional_r35_regime_benchmark/tournament/deployment-candidate.json",
);
const MODEL_OUTPUT = path.resolve("lib/automodel/nba/modelArtifacts/nbaProfessionalR15.json");
const FEATURE_REFERENCE = path.resolve(
  "nba-research/reports/nba_professional_r30_season_regime/features/features.jsonl",
);
const PARITY_OUTPUT = path.resolve(
  "lib/automodel/nba/modelArtifacts/nbaProfessionalBootstrapParity.json",
);

type PortableBootstrap = {
  release: typeof RELEASE;
  sourceRelease: typeof SOURCE_RELEASE;
  seasons: number[];
  games: NbaHistoricalGame[];
  boxes: NbaHistoricalPlayerBox[];
  sourceSha256: Record<string, { games: string; box: string }>;
};

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function aggregateTeamBox(
  gameId: number,
  teamId: number,
  rows: readonly NbaHistoricalPlayerBox[],
): NbaHistoricalPlayerBox {
  const team = rows.filter((row) => row.gameId === gameId && row.teamId === teamId);
  if (team.length === 0) throw new Error(`NBA bootstrap game ${gameId} is missing team ${teamId}.`);
  const sum = (key: keyof NbaHistoricalPlayerBox) =>
    team.reduce((total, row) => total + Number(row[key]), 0);
  return {
    rowId: gameId * 100 + teamId,
    gameId,
    teamId,
    playerId: teamId,
    minutes: sum("minutes"),
    fgm: sum("fgm"),
    fga: sum("fga"),
    fg3m: sum("fg3m"),
    fg3a: sum("fg3a"),
    ftm: sum("ftm"),
    fta: sum("fta"),
    oreb: sum("oreb"),
    dreb: sum("dreb"),
    ast: sum("ast"),
    stl: sum("stl"),
    blk: sum("blk"),
    turnover: sum("turnover"),
    pf: sum("pf"),
    points: sum("points"),
    plusMinus: sum("plusMinus"),
  };
}

async function main(): Promise<void> {
  const games: NbaHistoricalGame[] = [];
  const boxes: NbaHistoricalPlayerBox[] = [];
  const sourceSha256: PortableBootstrap["sourceSha256"] = {};
  for (const season of SEASONS) {
    const directory = path.resolve(
      `nba-research/raw/${SOURCE_RELEASE}/${season}/complete`,
    );
    const gamesBody = await readFile(path.join(directory, "games.jsonl"), "utf8");
    const boxBody = await readFile(path.join(directory, "box.jsonl"), "utf8");
    sourceSha256[String(season)] = { games: sha256(gamesBody), box: sha256(boxBody) };
    const seasonGames = gamesBody.trim().split("\n").filter(Boolean)
      .map((line) => normalizeNbaHistoricalGame(JSON.parse(line) as Record<string, unknown>));
    const seasonBoxes = boxBody.trim().split("\n").filter(Boolean)
      .map((line) => normalizeNbaHistoricalPlayerBox(JSON.parse(line) as Record<string, unknown>));
    games.push(...seasonGames);
    for (const game of seasonGames) {
      boxes.push(
        aggregateTeamBox(game.gameId, game.homeTeamId, seasonBoxes),
        aggregateTeamBox(game.gameId, game.awayTeamId, seasonBoxes),
      );
    }
  }
  const artifact: PortableBootstrap = {
    release: RELEASE,
    sourceRelease: SOURCE_RELEASE,
    seasons: [...SEASONS],
    games: games.sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.gameId - right.gameId),
    boxes: boxes.sort((left, right) => left.gameId - right.gameId || left.teamId - right.teamId),
    sourceSha256,
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(artifact)}\n`, "utf8");
  const modelBody = await readFile(MODEL_SOURCE, "utf8");
  const model = JSON.parse(modelBody) as { design: { features: string[] } };
  await writeFile(MODEL_OUTPUT, modelBody.endsWith("\n") ? modelBody : `${modelBody}\n`, "utf8");
  const sortedGames = artifact.games;
  const sampleIds = new Set(
    [0, 614, 1229, 1230, 2459, 2460, 3689, 3690, 4919, 4920, 5535, 6151]
      .map((index) => sortedGames[index]?.gameId)
      .filter((gameId): gameId is number => gameId !== undefined),
  );
  const referenceBody = await readFile(FEATURE_REFERENCE, "utf8");
  const parityRows = referenceBody.trim().split("\n").flatMap((line) => {
    const row = JSON.parse(line) as Record<string, unknown>;
    const gameId = Number(row.game_id);
    if (!sampleIds.has(gameId)) return [];
    return [{
      gameId,
      season: row.season,
      startTime: row.feature_cutoff,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      features: Object.fromEntries(model.design.features.map((feature) => [feature, row[feature] ?? null])),
    }];
  });
  if (parityRows.length !== sampleIds.size) {
    throw new Error(`NBA bootstrap parity fixture found ${parityRows.length}/${sampleIds.size} rows.`);
  }
  await writeFile(PARITY_OUTPUT, `${JSON.stringify({
    release: RELEASE,
    modelRelease: (JSON.parse(modelBody) as { release: string }).release,
    rows: parityRows,
  })}\n`, "utf8");
  console.log(JSON.stringify({
    output: OUTPUT,
    modelOutput: MODEL_OUTPUT,
    parityOutput: PARITY_OUTPUT,
    modelSha256: sha256(modelBody),
    games: games.length,
    boxes: boxes.length,
    bytes: Buffer.byteLength(JSON.stringify(artifact)),
  }));
}

void main();
