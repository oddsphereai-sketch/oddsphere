import assert from "node:assert/strict";
import { reconcileNbaMarketConsequence, isNbaMarketKnowledgeState, NBA_PREVIOUS_MARKET_CONSEQUENCE_RELEASE } from "../lib/services/nba/nbaMarketConsequence";
import { resolveNbaConsequencePosture } from "../lib/services/nba/nbaNamedBookPosture";
import { gradeNbaMarket } from "../lib/services/nba/nbaMarketReview";
import type { NbaReaderPriceRow, NbaReaderSplitRow } from "../lib/services/nba/nbaProfessionalMarketReader";
import { loadNbaMarketKnowledgeStates } from "../lib/services/nba/nbaMarketKnowledgeStore";
import { NBA_MODEL_RELEASE, NBA_PREVIOUS_MODEL_RELEASE } from "../lib/automodel/nba/nbaChampionRuntime";
import type { SupabaseClient } from "@supabase/supabase-js";

const firstAt = "2026-11-04T10:00:00Z", flowAt = "2026-11-04T10:30:00Z", lastAt = "2026-11-04T11:00:00Z";
type Market = "moneyline" | "spread" | "total";
const pricePair = (market: Market, at: string): NbaReaderPriceRow[] => (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => ({
  provider: "owls", sportsbook: "circa", sharpBook: true, providerEventId: "42", ingestionRunId: `quote:${at}`,
  market, selectionKey: `42:${market}:${side}`, line: market === "moneyline" ? null : market === "total" ? 220 : i === 0 ? -5.5 : 5.5,
  americanPrice: i === 0 ? -150 : 130, providerTimestamp: at, fetchedAt: at,
}));
function read(market: Market, sourceBook: string, sourceType: string, firstMoney: number) {
  const rows = [...pricePair(market, firstAt), ...pricePair(market, lastAt)];
  const splitRows: NbaReaderSplitRow[] = (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => ({
    provider: sourceBook === "consensus" ? "playbook" : "owls", sourceBook, sourceType, market,
    selectionKey: `42:${market}:${side}`, marketLine: market === "moneyline" ? null : market === "total" ? 220 : i === 0 ? -5.5 : 5.5,
    betsPct: i === 0 ? .5 : .5, moneyPct: i === 0 ? firstMoney : 1 - firstMoney, sourceObservedAt: flowAt, fetchedAt: flowAt,
  }));
  return reconcileNbaMarketConsequence({ independentMargin: 10, independentTotal: 240, law: { marginSigma: 12, totalSigma: 18 },
    spreadHome: -5.5, totalLine: 220, context: { eventId: "42", inputFingerprint: "unchanged-independent", evaluatedAt: lastAt,
      priceRows: rows, splitRows, pricesTrusted: true, splitsTrusted: true } });
}
for (const market of ["moneyline", "spread", "total"] as const) {
  const pickedSide = market === "total" ? "over" : "home";
  const base = { market, pick: pickedSide, confidence: 75, modelProbabilityOnPick: .75,
    currentPriceAmerican: -150, band: "support" as const, edge: .12, dataQualityTier: "high" as const, injuriesKnown: true };
  const publicRead = read(market, "consensus", "multi_book_consensus", .8);
  assert.ok(publicRead.pressure.length > 0, "public flow remains available as context");
  assert.ok(publicRead.pressure.every(p => p.reaction === "unmatched_quote_context" && p.reactionBook === null),
    "aggregate money cannot identify a causal reaction at Circa");
  const publicPosture = resolveNbaConsequencePosture({ consequence: publicRead, market, pickedSide });
  assert.equal(publicPosture.convictionRiskSources!.length, 0);
  assert.equal(gradeNbaMarket({ ...base, namedBookPosture: publicPosture }).grade, "best_angle");
  const ownRead = read(market, "circa", "sharp_adjacent_book", .8);
  assert.ok(ownRead.pressure.some(p => p.reaction === "held" && p.reactionBook === "circa"));
  const ownPosture = resolveNbaConsequencePosture({ consequence: ownRead, market, pickedSide });
  assert.equal(gradeNbaMarket({ ...base, namedBookPosture: ownPosture }).grade, "lean",
    "genuine same-book pressure met by a held quote still tempers Best");
  const opposite = resolveNbaConsequencePosture({ consequence: read(market, "circa", "sharp_adjacent_book", .2), market, pickedSide });
  assert.ok(opposite.heldResistanceSupportingSources!.includes("circa"));
  assert.equal(gradeNbaMarket({ ...base, namedBookPosture: opposite }).grade, "best_angle");
  const mislabeled = read(market, "circa", "multi_book_consensus", .8);
  assert.ok(mislabeled.pressure.every(p => p.reactionBook === null), "a professional-looking book name cannot upgrade aggregate provenance");
  assert.equal(publicRead.margin, ownRead.margin); assert.equal(publicRead.total, ownRead.total);
  assert.equal(publicRead.marginScale, ownRead.marginScale, "grade repair cannot invent a new score law");
  const oldState = { ...publicRead.state, release: NBA_PREVIOUS_MARKET_CONSEQUENCE_RELEASE };
  assert.ok(isNbaMarketKnowledgeState(oldState), "exact prior knowledge state remains eligible without resetting anchors");
  assert.ok(!isNbaMarketKnowledgeState({ ...oldState, release: "unrecognized_release" }));
  const continued = reconcileNbaMarketConsequence({ independentMargin: 10, independentTotal: 240, law: { marginSigma: 12, totalSigma: 18 },
    spreadHome: -5.5, totalLine: 220, context: { eventId: "42", inputFingerprint: "unchanged-independent", evaluatedAt: lastAt,
      priceRows: [], splitRows: [], previousState: oldState, pricesTrusted: true, splitsTrusted: true } });
  assert.equal(continued.state.knowledgeAt, oldState.knowledgeAt);
  assert.deepEqual(continued.state.anchors, oldState.anchors, "prior anchors retain original provenance and clocks");
}
async function checkPersistedReleaseHandoff() {
  const prior = { ...read("moneyline", "consensus", "multi_book_consensus", .8).state,
    release: NBA_PREVIOUS_MARKET_CONSEQUENCE_RELEASE };
  const releases: string[] = [];
  const client = { from: () => {
    let model: string;
    const query = { select: () => query, eq: (field: string, value: string) => {
      if (field === "model_version") model = value;
      return query;
    }, in: () => query, is: () => query, limit: async () => {
      releases.push(model);
      return { data: model === NBA_PREVIOUS_MODEL_RELEASE ? [{ game_id: 7, market: "moneyline", knowledge: prior }] : [], error: null };
    } };
    return query;
  } } as unknown as SupabaseClient;
  const result = await loadNbaMarketKnowledgeStates({ client, slateDate: "2026-11-04", modelRelease: NBA_MODEL_RELEASE,
    externalIdByDbId: new Map([[7, 42]]) });
  assert.deepEqual(releases, [NBA_MODEL_RELEASE, NBA_PREVIOUS_MODEL_RELEASE]);
  assert.deepEqual(result.get(42), prior, "first publication reads the actual preceding release's unchanged source knowledge");
  releases.length = 0;
  await loadNbaMarketKnowledgeStates({ client, slateDate: "2026-11-04", modelRelease: "unknown_future_model",
    externalIdByDbId: new Map([[7, 42]]) });
  assert.deepEqual(releases, ["unknown_future_model"], "no arbitrary model release may inherit this predecessor");
}
void checkPersistedReleaseHandoff().then(() => console.log("NBA own-book pressure: aggregate context, genuine resistance, paired grades and persisted prior-release handoff passed"))
  .catch(error => { console.error(error); process.exitCode = 1; });
