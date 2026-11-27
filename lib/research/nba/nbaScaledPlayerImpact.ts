/** Offline C6 only. No production reader/writer or probability/grade consumer. */
import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
import { NBA_TWO_WAY_SCHEMA_HASH } from "./nbaTwoWayRotation";

export const NBA_SCALED_PLAYER_IMPACT_RELEASE = "nba_scaled_player_impact_2026_11_26_r1_training_only_gaussian" as const;
export type NbaScaledImpactParameters = { weightVariance: number; noiseVariance: number; alpha: number;
  coefficients: number[]; rawCoefficients: number[]; intercept: number };
export type NbaScaledImpactHead = {
  release: typeof NBA_SCALED_PLAYER_IMPACT_RELEASE; trainingHash: string; trainingEnd: string;
  trainingRows: number; sourceSchemaHash: string; ledgerHash: string; trainingBaselineHash: string;
  rawFitSha256: string; featureScales: number[]; scaleRule: "training_rms_no_centering";
  margin: NbaScaledImpactParameters; total: NbaScaledImpactParameters; hash: string;
};
export type NbaScaledImpactInput = { features: number[]; snapshotHash: string; sourceSchemaHash: string; cutoff: string; season: number };
const sha = (s: string) => /^[a-f0-9]{64}$/.test(s);
export function scoreNbaScaledPlayerImpact(head: NbaScaledImpactHead, input: NbaScaledImpactInput) {
  const { hash, ...core } = head;
  if (hash !== nbaPlayerStateHash(core) || head.release !== NBA_SCALED_PLAYER_IMPACT_RELEASE ||
      head.sourceSchemaHash !== NBA_TWO_WAY_SCHEMA_HASH || input.sourceSchemaHash !== head.sourceSchemaHash ||
      ![head.trainingHash, head.ledgerHash, head.trainingBaselineHash, head.rawFitSha256, input.snapshotHash].every(sha) ||
      head.scaleRule !== "training_rms_no_centering" || !Number.isSafeInteger(head.trainingRows) ||
      head.trainingRows <= 10 || head.trainingRows > 10000 || !Number.isInteger(input.season) || input.season <= 2022 ||
      !Number.isFinite(Date.parse(input.cutoff)) || !Number.isFinite(Date.parse(head.trainingEnd)) ||
      Date.parse(head.trainingEnd) >= Date.parse(input.cutoff) || head.featureScales.length !== 6 ||
      !head.featureScales.every(v => Number.isFinite(v) && v > 0) || input.features.length !== 6 ||
      !input.features.every(Number.isFinite)) throw Error("incompatible_scaled_player_impact");
  const values = input.features.map((x, i) => x / head.featureScales[i]);
  function predict(p: NbaScaledImpactParameters) {
    if (![p.weightVariance, p.noiseVariance, p.alpha].every(v => Number.isFinite(v) && v > 0) || p.intercept !== 0 ||
        Math.abs(p.alpha - p.noiseVariance / p.weightVariance) > 1e-10 * Math.max(1, p.alpha) ||
        p.coefficients.length !== 6 || p.rawCoefficients.length !== 6 || !p.coefficients.every(Number.isFinite) ||
        !p.rawCoefficients.every(Number.isFinite) || p.coefficients.some((x, i) =>
          Math.abs(x / head.featureScales[i] - p.rawCoefficients[i]) > 1e-10 * Math.max(1, Math.abs(p.rawCoefficients[i])))) {
      throw Error("invalid_scaled_player_coefficients");
    }
    const result = values.reduce((sum, v, i) => sum + v * p.coefficients[i], 0);
    if (!Number.isFinite(result)) throw Error("invalid_scaled_player_correction");
    return result;
  }
  return { release: head.release, headHash: hash, snapshotHash: input.snapshotHash,
    marginCorrection: predict(head.margin), totalCorrection: predict(head.total) };
}
