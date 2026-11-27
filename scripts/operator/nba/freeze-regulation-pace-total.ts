import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { NBA_REGULATION_PACE_TOTAL_RELEASE, type NbaRegulationPaceTotalHead, scoreNbaRegulationPaceTotal } from "../../../lib/research/nba/nbaRegulationPaceTotal";
const [input, fitPath, output] = process.argv.slice(2);
if (!input || !fitPath || !output || fs.existsSync(output)) throw Error("usage: freeze-regulation-pace-total INPUTS FIT NEW_HEAD");
const bytes = fs.readFileSync(input), source = JSON.parse(gunzipSync(bytes).toString()), raw = fs.readFileSync(fitPath), fit = JSON.parse(raw.toString());
if (fit.inputSha256 !== createHash("sha256").update(bytes).digest("hex") || fit.release !== NBA_REGULATION_PACE_TOTAL_RELEASE ||
    fit.featureRelease !== source.featureRelease || fit.trainingHash !== source.trainingHash || fit.trainingRows !== source.trainingRows ||
    fit.trainingEnd !== source.trainingEnd || fit.baselineHash !== source.baseline.hash || fit.durationSourceHash !== source.durationSourceHash ||
    fit.alpha !== 1000 || fit.marginFitted !== false || fit.legacyCoefficientMaxDifference > 1e-9) throw Error("pace_fit_source_mismatch");
const core = { release: fit.release, featureRelease: fit.featureRelease, trainingHash: fit.trainingHash, trainingRows: fit.trainingRows,
  trainingEnd: fit.trainingEnd, baselineHash: fit.baselineHash, durationSourceHash: fit.durationSourceHash,
  rawFitSha256: createHash("sha256").update(raw).digest("hex"), alpha: fit.alpha, design: fit.design, totalCoefficients: fit.totalCoefficients };
const head: NbaRegulationPaceTotalHead = { ...core, hash: nbaPlayerStateHash(core) };
scoreNbaRegulationPaceTotal(head, {}, source.firstEvaluation);
const result = { frozenAt: new Date().toISOString(), inputSha256: fit.inputSha256, head, fittingPerformed: false, developmentRead: false };
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ frozenAt: result.frozenAt, headHash: head.hash, trainingRows: head.trainingRows }));
