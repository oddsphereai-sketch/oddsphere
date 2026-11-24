import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NBA_MODEL_RELEASE, NBA_COMPATIBLE_KNOWLEDGE_MODEL_RELEASES } from "../lib/automodel/nba/nbaChampionRuntime";
import { loadNbaMarketKnowledgeStates } from "../lib/services/nba/nbaMarketKnowledgeStore";
import { reconcileNbaMarketConsequence } from "../lib/services/nba/nbaMarketConsequence";
import type { NbaReaderPriceRow } from "../lib/services/nba/nbaProfessionalMarketReader";
const native = "2026-11-04T10:00:00Z", evaluated = "2026-11-04T11:00:00Z";
const rows: NbaReaderPriceRow[] = (["moneyline", "spread", "total"] as const).flatMap(market =>
  (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => ({
    provider: "owls", sportsbook: "circa", sharpBook: true, providerEventId: "42", ingestionRunId: "real-source-receipt",
    market, selectionKey: `42:${market}:${side}`, line: market === "moneyline" ? null : market === "total" ? 220 : i ? 5.5 : -5.5,
    americanPrice: i ? 130 : -150, providerTimestamp: native, fetchedAt: native,
  })));
const context = { eventId: "42", inputFingerprint: "same-independent", evaluatedAt: evaluated,
  priceRows: rows, splitRows: [], previousState: null, pricesTrusted: true, splitsTrusted: true };
const original = reconcileNbaMarketConsequence({ independentMargin: 10, independentTotal: 240,
  law: { marginSigma: 12, totalSigma: 18 }, spreadHome: -5.5, totalLine: 220, context }).state;
assert.ok(Object.keys(original.anchors).length > 0, "fixture has actual native anchored source contracts");
const predecessors = NBA_COMPATIBLE_KNOWLEDGE_MODEL_RELEASES;
assert.deepEqual(predecessors, [
  "nba_professional_unified_2026_11_20_r38_event_scoped_split_evidence",
  "nba_professional_unified_2026_11_20_r37_event_scoped_evidence",
  "nba_professional_unified_2026_11_04_r36_paid_consumer_book_coverage",
  "nba_professional_unified_2026_11_04_r35_native_consumer_pairs",
  "nba_professional_unified_2026_11_04_r34_own_book_pressure",
]);
async function run(available: Record<string, unknown>) {
  const visited: string[] = [], lockFilters: unknown[] = [], dates: string[] = [];
  const client = { from: () => { let model = ""; const query = {
    select: () => query, eq: (key: string, value: string) => { if (key === "model_version") model = value;
      if (key === "slate_date") dates.push(value); return query; }, in: () => query,
    is: (key: string, value: unknown) => { lockFilters.push([key, value]); return query; },
    limit: async () => { visited.push(model); return { data: available[model] === undefined ? []
      : [{ game_id: 7, market: "moneyline", knowledge: available[model] }], error: null }; },
  }; return query; } } as unknown as SupabaseClient;
  const result = await loadNbaMarketKnowledgeStates({ client, slateDate: "2026-11-06", modelRelease: NBA_MODEL_RELEASE,
    externalIdByDbId: new Map([[7, 42]]) });
  assert.ok(lockFilters.every(value => JSON.stringify(value) === '["locked_at",null]'));
  assert.ok(dates.every(date => date === "2026-11-06"));
  return { visited, result };
}
async function main() {
  const serialized = JSON.stringify(original);
  for (const [index, release] of predecessors.entries()) {
    const carried = await run({ [release]: original });
    assert.deepEqual(carried.visited, [NBA_MODEL_RELEASE, ...predecessors.slice(0, index + 1)]);
    assert.deepEqual(carried.result.get(42), original);
    const continued = reconcileNbaMarketConsequence({ independentMargin: 10, independentTotal: 240,
      law: { marginSigma: 12, totalSigma: 18 }, spreadHome: -5.5, totalLine: 220,
      context: { ...context, inputFingerprint: "new-release-same-numeric-input", evaluatedAt: "2026-11-04T12:00:00Z",
        priceRows: [], previousState: carried.result.get(42)! } }).state;
    assert.equal(continued.knowledgeAt, original.knowledgeAt);
    assert.deepEqual(continued.anchors, original.anchors, `${release} retains exact original source clocks/anchors`);
    assert.deepEqual(continued.unresolvedInputRevisions, original.unresolvedInputRevisions,
      "release identity alone cannot introduce a numerical input revision");
    assert.equal(JSON.stringify(original), serialized);
  }
  const available = Object.fromEntries(predecessors.map(release => [release, original]));
  assert.deepEqual((await run(available)).visited, [NBA_MODEL_RELEASE, predecessors[0]]);
  assert.deepEqual((await run({ ...available, [NBA_MODEL_RELEASE]: original })).visited, [NBA_MODEL_RELEASE]);
  for (const release of predecessors) await assert.rejects(run({ [release]: { ...original, eventId: "wrong" } }), /corrupt/);
  const absent = await run({ arbitrary_older_release: original });
  assert.deepEqual(absent.visited, [NBA_MODEL_RELEASE, ...predecessors]); assert.equal(absent.result.size, 0);
  console.log("NBA knowledge continuity: all exact R38/R37/R36/R35/R34 predecessors, unchanged anchors and current/nearest precedence passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
