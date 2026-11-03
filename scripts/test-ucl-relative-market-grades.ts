import assert from "node:assert/strict";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade, uclExactPriceExpectedValue } from "@/lib/services/ucl/uclTransferredGrade";
import type { UclRelativeMarketAxisReceipt } from "@/lib/services/ucl/uclRelativeMarketRead";

type Market = "match_result" | "total" | "btts";
type Side = "home" | "draw" | "away" | "over" | "under" | "yes" | "no";
function receipt(market: Market, pick: Side, changes: Partial<UclRelativeMarketAxisReceipt> = {}): UclRelativeMarketAxisReceipt {
  const sides = market === "match_result" ? ["home", "draw", "away"] : market === "total" ? ["over", "under"] : ["yes", "no"];
  const current = Object.fromEntries(sides.map(side => [side, side === pick ? 0.605 : (1 - 0.605) / (sides.length - 1)]));
  const baseline = Object.fromEntries(sides.map(side => [side, side === pick ? 0.55 : 0.45 / (sides.length - 1)]));
  return {
    market, status: "applied", pickedSide: pick, direction: pick, latestLegDirection: pick,
    latestInformativeDirection: pick, latestInformativeSupportsPick: true,
    latestLegFullyObserved: true,
    currentSupportsPick: true, latestLegSupportsPick: true, currentTargetProbabilities: current,
    currentTargetProbabilityBasis: market === "total" ? "poisson_native_total_inference" : "direct_paired_market",
    retraced: false, roundTrip: false, conflicted: false, opposingCandidates: false,
    selected: { market, book: "pinnacle", provider: "owls", providerEventId: "native-match-id", sourceClass: "named_originator",
      independentOfExecutionBook: false, baseline: { line: market === "total" ? 2.5 : null,
        observedAt: "2026-11-03T14:00:00.000Z", probabilities: baseline },
      current: { line: market === "total" ? 2.5 : null,
        observedAt: "2026-11-03T15:00:00.000Z", probabilities: current }, factor: market === "match_result" ? current : 1.2 },
    reason: "observed_relative_same_book_movement", ...changes,
  } as unknown as UclRelativeMarketAxisReceipt;
}
function grade(market: Market, side: Side, options: { p?: number; fair?: number; price?: number | null; read?: UclRelativeMarketAxisReceipt | null } = {}) {
  const p = options.p ?? 0.60, price = options.price === undefined ? -160 : options.price;
  const fair = options.fair ?? 0.605;
  const read = options.read === undefined ? receipt(market, side) : options.read ?? undefined;
  if (market !== "match_result") return deriveUclPreviewGrade({ market, edgePp: (p - fair) * 100, modelProbability: p,
    priceAmerican: price, coherentMarket: price !== null, promotedProxy: false, forecastSide: side, marketRead: read });
  const model = Object.fromEntries(["home", "draw", "away"].map(key => [key, key === side ? p : (1 - p) / 2])) as Record<"home" | "draw" | "away", number>;
  const marketVector = Object.fromEntries(["home", "draw", "away"].map(key => [key, key === side ? fair : (1 - fair) / 2])) as typeof model;
  const prices = Object.fromEntries(["home", "draw", "away"].map(key => [key, key === side ? price : 400])) as typeof model;
  return deriveUclMatchResultDecision({ model, market: marketVector, prices: price === null ? null : prices, promotedProxy: false,
    forecastSide: side as "home" | "draw" | "away", marketRead: read,
    marketReader: { consensusLeader: side as "home" | "draw" | "away", evaluatedLeader: side as "home" | "draw" | "away" } }).grade;
}
for (const [market, side] of [["total", "over"], ["total", "under"], ["btts", "yes"], ["btts", "no"],
  ["match_result", "home"], ["match_result", "away"], ["match_result", "draw"]] as const) {
  const evidence = receipt(market, side), original = JSON.stringify(evidence);
  const confirmed = grade(market, side, { read: evidence });
  assert.equal(confirmed.verdict.key, "lean", `${market}/${side}:60% forecast below60.5% book fair can qualify on actual movement`);
  assert.equal(confirmed.grade, "market_led", "observed execution-book movement is not labeled independent value");
  assert.ok(uclExactPriceExpectedValue(0.60, -160) < 0);
  assert.ok(Math.abs(uclExactPriceExpectedValue(0.60, -160) + 0.025) < 1e-12, "exact vig EV remains−2.5%, not rewritten to positive");
  assert.equal(grade(market, side, { read: null }).verdict.key === "lean", false, "static agreement alone cannot invent movement confirmation");
  assert.equal(JSON.stringify(evidence), original, "grading cannot alter source evidence or model probability");
  assert.deepEqual(grade(market, side, { read: evidence }), confirmed, "same evidence gives stable grade without ratcheting");
  assert.equal(grade(market, side, { p: 0.65, price: -150 }).verdict.key, "best_angle", "all three market types can earn a clean, affordable, positive-EV Best");
  assert.equal(grade(market, side, { p: 0.80, price: -300 }).verdict.key, "lean", "−300 can be Lean but never Best");
  for (const price of [-351, -1000]) assert.ok(!["lean", "best_angle"].includes(grade(market, side, { p: 0.99, price }).verdict.key), "steep quote does not qualify just from high win confidence");
  assert.equal(grade(market, side, { price: null }).verdict.key, "no_play", "missing execution price remains a genuine data hold");
  assert.ok(!["lean", "best_angle"].includes(grade(market, side, { p: market === "match_result" ? 0.60 : 0.55,
    fair: 0.76, price: -350 }).verdict.key), "aligned movement cannot excuse a huge model/price gap outside the actual paired-book vig envelope");
  const retail = receipt(market, side); retail.selected!.sourceClass = "named_retail";
  assert.equal(grade(market, side, { p: 0.65, price: -150, read: retail }).verdict.key, "lean", "retail confirmation does not become originator Best");
  for (const change of [
    { status: "unchanged" }, { status: "context_only" }, { status: "unavailable" }, { status: "conflict" },
    { selected: null }, { roundTrip: true }, { conflicted: true }, { opposingCandidates: true },
    { latestLegFullyObserved: false },
    { currentSupportsPick: false }, { latestInformativeSupportsPick: false },
    { direction: "flat" }, { direction: "mixed" }, { latestInformativeDirection: "unknown" },
    { retraced: true, latestInformativeSupportsPick: false }, { currentTargetProbabilities: null },
    { currentTargetProbabilityBasis: "unavailable" },
  ] as unknown as Partial<UclRelativeMarketAxisReceipt>[]) {
    assert.ok(!["lean", "best_angle"].includes(grade(market, side, { read: receipt(market, side, change) }).verdict.key),
      `${market}/${side}: missing/neutral/opposed/ambiguous path cannot fake confirmation (${JSON.stringify(change)})`);
  }
  const held = receipt(market, side, { latestLegDirection: "flat", latestLegSupportsPick: false });
  assert.equal(grade(market, side, { read: held }).verdict.key, "lean", "unchanged poll after an actual supporting move does not erase its economic evidence");
  const resumed = receipt(market, side, { retraced: true });
  assert.equal(grade(market, side, { read: resumed }).verdict.key, "lean", "a resolved historical retrace can confirm Lean on a resumed economic leg");
  assert.equal(grade(market, side, { p: 0.65, price: -150, read: resumed }).verdict.key, "lean", "retraced path is not clean Best confirmation");
  const incompleteLeg = receipt(market, side, { latestLegFullyObserved: false });
  assert.equal(grade(market, side, { p: 0.65, price: -150, read: incompleteLeg }).verdict.key, "lean",
    "an incomplete intervening capture blocks clean movement Best while retaining the independent positive-EV Lean lane");
  const wrongPick = receipt(market, side, { pickedSide: "unrelated-side" });
  assert.notEqual(grade(market, side, { read: wrongPick }).verdict.key, "lean", "receipt must bind the actual forecast side");
}

for (const market of ["total", "btts"] as const) {
  const side = market === "total" ? "over" : "yes";
  assert.equal(grade(market, side, { p: 0.55, price: -110, read: null }).verdict.key, "lean", "legacy positive-EV55% lane retained without movement");
  assert.notEqual(grade(market, side, { p: 0.5499, price: -160 }).verdict.key, "lean", "movement cannot waive existing confidence floor");
  const implied = 160 / 260, lowerVigBound = implied - (implied / 0.605 - 1);
  assert.equal(grade(market, side, { p: lowerVigBound + 1e-8, fair: 0.605 }).verdict.key, "lean", "actual paired vig envelope admits its compatible forecast");
  assert.equal(grade(market, side, { p: lowerVigBound - 1e-8, fair: 0.605 }).verdict.key, "watchlist", "outside actual paired vig envelope does not qualify from movement alone");
  assert.equal(grade(market, side, { p: 0.5999, fair: 0.51, price: -110 }).verdict.key, "lean", "Best retains its60% strong-confidence floor");
}
assert.equal(grade("match_result", "home", { p: 0.65, price: -150, read: null }).verdict.key, "lean", "existing market-aligned, positive-EV MR lane retained");
assert.notEqual(grade("match_result", "home", { p: 0.5999 }).verdict.key, "lean", "MR confirmation retains60% confidence floor");
assert.equal(grade("match_result", "home", { p: 0.43, price: 150 }).verdict.key, "watchlist", "three-way plurality remains honest Watchlist");
const nativeTotal = receipt("total", "over");
nativeTotal.selected!.current.probabilities = { over: 0.40, under: 0.60 };
nativeTotal.selected!.current.line = 3.5;
assert.equal(grade("total", "over", { read: nativeTotal }).verdict.key, "lean", "Under3.5 native leader must not be mistaken for Under2.5; translated current target supportsOver2.5");
const opposedTarget = receipt("total", "over", { currentTargetProbabilities: { over: 0.49, under: 0.51 } });
assert.equal(grade("total", "over", { read: opposedTarget }).verdict.key, "lean", "a moving-toward-Over source need not already makeOver its favorite");

const dogMarket = { home: 0.45, draw: 0.15, away: 0.40 };
const dogReceipt = receipt("match_result", "away", { currentTargetProbabilities: dogMarket });
dogReceipt.selected!.current.probabilities = dogMarket;
dogReceipt.selected!.baseline!.probabilities = { home: 0.50, draw: 0.20, away: 0.30 };
const dogDecision = (read: UclRelativeMarketAxisReceipt | undefined) => deriveUclMatchResultDecision({
  model: { home: 0.20, draw: 0.15, away: 0.65 }, market: dogMarket, prices: { home: 110, draw: 400, away: 140 },
  promotedProxy: false, forecastSide: "away", marketRead: read,
  marketReader: { consensusLeader: "home", evaluatedLeader: "home" },
});
assert.equal(dogDecision(dogReceipt).grade.verdict.key, "best_angle", "genuine originator strengthening can confirm model's Away winner while marketAway remains40% vsHome45%");
for (const read of [undefined, { ...dogReceipt, status: "unchanged" as const },
  { ...dogReceipt, currentSupportsPick: false, direction: "home" as const, latestInformativeSupportsPick: false }]) {
  assert.ok(!["lean", "best_angle"].includes(dogDecision(read).grade.verdict.key), "flat/missing/Away-weakening source cannot manufacture underdog confirmation");
}
for (const [market, side, opposite] of [["total", "over", "under"], ["total", "under", "over"],
  ["btts", "yes", "no"], ["btts", "no", "yes"]] as const) {
  const valueDog = receipt(market, side, { currentTargetProbabilities: { [side]: 0.40, [opposite]: 0.60 } });
  valueDog.selected!.current.probabilities = { [side]: 0.40, [opposite]: 0.60 };
  valueDog.selected!.baseline!.probabilities = { [side]: 0.30, [opposite]: 0.70 };
  assert.equal(grade(market, side, { p: 0.65, fair: 0.40, price: 140, read: valueDog }).verdict.key, "best_angle",
    "binary originator-confirmed value underdog is symmetric; current market majority is context, not a mandatory favorite gate");
  for (const changed of [{ ...valueDog, status: "unchanged" as const },
    { ...valueDog, currentSupportsPick: false, latestInformativeSupportsPick: false }]) {
    const result = grade(market, side, { p: 0.65, fair: 0.40, price: 140, read: changed });
    assert.equal(result.verdict.key, "lean", "independent positive-EV binary Lean is retained");
    assert.equal(result.grade, "model_only", "neutral/opposing source cannot be labeled movement confirmation or Best");
  }
}
console.log("PASS UCL symmetric relative-market grades: confirmed near-zero/negative-vig Lean, clean originator/positive-EV Best, steep-price and source/path guards, native Total contract translation, legacy value lanes and honest exact EV.");
