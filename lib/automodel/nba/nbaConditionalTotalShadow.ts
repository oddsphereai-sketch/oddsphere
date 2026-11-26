import type { NbaProfessionalMarketReader } from "../../services/nba/nbaProfessionalMarketReader";
import type { NbaPriceCoordinateLaw } from "../../services/nba/nbaPricedMarketMovement";
import { selectNbaNativeCoordinate } from "../../services/nba/nbaNativePriceCoordinate";

export const NBA_TOTAL_SHADOW_RELEASE = "nba_total_conditional_2026_11_20_r2_shadow_trees" as const;
type Tree = { value: number; n: number } | { feature: number; threshold: number; left: Tree; right: Tree; n: number };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const artifact = require("./modelArtifacts/nbaConditionalTotalShadowR2.json") as {
  release: string; status: string; parentSha256: string;
  head: { featureOrder: string[]; missingMedians: number[]; trees: Tree[]; learningRate: number;
    calibrationMedianBias: number; calibrationMeanBias: number; residuals: number[] };
};
const h = artifact.head;
function validTree(tree: Tree, depth = 0): boolean {
  return depth <= 2 && Number.isSafeInteger(tree.n) && tree.n >= 120 && ("value" in tree ? Number.isFinite(tree.value)
    : Number.isSafeInteger(tree.feature) && tree.feature >= 0 && tree.feature < h.featureOrder.length && Number.isFinite(tree.threshold)
      && validTree(tree.left, depth + 1) && validTree(tree.right, depth + 1));
}
if (artifact.release !== NBA_TOTAL_SHADOW_RELEASE || artifact.status !== "shadow_only_not_authorized_for_production" ||
    h.featureOrder.length !== h.missingMedians.length || h.missingMedians.some(v => !Number.isFinite(v)) ||
    h.trees.length !== 40 || h.trees.some(t => !validTree(t)) || h.learningRate !== .05 ||
    !Number.isFinite(h.calibrationMedianBias) || !Number.isFinite(h.calibrationMeanBias) || h.residuals.length !== 615 ||
    h.residuals.some((v, i) => !Number.isFinite(v) || i > 0 && v < h.residuals[i - 1]!) || h.residuals[307] !== 0) {
  throw new Error("Invalid NBA shadow Total artifact");
}
function score(tree: Tree, x: readonly number[]): number {
  return "value" in tree ? tree.value : score(x[tree.feature]! <= tree.threshold ? tree.left : tree.right, x);
}
/** Offline candidate only. No scheduled writer enables this path. */
export function predictNbaConditionalTotalShadow(args: {
  independentTotal: number; featureRow: Record<string, number | null | undefined>;
  reader: NbaProfessionalMarketReader; evaluatedAt: string; law: NbaPriceCoordinateLaw;
}) {
  const source = selectNbaNativeCoordinate({ reader: args.reader, market: "total", evaluatedAt: args.evaluatedAt, law: args.law });
  if (!source) return { status: "incumbent_fallback_missing_native_context" as const, release: NBA_TOTAL_SHADOW_RELEASE };
  const raw = [source.current, source.current - source.opening, args.independentTotal - source.current,
    ...h.featureOrder.slice(3).map(k => args.featureRow[k])];
  const features = raw.map((v, i) => typeof v === "number" && Number.isFinite(v) ? v : h.missingMedians[i]!);
  const point = source.current + h.learningRate * h.trees.reduce((sum, tree) => sum + score(tree, features), 0);
  const representativeTotal = point + h.calibrationMedianBias, expectedTotal = point + h.calibrationMeanBias;
  if (!Number.isFinite(representativeTotal) || representativeTotal <= 0 || !Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    throw new Error("NBA shadow Total numerical failure");
  }
  return { status: "shadow_applied" as const, release: NBA_TOTAL_SHADOW_RELEASE, parentSha256: artifact.parentSha256,
    representativeTotal, expectedTotal, source, features,
    residualLaw: { release: NBA_TOTAL_SHADOW_RELEASE, residuals: h.residuals },
    sigma: Math.sqrt(h.residuals.reduce((sum, v) => sum + v * v, 0) / h.residuals.length) };
}
