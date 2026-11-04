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
const [r35, r34] = NBA_COMPATIBLE_KNOWLEDGE_MODEL_RELEASES;
assert.equal(r34, "nba_professional_unified_2026_11_04_r34_own_book_pressure");
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
  const oldest = await run({ [r34]: original });
  assert.deepEqual(oldest.visited, [NBA_MODEL_RELEASE, r35, r34]);
  assert.deepEqual(oldest.result.get(42), original);
  const continued = reconcileNbaMarketConsequence({ independentMargin: 10, independentTotal: 240,
    law: { marginSigma: 12, totalSigma: 18 }, spreadHome: -5.5, totalLine: 220,
    context: { ...context, evaluatedAt: "2026-11-04T12:00:00Z", priceRows: [], previousState: oldest.result.get(42)! } }).state;
  assert.equal(continued.knowledgeAt, original.knowledgeAt);
  assert.deepEqual(continued.anchors, original.anchors, "R34-only future fixture enters R36 without renewing source clocks/anchors");
  assert.equal(JSON.stringify(original), serialized);
  assert.deepEqual((await run({ [r35]: original, [r34]: original })).visited, [NBA_MODEL_RELEASE, r35]);
  assert.deepEqual((await run({ [NBA_MODEL_RELEASE]: original, [r35]: original, [r34]: original })).visited, [NBA_MODEL_RELEASE]);
  await assert.rejects(run({ [r35]: { ...original, eventId: "wrong" }, [r34]: original }), /corrupt/);
  const absent = await run({ arbitrary_older_release: original });
  assert.deepEqual(absent.visited, [NBA_MODEL_RELEASE, r35, r34]); assert.equal(absent.result.size, 0);
  console.log("NBA paid coverage knowledge: bounded R35/R34 continuation, original anchors and current/legacy precedence passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
