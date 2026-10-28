import type { CbbScoreFeatureRow } from "./scoreResearch";
import { normalCdf } from "./model";

type Node = { value: number } | { feature: number; threshold: number; left: Node; right: Node };
export type CbbScoreTreeOptions = { depth: number; rounds: number; learningRate: number; minLeaf: number; bins: number };
export type CbbScoreTreeHead = { intercept: number; trees: Node[]; learningRate: number };
export type CbbScoreTrees = { fitThroughSeason: number; options: CbbScoreTreeOptions; margin: CbbScoreTreeHead; total: CbbScoreTreeHead };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
const predictNode = (node: Node, x: number[]): number => "value" in node ? node.value : predictNode(x[node.feature] <= node.threshold ? node.left : node.right, x);

function trainHead(x: number[][], y: number[], options: CbbScoreTreeOptions): CbbScoreTreeHead {
  const intercept = median(y), predictions = y.map(() => intercept), trees: Node[] = [];
  const cuts = x[0].map((_, feature) => {
    const sorted = x.map(row => row[feature]).sort((a, b) => a - b);
    return [...new Set(Array.from({ length: options.bins - 1 }, (_, i) => sorted[Math.floor(sorted.length * (i + 1) / options.bins)]))];
  });
  const bins = x.map(row => cuts.map((thresholds, j) => { let i = 0; while (i < thresholds.length && row[j] > thresholds[i]) i++; return i; }));
  const all = x.map((_, i) => i);
  for (let round = 0; round < options.rounds; round++) {
    const residuals = y.map((value, i) => value - predictions[i]);
    const gradients = residuals.map(Math.sign);
    const grow = (indexes: number[], depth: number): Node => {
      const leaf = () => ({ value: median(indexes.map(i => residuals[i])) });
      if (depth === 0 || indexes.length < 2 * options.minLeaf) return leaf();
      const total = indexes.reduce((sum, i) => sum + gradients[i], 0);
      let bestGain = 0, bestFeature = -1, bestCut = -1;
      for (let feature = 1; feature < cuts.length; feature++) {
        const counts = Array(cuts[feature].length + 1).fill(0) as number[];
        const sums = Array(counts.length).fill(0) as number[];
        for (const i of indexes) { counts[bins[i][feature]]++; sums[bins[i][feature]] += gradients[i]; }
        let leftCount = 0, leftSum = 0;
        for (let cut = 0; cut < cuts[feature].length; cut++) {
          leftCount += counts[cut]; leftSum += sums[cut];
          const rightCount = indexes.length - leftCount;
          if (leftCount < options.minLeaf || rightCount < options.minLeaf) continue;
          const gain = leftSum ** 2 / leftCount + (total - leftSum) ** 2 / rightCount - total ** 2 / indexes.length;
          if (gain > bestGain + 1e-12) { bestGain = gain; bestFeature = feature; bestCut = cut; }
        }
      }
      if (bestFeature < 0) return leaf();
      const left = indexes.filter(i => bins[i][bestFeature] <= bestCut), right = indexes.filter(i => bins[i][bestFeature] > bestCut);
      return { feature: bestFeature, threshold: cuts[bestFeature][bestCut], left: grow(left, depth - 1), right: grow(right, depth - 1) };
    };
    const tree = grow(all, options.depth); trees.push(tree);
    for (let i = 0; i < predictions.length; i++) predictions[i] += options.learningRate * predictNode(tree, x[i]);
  }
  return { intercept, learningRate: options.learningRate, trees };
}

export function trainCbbScoreTrees(rows: CbbScoreFeatureRow[], throughSeason: number, options: CbbScoreTreeOptions): CbbScoreTrees {
  if (rows.length < 200 || rows.some(row => row.game.season > throughSeason)) throw new Error("invalid CBB tree training cohort");
  const x = rows.map(row => row.features);
  return { fitThroughSeason: throughSeason, options,
    margin: trainHead(x, rows.map(row => row.game.homeScore - row.game.awayScore - row.forecast.margin), options),
    total: trainHead(x, rows.map(row => row.game.homeScore + row.game.awayScore - row.forecast.total), options) };
}

export function applyCbbScoreTrees(rows: CbbScoreFeatureRow[], model: CbbScoreTrees): CbbScoreFeatureRow[] {
  const predict = (head: CbbScoreTreeHead, x: number[]) => head.intercept + head.learningRate * head.trees.reduce((sum, tree) => sum + predictNode(tree, x), 0);
  return rows.map(row => {
    if (row.game.season <= model.fitThroughSeason) throw new Error("in-sample CBB tree evaluation");
    const margin = row.forecast.margin + predict(model.margin, row.features), total = row.forecast.total + predict(model.total, row.features);
    const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2;
    if (homeScore <= 0 || awayScore <= 0) throw new Error("invalid CBB tree score");
    const sd = row.forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
    const homeWinProbability = (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero);
    return { ...row, forecast: { ...row.forecast, margin, total, homeScore, awayScore, homeWinProbability } };
  });
}
