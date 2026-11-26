/** Offline source verification only. No provider/database or fitting. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { verifyNbaOriginalTeamGame } from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";

const [archive, priorInputs, priorFreeze, destination] = process.argv.slice(2);
if (!archive || !priorInputs || !priorFreeze || !destination || fs.existsSync(destination)) {
  throw Error("usage: prepare-team-score-state ARCHIVE C3_INPUT C3_FREEZE NEW_OUTPUT");
}
const bytes = fs.readFileSync(priorInputs), sha = createHash("sha256").update(bytes).digest("hex");
const source = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32_000_000 }).toString());
const frozen = JSON.parse(fs.readFileSync(priorFreeze, "utf8"));
if (frozen.inputSha256 !== sha || source.rows.length > 10000 || source.rows.length < 4000) {
  throw Error("changed_frozen_original_source_or_budget");
}
const before = nbaPlayerStateHash(source.rows);
const rows = source.rows.map((r: { gameId: string; season: number; startAt: string;
  cutoff: string; finalAvailableAt: string; sourceSha256: string; homeScore: number; awayScore: number }) => {
  const stem = path.join(archive, "native", r.gameId + "-boxscore");
  const original = verifyNbaOriginalTeamGame({ gameId: r.gameId, season: r.season,
    bytes: gunzipSync(fs.readFileSync(stem + ".json.gz")),
    receipt: JSON.parse(fs.readFileSync(stem + ".receipt.json", "utf8")) });
  const g = original.game;
  if (original.receipt.sha256 !== r.sourceSha256 || original.sourceAvailableAt !== r.finalAvailableAt ||
      Date.parse(g.startTime) !== Date.parse(r.startAt) || Date.parse(r.cutoff) !== Date.parse(g.startTime) - 3600000 ||
      g.homeScore !== r.homeScore || g.awayScore !== r.awayScore || g.homeTeamId === g.awayTeamId) {
    throw Error("original_identity_score_or_clock_mismatch:" + r.gameId);
  }
  return { ...r, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId };
});
if (new Set(rows.map((r: { gameId: string }) => r.gameId)).size !== rows.length || nbaPlayerStateHash(source.rows) !== before) {
  throw Error("duplicate_or_mutated_original");
}
const result = { ...source, createdAt: new Date().toISOString(),
  contract: "nba_team_score_state_original_inputs_r1", priorInputSha256: sha,
  priorFreezeSha256: createHash("sha256").update(fs.readFileSync(priorFreeze)).digest("hex"), rows,
  originalRowsHashBefore: before, originalRowsHashAfter: nbaPlayerStateHash(source.rows),
  productionWrites: 0, providerRequests: 0, fittingPerformed: false };
fs.writeFileSync(destination, gzipSync(JSON.stringify(result)), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ rows: rows.length, sourceSha256: sha, identitySourceRefusals: 0,
  originalRowsHash: before, productionWrites: 0, providerRequests: 0, fittingPerformed: false }));
