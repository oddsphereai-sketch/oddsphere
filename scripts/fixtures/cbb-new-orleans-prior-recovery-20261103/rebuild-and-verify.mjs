/** Offline source verification and frozen-prior rebuild. No provider or database calls. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
if (!root) throw new Error("Pass the repository worktree root");
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const gz = name => JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, name))).toString());
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sourceName = name => canonical(name.replace(/^LSU New Orleans\b/, "New Orleans"));
const oldDir = path.join(root, "scripts/fixtures/cbb-stthomas-prior-recovery-20261102");
const originalBytes = gunzipSync(fs.readFileSync(path.join(oldDir, "original-normalized-history.json.gz")));
const original = JSON.parse(originalBytes);
const stPatch = JSON.parse(fs.readFileSync(path.join(oldDir, "stthomas-venue-patch.json"), "utf8"));
const oldManifest = JSON.parse(fs.readFileSync(path.join(oldDir, "manifest.json"), "utf8"));
if (sha(originalBytes) !== oldManifest.originalNormalizedHistory.sha256) throw new Error("Original history changed");
const stById = new Map(stPatch.rows.map(row => [row.gameId, row]));
const withSt = original.map(game => {
  const p = stById.get(game.id);
  if (!p) return game;
  if (game.neutral !== null || (game.homeId !== 332 && game.awayId !== 332) ||
      game.season !== p.season || game.date !== p.identity.originalStart ||
      game.homeScore !== p.identity.homeScore || game.awayScore !== p.identity.awayScore) {
    throw new Error("St. Thomas base patch lost parity");
  }
  return { ...game, neutral: p.to };
});
const oldArtifact = JSON.parse(fs.readFileSync(path.join(root, "lib/cbb/artifacts/candidate-r3.json"), "utf8"));
const bdlRows = gz("bdl-games.json.gz");
const espnSchedules = gz("espn-schedules.json.gz");
const bdlById = new Map(bdlRows.map(row => [row.id, row]));
const espnBySeason = new Map(Object.entries(espnSchedules).map(([season, receipt]) =>
  [Number(season) - 1, receipt.events ?? []]));
const patch = [];
for (const game of withSt) {
  if (game.homeId !== 317 && game.awayId !== 317) continue;
  if (game.neutral !== null) throw new Error("Existing New Orleans venue cannot be replaced");
  const bdl = bdlById.get(game.id);
  if (!bdl || bdl.season !== game.season || bdl.date !== game.date ||
      bdl.home_team.id !== game.homeId || bdl.visitor_team.id !== game.awayId ||
      bdl.home_score !== game.homeScore || bdl.away_score !== game.awayScore) {
    throw new Error(`BDL historical identity changed: ${game.id}`);
  }
  const candidates = (espnBySeason.get(game.season) ?? []).filter(event => {
    const c = event.competitions?.[0];
    if (!c || typeof c.neutralSite !== "boolean" || !(event.timeValid === true || c.timeValid === true) ||
        Date.parse(event.date) !== Date.parse(game.date)) return false;
    const home = c.competitors?.find(row => row.homeAway === "home");
    const away = c.competitors?.find(row => row.homeAway === "away");
    const num = score => typeof score === "object" ? Number(score.value) : Number(score);
    return home && away &&
      (home.team.id === "2443") === (game.homeId === 317) &&
      (away.team.id === "2443") === (game.awayId === 317) &&
      sourceName(home.team.displayName) === canonical(bdl.home_team.full_name) &&
      sourceName(away.team.displayName) === canonical(bdl.visitor_team.full_name) &&
      num(home.score) === game.homeScore && num(away.score) === game.awayScore;
  });
  if (candidates.length !== 1) throw new Error(`ESPN venue identity is not unique: ${game.id} (${candidates.length})`);
  const event = candidates[0];
  patch.push({ gameId: game.id, season: game.season, date: game.date,
    homeId: game.homeId, awayId: game.awayId, homeScore: game.homeScore, awayScore: game.awayScore,
    espnEventId: event.id, espnSchoolId: "2443", neutral: event.competitions[0].neutralSite });
}
if (patch.length !== 123 || new Set(patch.map(row => row.gameId)).size !== 123) {
  throw new Error(`Expected 123 verified New Orleans venues, got ${patch.length}`);
}
const patchById = new Map(patch.map(row => [row.gameId, row]));
const corrected = withSt.map(game => patchById.has(game.id) ? { ...game, neutral: patchById.get(game.id).neutral } : game);
const { fitCbbScoreResearchState } = await import(pathToFileURL(path.join(root, "lib/cbb/scoreResearch.ts")).href);
function fit(history) {
  let prior;
  for (const season of [2022, 2023, 2024, 2025]) {
    prior = fitCbbScoreResearchState(history, {
      season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: oldArtifact.config, prior,
    });
  }
  return { ...prior, release: oldArtifact.prior.release,
    teams: Object.fromEntries(Object.entries(prior.teams).map(([id, team]) =>
      [id, { ...team, factors: null, opponentFactors: null }])) };
}
const reproduced = fit(withSt);
if (JSON.stringify(reproduced) !== JSON.stringify(oldArtifact.prior)) throw new Error("Frozen R3 prior failed exact reconstruction");
const nextPrior = fit(corrected);
if (!nextPrior.teams[317] || nextPrior.teams[317].games < 20) throw new Error("New Orleans rating not recovered");
const candidate = { ...oldArtifact, release: "cbb_candidate_2026_11_03_r4_verified_new_orleans_venue_prior", prior: nextPrior };
const artifactFile = path.join(root, "lib/cbb/artifacts/candidate-r4.json");
const artifactBytes = JSON.stringify(candidate, null, 2) + "\n";
const patchBytes = JSON.stringify({
  scope: "Only 123 source-verified New Orleans historical venue flags", rows: patch,
}, null, 2) + "\n";
const manifestBytes = JSON.stringify({
  base: "8b5bddf65cffbc2d8aea4c8bed5614858d8e39f5",
  source: { espnSchoolId: "2443", bdlSchoolId: 317,
    espnSchedulesSha256: sha(gunzipSync(fs.readFileSync(path.join(dir, "espn-schedules.json.gz")))),
    bdlGamesSha256: sha(gunzipSync(fs.readFileSync(path.join(dir, "bdl-games.json.gz")))) },
  originalHistorySha256: sha(originalBytes), priorR3Parity: true,
  newOrleansVerifiedGames: patch.length, neutral: {
    true: patch.filter(row => row.neutral).length, false: patch.filter(row => !row.neutral).length,
  }, priorR4Sha256: sha(JSON.stringify(nextPrior)), artifactR4Sha256: sha(artifactBytes),
}, null, 2) + "\n";
if (process.argv[3] === "--verify") {
  for (const [file, expected] of [[artifactFile, artifactBytes],
    [path.join(dir, "new-orleans-venue-patch.json"), patchBytes],
    [path.join(dir, "manifest.json"), manifestBytes]]) {
    if (fs.readFileSync(file, "utf8") !== expected) throw new Error(`Verified artifact differs: ${file}`);
  }
} else if (process.argv.length === 3) {
  fs.writeFileSync(artifactFile, artifactBytes);
  fs.writeFileSync(path.join(dir, "new-orleans-venue-patch.json"), patchBytes);
  fs.writeFileSync(path.join(dir, "manifest.json"), manifestBytes);
} else throw new Error("Only --verify is accepted");
console.log(JSON.stringify({ oldPriorParity: true, games: patch.length, newOrleansPriorGames: nextPrior.teams[317].games,
  neutral: { true: patch.filter(row => row.neutral).length, false: patch.filter(row => !row.neutral).length },
  artifact: artifactFile }));
