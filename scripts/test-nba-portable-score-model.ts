import assert from "node:assert/strict";

import {
  scoreNbaPortableModel,
  type NbaPortableModelArtifact,
} from "../lib/automodel/nba/nbaPortableScoreModel";

const artifact: NbaPortableModelArtifact = {
  release: "fixture",
  featureRelease: "fixture_features",
  architecture: "margin_total",
  model: { family: "ridge", alpha: 1000 },
  design: {
    features: ["rating", "rest"],
    missingIndicatorColumns: ["rest"],
    rawFeatureMedians: [110, 2],
    designMeans: [100, 1, 0.25],
    designStandardDeviations: [10, 2, 0.5],
    designColumns: 3,
    splineKnots: [],
  },
  coefficients: {
    target_home_margin: [2, 4, 6, 1],
    target_total: [10, -2, 8, 220],
  },
};

assert.deepEqual(scoreNbaPortableModel(artifact, { rating: 120, rest: 3 }), {
  homeScore: 120,
  awayScore: 114,
  marginHome: 6,
  total: 234,
});

assert.deepEqual(scoreNbaPortableModel(artifact, { rating: 110, rest: null }), {
  homeScore: 127.5,
  awayScore: 113.5,
  marginHome: 14,
  total: 241,
});

assert.throws(() => scoreNbaPortableModel({
  ...artifact,
  design: { ...artifact.design, designColumns: 99 },
}, { rating: 110, rest: 2 }));

console.log("NBA portable score-model tests passed");
