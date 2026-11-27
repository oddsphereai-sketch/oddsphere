/** Canonicalize the fitted head before any development replay. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { NBA_PRIOR_FINALS_CALIBRATION_RELEASE, type NbaClimateHead } from "../../../lib/research/nba/nbaPriorFinalsCalibration";
const [input, rawPath, output] = process.argv.slice(2);
if (!input || !rawPath || !output || fs.existsSync(output)) throw Error("usage: freeze-prior-finals-calibration INPUTS RAW_FIT NEW_HEAD");
const bytes = fs.readFileSync(input), source = JSON.parse(gunzipSync(bytes).toString()), rawBytes = fs.readFileSync(rawPath), fit = JSON.parse(rawBytes.toString());
if (fit.inputSha256 !== createHash("sha256").update(bytes).digest("hex") || fit.release !== NBA_PRIOR_FINALS_CALIBRATION_RELEASE ||
    fit.trainingHash !== source.trainingHash || fit.trainingEnd !== source.trainingEnd || fit.trainingBaselineHash !== source.trainingBaselineHash ||
    !fit.fit.margin.success || !fit.fit.total.success) throw Error("frozen_fit_source_mismatch");
const train = source.rows.filter((r: {season:number;finalAvailableAt:string}) => r.season === 2022 && r.finalAvailableAt < source.firstSelection);
if (nbaPlayerStateHash(train) !== fit.trainingHash || train.length !== source.trainingRows) throw Error("frozen_training_hash_mismatch");
const core: Omit<NbaClimateHead,"hash"> = { release: fit.release, sourceRecipe: fit.sourceRecipe, baselineRecipe: fit.baselineRecipe,
  clockMode: fit.clockMode, trainingSeason: fit.trainingSeason, trainingEnd: fit.trainingEnd,
  trainingHash: fit.trainingHash, trainingBaselineHash: fit.trainingBaselineHash, rawFitSha256: createHash("sha256").update(rawBytes).digest("hex"),
  margin: fit.margin, total: fit.total };
const out = { frozenAt: new Date().toISOString(), inputSha256: fit.inputSha256, head: {...core,hash:nbaPlayerStateHash(core)}, fittingPerformed: false, developmentRead: false };
fs.writeFileSync(output,JSON.stringify(out,null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify(out));
