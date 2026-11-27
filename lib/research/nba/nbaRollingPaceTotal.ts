/** Offline annual-fit comparison. Never imported by a production writer. */
import { scoreNbaPortableModel, type NbaPortableModelArtifact, type NbaPortableFeatureRow } from "../../automodel/nba/nbaPortableScoreModel";
import { NBA_REGULATION_PACE_FEATURE_RELEASE } from "../../services/nba/nbaPointInTimeFeatures";
import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
export const NBA_ROLLING_PACE_TOTAL_RELEASE = "nba_rolling_regulation_pace_total_2026_11_27_r1_prior_seasons" as const;
type Design = NbaPortableModelArtifact["design"];
export type NbaRollingPaceModel = { origin: number; trainingRows: number; trainingEnd: string; firstEvaluation: string;
  trainingIdsHash: string; firstOriginFrozenMaxDifference: number | null;
  legacy: { design: Design; margin: number[]; total: number[] }; candidateTotal: { design: Design; total: number[] } };
export type NbaRollingPaceHead = { release: typeof NBA_ROLLING_PACE_TOTAL_RELEASE;
  featureRelease: typeof NBA_REGULATION_PACE_FEATURE_RELEASE; alpha: number; models: NbaRollingPaceModel[]; rawFitSha256: string; hash: string };
export function validateNbaRollingPaceHead(head: NbaRollingPaceHead) {
  const { hash, ...core } = head;
  if (hash !== nbaPlayerStateHash(core) || head.release !== NBA_ROLLING_PACE_TOTAL_RELEASE || head.featureRelease !== NBA_REGULATION_PACE_FEATURE_RELEASE ||
      head.alpha !== 1000 || !/^[a-f0-9]{64}$/.test(head.rawFitSha256) || head.models.map(m => m.origin).join() !== "2023,2024,2025") throw Error("rolling_head_contract");
  for (const m of head.models) {
    if (!Number.isSafeInteger(m.trainingRows) || m.trainingRows < 1000 || m.trainingRows > 10000 || !/^[a-f0-9]{64}$/.test(m.trainingIdsHash) ||
        !Number.isFinite(Date.parse(m.trainingEnd)) || !Number.isFinite(Date.parse(m.firstEvaluation)) || Date.parse(m.trainingEnd) >= Date.parse(m.firstEvaluation) ||
        (m.origin === 2023 && (m.firstOriginFrozenMaxDifference === null || !Number.isFinite(m.firstOriginFrozenMaxDifference) || m.firstOriginFrozenMaxDifference > 1e-9))) throw Error("rolling_training_contract");
    for (const [index, view] of [m.legacy, m.candidateTotal].entries()) {
      const d = view.design;
      if (d.features.length !== 75 || new Set(d.features).size !== 75 || d.features.filter(n => n.includes("pace48")).length !== (index ? 13 : 0) ||
          d.designColumns < 75 || d.designColumns > 150 || d.splineKnots.length ||
          d.rawFeatureMedians.length !== 75 || !d.rawFeatureMedians.every(Number.isFinite) ||
          d.designMeans.length !== d.designColumns || !d.designMeans.every(Number.isFinite) ||
          d.designStandardDeviations.length !== d.designColumns || !d.designStandardDeviations.every(n => Number.isFinite(n) && n > 0) ||
          d.missingIndicatorColumns.some(n => !d.features.includes(n)) || new Set(d.missingIndicatorColumns).size !== d.missingIndicatorColumns.length ||
          d.designColumns !== 75 + d.missingIndicatorColumns.length || view.total.length !== d.designColumns + 1 || !view.total.every(Number.isFinite)) throw Error("rolling_design_contract");
    }
    if (m.legacy.margin.length !== m.legacy.design.designColumns + 1 || !m.legacy.margin.every(Number.isFinite)) throw Error("rolling_margin_contract");
  }
}
export function scoreNbaRollingPaceTotal(head: NbaRollingPaceHead, season: number, cutoff: string, features: NbaPortableFeatureRow, durationAwareFeatures: NbaPortableFeatureRow) {
  validateNbaRollingPaceHead(head);
  const m = head.models.find(m => m.origin === season);
  if (!m || !Number.isFinite(Date.parse(cutoff)) || Date.parse(m.trainingEnd) >= Date.parse(cutoff) || Date.parse(cutoff) < Date.parse(m.firstEvaluation)) throw Error("rolling_target_scope");
  const artifact = (design: Design, margin: number[], total: number[]): NbaPortableModelArtifact => ({ release: head.release, featureRelease: head.featureRelease,
    architecture: "margin_total", model: { family: "ridge", alpha: 1000 }, design, coefficients: { target_home_margin: margin, target_total: total } });
  const baseline = scoreNbaPortableModel(artifact(m.legacy.design, m.legacy.margin, m.legacy.total), features);
  const candidate = scoreNbaPortableModel(artifact(m.candidateTotal.design, Array(m.candidateTotal.design.designColumns + 1).fill(0), m.candidateTotal.total), durationAwareFeatures);
  if (![baseline.marginHome, baseline.total, candidate.total].every(Number.isFinite) || baseline.total <= 0 || candidate.total <= 0) throw Error("rolling_forecast_invalid");
  return { baselineMargin: baseline.marginHome, candidateMargin: baseline.marginHome, baselineTotal: baseline.total, candidateTotal: candidate.total };
}
