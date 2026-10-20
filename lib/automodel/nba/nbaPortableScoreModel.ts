/** Portable scorer for the chronologically selected NBA ridge artifact. */

export type NbaPortableModelArtifact = {
  release: string;
  featureRelease: string;
  architecture: "margin_total";
  model: { family: "ridge"; alpha: number };
  design: {
    features: string[];
    missingIndicatorColumns: string[];
    rawFeatureMedians: number[];
    designMeans: number[];
    designStandardDeviations: number[];
    designColumns: number;
    splineKnots: number[];
  };
  coefficients: {
    target_home_margin: number[];
    target_total: number[];
  };
  distribution?: {
    family: "normal_residual";
    marginSigma: number;
    totalSigma: number;
    calibratedOn: string;
    marginCalibration?: {
      release: string;
      family: "two_component_normal_mixture";
      coreSigmaMultiplier: number;
      tailWeight: number;
      tailSigmaMultiplier: number;
      selectedOn: string;
      confirmedOn: string;
    };
  };
};

export type NbaPortableFeatureRow = Record<string, number | null | undefined>;

export type NbaPortableScore = {
  homeScore: number;
  awayScore: number;
  marginHome: number;
  total: number;
};

function dotWithIntercept(values: readonly number[], coefficients: readonly number[]): number {
  if (coefficients.length !== values.length + 1) {
    throw new Error("NBA portable artifact coefficient count does not match its design.");
  }
  let output = coefficients[coefficients.length - 1]!;
  for (let index = 0; index < values.length; index++) output += values[index]! * coefficients[index]!;
  return output;
}

export function scoreNbaPortableModel(
  artifact: NbaPortableModelArtifact,
  row: NbaPortableFeatureRow,
): NbaPortableScore {
  if (artifact.architecture !== "margin_total" || artifact.model.family !== "ridge") {
    throw new Error("NBA portable scorer received an unsupported architecture or model family.");
  }
  if (artifact.design.splineKnots.length > 0) {
    throw new Error("NBA portable scorer does not accept spline state for the selected ridge release.");
  }
  const features = artifact.design.features;
  if (artifact.design.rawFeatureMedians.length !== features.length) {
    throw new Error("NBA portable artifact feature and median counts differ.");
  }
  const missingIndexes = artifact.design.missingIndicatorColumns.map((feature) => {
    const index = features.indexOf(feature);
    if (index < 0) throw new Error(`NBA portable artifact has an unknown missing indicator: ${feature}.`);
    return index;
  });
  const missing: boolean[] = [];
  const values = features.map((feature, index) => {
    const raw = row[feature];
    const isMissing = raw === null || raw === undefined || !Number.isFinite(raw);
    missing.push(isMissing);
    return isMissing ? artifact.design.rawFeatureMedians[index]! : raw!;
  });
  for (const index of missingIndexes) values.push(missing[index] ? 1 : 0);
  if (
    values.length !== artifact.design.designColumns ||
    artifact.design.designMeans.length !== values.length ||
    artifact.design.designStandardDeviations.length !== values.length
  ) {
    throw new Error("NBA portable artifact transformed design dimensions differ.");
  }
  const standardized = values.map((value, index) => {
    const deviation = artifact.design.designStandardDeviations[index]!;
    if (!Number.isFinite(deviation) || deviation <= 0) {
      throw new Error("NBA portable artifact contains an invalid design deviation.");
    }
    return (value - artifact.design.designMeans[index]!) / deviation;
  });
  const marginHome = dotWithIntercept(standardized, artifact.coefficients.target_home_margin);
  const total = dotWithIntercept(standardized, artifact.coefficients.target_total);
  return {
    homeScore: (total + marginHome) / 2,
    awayScore: (total - marginHome) / 2,
    marginHome,
    total,
  };
}
