/** Chronological private score audit; no production model or grade writes. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { forecastCbbGame } from "../../lib/cbb/model";
import { cbbPlayedMinutes } from "../../lib/cbb/rosterContext";
import { attenuateCbbPriorFromObservedRoster, CBB_ROSTER_PRIOR_RESEARCH_RELEASE } from "../../lib/cbb/rosterPriorResearch";
import { applyCbbScoreCorrection, cbbScoreFeatures, fitCbbScoreCorrection, fitCbbScoreResearchState,
  type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import type { CbbBox, CbbGame, CbbPlayerGame, CbbPlayerSeason, CbbRatingState, CbbTrainingGame, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";

const directory = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private CBB research only");
const inputSha256: Record<string, string> = {};
const read = async <T>(name: string): Promise<T> => {
  const raw = await readFile(`${directory}/${name}`, "utf8");
  inputSha256[name] = createHash("sha256").update(raw).digest("hex");
  return JSON.parse(raw);
};
const brief = (rows: CbbScoreFeatureRow[]) => {
  const m = evaluateCbbRows(rows); return { games: m.games, wins: m.wins, marginMae: m.marginMae,
    totalMae: m.totalMae, brier: m.brier, logLoss: m.logLoss };
};

function replay(history: CbbTrainingGame[], season: number, config: CbbScoreResearchConfig,
  uncertainty: CbbUncertainty, priorPlayers: CbbPlayerSeason[], appearances: CbbPlayerGame[],
  disabledTeams: ReadonlySet<number>, effect: number) {
  let prior: CbbRatingState | undefined;
  for (const previous of [...new Set(history.filter(game => game.season < season).map(game => game.season))].sort()) {
    prior = fitCbbScoreResearchState(history, { season: previous, asOf: `${previous + 1}-07-01T00:00:00.000Z`, config, prior });
  }
  if (!prior) throw new Error("CBB roster replay requires previous season ratings");
  const grouped = new Map<string, CbbTrainingGame[]>();
  for (const game of history.filter(game => game.season === season)) {
    const day = game.date.slice(0, 10); grouped.set(day, [...(grouped.get(day) ?? []), game]);
  }
  const rows: CbbScoreFeatureRow[] = [];
  let gamesWithBothObserved = 0;
  for (const [day, games] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const asOf = `${day}T00:00:00.000Z`;
    const roster = attenuateCbbPriorFromObservedRoster(prior, priorPlayers, appearances, season, asOf, effect, disabledTeams);
    const state = fitCbbScoreResearchState(history, { season, asOf, config, prior: roster.prior });
    const available = history.filter(game => game.season === season && Date.parse(game.date) + 21600000 <= Date.parse(asOf));
    for (const game of games) {
      const forecast = { ...forecastCbbGame(state, game, uncertainty), release: CBB_ROSTER_PRIOR_RESEARCH_RELEASE };
      rows.push({ game, forecast, features: cbbScoreFeatures(forecast, state, game, available) });
      gamesWithBothObserved += Number((roster.diagnostics.get(game.homeId)?.observedGames ?? 0) > 0 &&
        (roster.diagnostics.get(game.awayId)?.observedGames ?? 0) > 0);
    }
  }
  return { rows, gamesWithBothObserved };
}

async function main() {
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("CBB audit requires a clean source commit");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const artifact = await read<{ config: CbbScoreResearchConfig }>("candidate-r2-artifact.json");
  const prior2022 = (await read<{ data: CbbPlayerSeason[] }>("players-2022.json")).data;
  const prior2023 = (await read<{ data: CbbPlayerSeason[] }>("players-2023.json")).data;
  const appearanceArchive = async (season: number) => {
    const archive = await read<{ data: CbbPlayerGame[]; missingGames: number[]; games: number; observedGames: number; season: number }>(`player-games-${season}.json`);
    if (archive.season !== season || archive.observedGames + archive.missingGames.length !== archive.games) {
      throw new Error(`incoherent CBB ${season} player-game history; roster audit blocked`);
    }
    const seasonGames = games.filter(game => game.season === season);
    const played = new Map<string, Set<number>>();
    for (const row of archive.data) if (cbbPlayedMinutes(row.min) > 0) {
      const key = `${row.game.id}:${row.team.id}`;
      const ids = played.get(key) ?? new Set<number>(); ids.add(row.player.id); played.set(key, ids);
    }
    const missingSet = new Set(archive.missingGames);
    if (seasonGames.filter(game => game.status_state === "final" && game.home_team.conference_id && game.visitor_team.conference_id)
      .some(game => !missingSet.has(game.id) && ((played.get(`${game.id}:${game.home_team.id}`)?.size ?? 0) < 5 ||
        (played.get(`${game.id}:${game.visitor_team.id}`)?.size ?? 0) < 5))) {
      throw new Error(`partial CBB ${season} player-game box; roster audit blocked`);
    }
    const missing = archive.missingGames.map(id => seasonGames.find(game => game.id === id));
    if (missing.some(game => !game) || archive.missingGames.some(id => history.some(game => game.id === id))) {
      throw new Error(`CBB ${season} missing player box overlaps score cohort or game identity`);
    }
    const disabledTeams = new Set(missing.flatMap(game => [game!.home_team.id, game!.visitor_team.id]));
    return { appearances: archive.data, disabledTeams, missingGames: archive.missingGames };
  };
  const games2023 = await appearanceArchive(2023);
  const games2024 = await appearanceArchive(2024);
  const baselineDev = await read<CbbScoreFeatureRow[]>("score-feature-development.json");
  const baselineSel = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const developmentIds = new Set(history.filter(game => game.season === 2023).map(game => game.id));
  const selectedIds = new Set(history.filter(game => game.season === 2024).map(game => game.id));
  if (baselineDev.some(row => row.game.season !== 2023) || baselineDev.length !== developmentIds.size ||
    new Set(baselineDev.map(row => row.game.id)).size !== developmentIds.size ||
    baselineDev.some(row => !developmentIds.has(row.game.id)) || baselineSel.some(row => row.game.season !== 2024) ||
    baselineSel.length !== selectedIds.size || new Set(baselineSel.map(row => row.game.id)).size !== selectedIds.size ||
    baselineSel.some(row => !selectedIds.has(row.game.id))) throw new Error("CBB roster baseline cohort mismatch");
  const baseline = applyCbbScoreCorrection(baselineSel, fitCbbScoreCorrection(baselineDev, "matchup", 2023));
  const candidates = [];
  for (const effect of [0.5, 1]) {
    const development = replay(history, 2023, artifact.config, CBB_DEVELOPMENT_UNCERTAINTY,
      prior2022, games2023.appearances, games2023.disabledTeams, effect);
    const uncertainty = fitCbbUncertainty(development.rows, 2023);
    const selection = replay(history, 2024, artifact.config, uncertainty,
      prior2023, games2024.appearances, games2024.disabledTeams, effect);
    const correction = fitCbbScoreCorrection(development.rows, "matchup", 2023);
    const corrected = applyCbbScoreCorrection(selection.rows, correction);
    if (corrected.length !== selectedIds.size || new Set(corrected.map(row => row.game.id)).size !== selectedIds.size ||
      corrected.some(row => !selectedIds.has(row.game.id))) throw new Error("CBB roster candidate cohort mismatch");
    const baselineMap = new Map(baseline.map(row => [row.game.id, row]));
    let corrections = 0, harms = 0;
    for (const row of corrected) {
      const old = baselineMap.get(row.game.id);
      if (!old) throw new Error("CBB roster candidate selection cohort mismatch");
      const outcome = row.game.homeScore > row.game.awayScore;
      const before = (old.forecast.homeWinProbability >= 0.5) === outcome;
      const after = (row.forecast.homeWinProbability >= 0.5) === outcome;
      corrections += Number(!before && after); harms += Number(before && !after);
    }
    const result = { effect, selection: brief(corrected), corrections, harms,
      gamesWithBothObserved: selection.gamesWithBothObserved, developmentGames: development.rows.length };
    candidates.push(result); console.log(JSON.stringify(result));
  }
  const report = { release: CBB_ROSTER_PRIOR_RESEARCH_RELEASE, productionWrites: 0, sourceCommit, inputSha256, trainSeason: 2023,
    selectionSeason: 2024, baseline: brief(baseline), candidates,
    missingPlayerGameHandling: { developmentGames: games2023.missingGames, developmentDisabledTeams: [...games2023.disabledTeams],
      selectionGames: games2024.missingGames, selectionDisabledTeams: [...games2024.disabledTeams],
      rule: "Any team in a missing player-stat game has roster prior adjustment disabled for the entire season; missing games cannot enter the score cohort." },
    limitations: "Partial post-opener roster membership only. Historical player participation is event-time filtered; preseason newcomers and unplayed transfers are not observable. 2024 selection has already been adaptively inspected; no untouched accuracy claim." };
  await writeFile(`${directory}/roster-prior-r20-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB roster prior audit failed"); process.exitCode = 1; });
