import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { NBA_SCALED_PLAYER_IMPACT_RELEASE, scoreNbaScaledPlayerImpact, type NbaScaledImpactHead } from "../../../lib/research/nba/nbaScaledPlayerImpact";
const [inputs, rawPath, output] = process.argv.slice(2);
if (!inputs || !rawPath || !output || fs.existsSync(output)) throw Error("usage: freeze-scaled-player-impact INPUTS RAW_FIT NEW_HEAD");
const bytes = fs.readFileSync(inputs), source = JSON.parse(gunzipSync(bytes).toString());
const raw = fs.readFileSync(rawPath), fit = JSON.parse(raw.toString());
if (fit.release !== NBA_SCALED_PLAYER_IMPACT_RELEASE || fit.inputSha256 !== createHash("sha256").update(bytes).digest("hex") ||
    fit.trainingHash !== source.trainingHash || fit.trainingRows !== source.trainingRows || fit.trainingEnd !== source.trainingEnd ||
    fit.sourceSchemaHash !== source.sourceSchemaHash || fit.ledgerHash !== source.ledgerHash ||
    fit.trainingBaselineHash !== source.trainingBaselineHash || !fit.fit.margin.success || !fit.fit.total.success) throw Error("scaled_impact_fit_source_mismatch");
const train = source.rows.filter((r: { season: number; finalAvailableAt: string }) => r.season === 2022 && Date.parse(r.finalAvailableAt) < Date.parse(source.firstEvaluation));
const scales = Array.from({ length: 6 }, (_, i) => Math.sqrt(train.reduce((s: number, r: { features: number[] }) => s + r.features[i] ** 2, 0) / train.length) || 1);
if (nbaPlayerStateHash(train) !== source.trainingHash || scales.some((x, i) => Math.abs(x - fit.featureScales[i]) > 1e-12 * Math.max(1, x))) throw Error("scaled_impact_training_design_mismatch");
const core = { release: fit.release, trainingHash: fit.trainingHash, trainingEnd: fit.trainingEnd, trainingRows: fit.trainingRows,
  sourceSchemaHash: fit.sourceSchemaHash, ledgerHash: fit.ledgerHash, trainingBaselineHash: fit.trainingBaselineHash,
  rawFitSha256: createHash("sha256").update(raw).digest("hex"), featureScales: fit.featureScales, scaleRule: fit.scaleRule,
  margin: fit.margin, total: fit.total };
const head: NbaScaledImpactHead = { ...core, hash: nbaPlayerStateHash(core) };
scoreNbaScaledPlayerImpact(head, { features: [0, 0, 0, 0, 0, 0], snapshotHash: "a".repeat(64),
  sourceSchemaHash: head.sourceSchemaHash, season: 2023, cutoff: source.firstEvaluation });
const result = { frozenAt: new Date().toISOString(), inputSha256: fit.inputSha256, head,
  fittingPerformed: false, developmentRead: false };
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ frozenAt: result.frozenAt, headHash: head.hash, marginAlpha: head.margin.alpha, totalAlpha: head.total.alpha }));
