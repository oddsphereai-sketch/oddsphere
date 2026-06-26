import {
  americanToDecimal,
  assignMarketAwareGrade,
  deVigTwoWayProbability,
  directionalSplitFeatures,
  expectedValuePerDollar,
  fitRidgeLogistic,
  normalizeProviderSplit,
  oppositeSideProbability,
  predictRidgeLogistic,
  timeToStartBucket,
} from "../lib/services/marketAwareEngine/core";
import {
  derivePlaybookTemporalFeatures,
  deriveSharpRetailPriceFeatures,
} from "../lib/services/marketAwareEngine/marketIntelligenceFeatures";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

function approx(a: number | null, b: number, tol = 1e-6): boolean {
  return a !== null && Math.abs(a - b) <= tol;
}

check("American +150 decimal", approx(americanToDecimal(150), 2.5));
check("American -120 decimal", approx(americanToDecimal(-120), 1 + 100 / 120));
check("Invalid American odds return null", americanToDecimal(0) === null);

const noVig = deVigTwoWayProbability(-110, -110);
check("Two-way de-vig -110/-110 is 50%", approx(noVig, 0.5));
check("Two-way de-vig needs both sides", deVigTwoWayProbability(-120, null) === null);

check("EV calculation uses decimal return", approx(expectedValuePerDollar(0.55, 100), 0.1));
check("Opposite side probability complements", approx(oppositeSideProbability(0.57), 0.43));

const split = directionalSplitFeatures({
  betsPctForCandidate: 0.58,
  moneyPctForCandidate: 0.64,
});
check("Directional bets lean is relative to candidate", approx(split.betsLean, 0.08));
check("Directional money-bets gap is not raw average", approx(split.moneyGap, 0.06));

check("Time bucket T-60", timeToStartBucket(44) === "t-060");
check("Time bucket unknown", timeToStartBucket(null) === "unknown");

const samples = [
  { provider: "playbook", sourceBook: "consensus", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: 0.01, moneyLean: 0.02, moneyGap: 0.01 },
  { provider: "playbook", sourceBook: "consensus", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: 0.03, moneyLean: 0.04, moneyGap: 0.01 },
  { provider: "playbook", sourceBook: "consensus", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: 0.05, moneyLean: 0.06, moneyGap: 0.01 },
  { provider: "sharpapi", sourceBook: "draftkings", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: -0.2, moneyLean: -0.1, moneyGap: 0.1 },
  { provider: "sharpapi", sourceBook: "draftkings", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: -0.1, moneyLean: -0.05, moneyGap: 0.05 },
  { provider: "sharpapi", sourceBook: "draftkings", league: "mlb", market: "moneyline" as const, timeBucket: "t-060", betsLean: 0, moneyLean: 0.01, moneyGap: 0.01 },
];
const playbookNorm = normalizeProviderSplit(samples, {
  provider: "playbook",
  sourceBook: "consensus",
  league: "mlb",
  market: "moneyline",
  timeBucket: "t-060",
  betsLean: 0.04,
  moneyLean: 0.05,
  moneyGap: 0.01,
});
const dkNorm = normalizeProviderSplit(samples, {
  provider: "sharpapi",
  sourceBook: "draftkings",
  league: "mlb",
  market: "moneyline",
  timeBucket: "t-060",
  betsLean: 0.04,
  moneyLean: 0.05,
  moneyGap: 0.01,
});
check("Provider-specific normalization keeps Playbook separate", playbookNorm.normalizationSampleSize === 3);
check("Provider-specific normalization keeps DraftKings separate", dkNorm.normalizationSampleSize === 3);
check("Provider-specific normalization yields different z scores", playbookNorm.betsLeanZ !== dkNorm.betsLeanZ);

const model = fitRidgeLogistic({
  rows: [{ x: -2 }, { x: -1 }, { x: 1 }, { x: 2 }],
  outcomes: [0, 0, 1, 1],
  featureNames: ["x"],
  lambda: 0.1,
  iterations: 800,
});
check("Ridge logistic learns monotone signal", predictRidgeLogistic(model, { x: 2 }) > predictRidgeLogistic(model, { x: -2 }));
check("Calibrated probability bounds", predictRidgeLogistic(model, { x: 100 }) < 1 && predictRidgeLogistic(model, { x: -100 }) > 0);

const playbookTemporal = derivePlaybookTemporalFeatures([
  {
    provider: "playbook",
    sourceBook: "consensus",
    league: "mlb",
    marketType: "moneyline",
    selectionKey: "1:moneyline:home",
    betsPct: 0.51,
    moneyPct: 0.54,
    marketLine: null,
    marketPrice: -105,
    booksUsed: 9,
    fetchedAt: "2026-06-25T10:00:00Z",
    sourceObservedAt: "2026-06-25T10:00:00Z",
    minutesToStart: 120,
  },
  {
    provider: "playbook",
    sourceBook: "consensus",
    league: "mlb",
    marketType: "moneyline",
    selectionKey: "1:moneyline:home",
    betsPct: 0.57,
    moneyPct: 0.64,
    marketLine: null,
    marketPrice: -120,
    booksUsed: 10,
    fetchedAt: "2026-06-25T11:00:00Z",
    sourceObservedAt: "2026-06-25T11:00:00Z",
    minutesToStart: 60,
  },
], "2026-06-25T11:00:00Z");
check("Playbook temporal current money is latest", approx(playbookTemporal.currentMoneyPct, 0.64));
check("Playbook temporal full-day money delta is directional", approx(playbookTemporal.moneyDeltaFullDay, 0.10));
check("Playbook temporal tracks booksUsed", playbookTemporal.booksUsed === 10);

const priceFeatures = deriveSharpRetailPriceFeatures([
  {
    sportsbook: "pinnacle",
    sharpBook: true,
    marketType: "moneyline",
    selectionKey: "1:moneyline:home",
    line: null,
    americanPrice: -105,
    noVigProbability: 0.51,
    providerTimestamp: "2026-06-25T10:00:00Z",
    fetchedAt: "2026-06-25T10:00:00Z",
  },
  {
    sportsbook: "pinnacle",
    sharpBook: true,
    marketType: "moneyline",
    selectionKey: "1:moneyline:home",
    line: null,
    americanPrice: -125,
    noVigProbability: 0.56,
    providerTimestamp: "2026-06-25T11:00:00Z",
    fetchedAt: "2026-06-25T11:00:00Z",
  },
  {
    sportsbook: "draftkings",
    sharpBook: false,
    marketType: "moneyline",
    selectionKey: "1:moneyline:home",
    line: null,
    americanPrice: -110,
    noVigProbability: 0.52,
    providerTimestamp: "2026-06-25T11:00:00Z",
    fetchedAt: "2026-06-25T11:00:00Z",
  },
], "2026-06-25T11:00:00Z");
check("Sharp-retail gap is named price action, not splits", approx(priceFeatures.sharpRetailProbabilityGap, 0.04));
check("Pinnacle is primary sharp reference when available", approx(priceFeatures.pinnacleNoVigProbability, 0.56));
check("Sharp first move is detected", priceFeatures.firstGroupToMove === "sharp");

const boundaries = {
  bestAngleMinConservativeEv: 0.04,
  bestAngleMinProbEvPositive: 0.8,
  leanMinExpectedEv: 0.005,
  leanMinProbEvPositive: 0.55,
  minFreshnessScore: 0.5,
  minCompletenessScore: 0.5,
};
check("Grade best angle from learned boundaries", assignMarketAwareGrade({
  expectedEv: 0.08,
  conservativeEv: 0.05,
  probabilityEvPositive: 0.86,
  freshnessScore: 1,
  completenessScore: 1,
  boundaries,
}) === "best_angle");
check("Grade no play when stale/invalid", assignMarketAwareGrade({
  expectedEv: 0.2,
  conservativeEv: 0.2,
  probabilityEvPositive: 1,
  freshnessScore: 0,
  completenessScore: 1,
  boundaries,
}) === "no_play");

console.log(`market-aware engine tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
