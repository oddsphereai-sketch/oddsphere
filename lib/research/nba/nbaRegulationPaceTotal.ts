/** Pure offline Total head. Margin and the production writer remain untouched. */
import type { NbaPortableModelArtifact, NbaPortableFeatureRow } from "../../automodel/nba/nbaPortableScoreModel";
import { scoreNbaPortableModel } from "../../automodel/nba/nbaPortableScoreModel";
import { NBA_REGULATION_PACE_FEATURE_RELEASE } from "../../services/nba/nbaPointInTimeFeatures";
import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
export const NBA_REGULATION_PACE_TOTAL_RELEASE = "nba_regulation_pace_total_2026_11_27_r1_original_duration" as const;
export type NbaRegulationPaceTotalHead = { release: typeof NBA_REGULATION_PACE_TOTAL_RELEASE;
  featureRelease: typeof NBA_REGULATION_PACE_FEATURE_RELEASE; trainingHash: string; trainingRows: number; trainingEnd: string;
  baselineHash: string; durationSourceHash: string; rawFitSha256: string; alpha: number;
  design: NbaPortableModelArtifact["design"]; totalCoefficients: number[]; hash: string };
export function scoreNbaRegulationPaceTotal(head: NbaRegulationPaceTotalHead, features: NbaPortableFeatureRow, cutoff: string) {
  const { hash, ...core } = head, d = head.design;
  if (hash !== nbaPlayerStateHash(core) || head.release !== NBA_REGULATION_PACE_TOTAL_RELEASE ||
      head.featureRelease !== NBA_REGULATION_PACE_FEATURE_RELEASE || head.alpha !== 1000 ||
      ![head.trainingHash, head.baselineHash, head.durationSourceHash, head.rawFitSha256].every(s => /^[a-f0-9]{64}$/.test(s)) ||
      !Number.isSafeInteger(head.trainingRows) || head.trainingRows < 10 || head.trainingRows > 10000 ||
      !Number.isFinite(Date.parse(cutoff)) || !Number.isFinite(Date.parse(head.trainingEnd)) || Date.parse(head.trainingEnd) >= Date.parse(cutoff) ||
      d.features.length !== 75 || new Set(d.features).size !== 75 || d.features.filter(n => n.includes("pace48")).length !== 13 ||
      d.designColumns < 75 || d.designColumns > 150 || d.splineKnots.length !== 0 ||
      d.rawFeatureMedians.length !== 75 || !d.rawFeatureMedians.every(Number.isFinite) ||
      d.designMeans.length !== d.designColumns || d.designStandardDeviations.length !== d.designColumns ||
      !d.designMeans.every(Number.isFinite) || !d.designStandardDeviations.every(n => Number.isFinite(n) && n > 0) ||
      head.totalCoefficients.length !== d.designColumns + 1 || !head.totalCoefficients.every(Number.isFinite)) throw Error("invalid_duration_total_head");
  const artifact: NbaPortableModelArtifact = { release: head.release, featureRelease: head.featureRelease, architecture: "margin_total",
    model: { family: "ridge", alpha: 1000 }, design: d,
    coefficients: { target_home_margin: Array(d.designColumns + 1).fill(0), target_total: head.totalCoefficients } };
  const total = scoreNbaPortableModel(artifact, features).total;
  if (!Number.isFinite(total) || total <= 0) throw Error("invalid_duration_total_forecast");
  return { release: head.release, headHash: hash, total };
}
