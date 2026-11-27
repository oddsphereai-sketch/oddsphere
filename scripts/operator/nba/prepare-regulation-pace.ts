/** Same original source cohort, exact legacy parity, duration-aware Total input only. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildNbaRegulationPaceFeatures, NBA_REGULATION_PACE_FEATURE_RELEASE } from "../../../lib/services/nba/nbaPointInTimeFeatures";
import { verifyNbaOriginalTeamGame } from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";
const [archive, originalInputs, output] = process.argv.slice(2);
if (!archive || !originalInputs || !output || fs.existsSync(output)) throw Error("usage: prepare-regulation-pace NATIVE_ARCHIVE C4_INPUTS NEW_OUTPUT.gz");
const sourceBytes = fs.readFileSync(originalInputs), source = JSON.parse(gunzipSync(sourceBytes).toString());
const { hash, ...baselineCore } = source.baseline;
if (hash !== nbaPlayerStateHash(baselineCore) || source.rows.length > 10000 || source.baseline.artifact.model.alpha !== 1000) throw Error("changed_frozen_baseline");
const originals = source.rows as { gameId: string; season: number; startAt: string; cutoff: string; finalAvailableAt: string;
  sourceSha256: string; features: Record<string, number | null>; actualMargin: number; actualTotal: number }[];
const before = nbaPlayerStateHash(originals), durations = new Map<number, number>(), publications = new Map<number, string>();
const admitted = originals.map(r => {
  const stem = path.join(archive, "native", r.gameId + "-boxscore"), bytes = gunzipSync(fs.readFileSync(stem + ".json.gz"));
  const v = verifyNbaOriginalTeamGame({ gameId: r.gameId, season: r.season, bytes,
    receipt: JSON.parse(fs.readFileSync(stem + ".receipt.json", "utf8")) });
  const raw = JSON.parse(bytes.toString()).game;
  if (v.receipt.sha256 !== r.sourceSha256 || v.sourceAvailableAt !== r.finalAvailableAt || Date.parse(v.game.startTime) !== Date.parse(r.startAt) ||
      !Number.isSafeInteger(raw.period) || raw.period < 4 || raw.regulationPeriods !== 4 ||
      r.actualMargin !== v.game.homeScore - v.game.awayScore || r.actualTotal !== v.game.homeScore + v.game.awayScore) throw Error("unverified_original_duration");
  durations.set(v.game.gameId, 48 + 5 * (raw.period - 4)); publications.set(v.game.gameId, v.sourceAvailableAt);
  return v;
});
const rows = buildNbaRegulationPaceFeatures({ games: admitted.map(v => v.game), boxes: admitted.flatMap(v => v.boxes),
  gameMinutes: durations, finalAvailableAt: publications });
const byId = new Map(rows.map(r => [Number(r.game_id), r])), featureNames = source.baseline.artifact.design.features as string[];
const totalNames = featureNames.map(name => name.replace("pace", "pace48"));
if (featureNames.filter(name => name.includes("pace")).length !== 13 || new Set(totalNames).size !== 75) throw Error("changed_declared_feature_recipe");
const exported = originals.map(r => {
  const row = byId.get(Number(r.gameId)); if (!row || Date.parse(String(row.feature_cutoff)) !== Date.parse(r.cutoff)) throw Error("missing_duration_feature_row");
  for (const f of featureNames) {
    if (r.features[f] === null ? row[f] !== null : typeof row[f] !== "number" || Math.abs(Number(row[f]) - r.features[f]!) > 1e-9) throw Error("changed_legacy_feature:" + f + ":" + r.gameId);
  }
  const b = scoreNbaPortableModel(source.baseline.artifact, r.features);
  return { ...r, baselineMargin: b.marginHome, baselineTotal: b.total,
    durationAwareFeatures: Object.fromEntries(totalNames.map(f => [f, typeof row[f] === "number" ? row[f] : null])),
    recentOvertimeExposed: Number(row.home_recent_overtime_count_5) > 0 || Number(row.away_recent_overtime_count_5) > 0,
    observedGameMinutes: durations.get(Number(r.gameId)) };
});
if (nbaPlayerStateHash(originals) !== before || exported.length !== originals.length) throw Error("original_source_mutation");
exported.sort((a, b) => a.gameId.localeCompare(b.gameId));
const train = exported.filter(r => r.season <= 2022 && Date.parse(r.finalAvailableAt) < Date.parse(source.firstEvaluation));
if (train.length !== source.trainingRows) throw Error("training_scope_changed");
const result = { contract: "nba_regulation_pace_inputs_r1", createdAt: new Date().toISOString(), featureRelease: NBA_REGULATION_PACE_FEATURE_RELEASE,
  originalInputSha256: createHash("sha256").update(sourceBytes).digest("hex"), baseline: source.baseline, featureNames: totalNames,
  trainingHash: nbaPlayerStateHash(train), trainingRows: train.length, trainingEnd: train.map(r => r.finalAvailableAt).sort().at(-1),
  firstEvaluation: source.firstEvaluation, originalRowsHashBefore: before, originalRowsHashAfter: nbaPlayerStateHash(originals),
  durationSourceHash: nbaPlayerStateHash(exported.map(r => ({ gameId: r.gameId, minutes: r.observedGameMinutes, sourceSha256: r.sourceSha256 }))),
  legacyFeatureParityRows: exported.length, rows: exported, productionWrites: 0, providerRequests: 0, fittingPerformed: false };
fs.writeFileSync(output, gzipSync(JSON.stringify(result)), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ...result, baseline: undefined, rows: undefined }));
