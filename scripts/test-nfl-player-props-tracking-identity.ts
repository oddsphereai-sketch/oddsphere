import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropsInferenceContext } from "../lib/services/football/nflPlayerPropsInferenceContext";
import type { NflPlayerPropsProductionSnapshot } from "../lib/services/football/nflPlayerPropsProductionContract";
import { nflPlayerPropsTrackingIdentity } from "../lib/services/football/nflPlayerPropsTrackingIdentity";
import { writeLockedNflPlayerPropsTracking } from "../lib/services/football/nflPlayerPropsTrackingStore";

const decision = { gameId: "1", providerPlayerId: null, playerName: "Amon-Ra St. Brown", team: "DET",
  scheduledStart: "2026-11-05T17:00:00Z", lockAt: "2026-11-05T16:00:00Z", state: "locked", grade: "Lean",
  market: "receptions", line: 5.5, side: "under", sportsbook: "draftkings", americanPrice: -110,
  finalProbability: .57, expectedValue: .08, modelRelease: "model", calibrationRelease: "calibration", decisionRelease: "decision" };
const context = { games: [{ canonicalGameId: "1", scheduledStart: decision.scheduledStart,
  awayDepth: { provider: "balldontlie", team: "DET", capturedAt: "2026-11-05T15:55:00Z", roster: [{ playerId: "77", name: "Amon Ra St Brown" }] },
  homeDepth: { provider: "balldontlie", team: "MIN", capturedAt: "2026-11-05T15:55:00Z", roster: [] },
}] } as unknown as NflPlayerPropsInferenceContext;
const original = JSON.stringify(decision);
assert.deepEqual(nflPlayerPropsTrackingIdentity({ decision, context }), { playerId: "77", source: "exact_game_pregame_roster", capturedAt: "2026-11-05T15:55:00Z" });
assert.equal(nflPlayerPropsTrackingIdentity({ decision: { ...decision, providerPlayerId: "88" }, context }).playerId, "88", "stored quote ID has precedence over a roster lookup");
for (const mutate of [
  (c: NflPlayerPropsInferenceContext) => { c.games[0]!.canonicalGameId = "2"; },
  (c: NflPlayerPropsInferenceContext) => { c.games[0]!.scheduledStart = "2026-11-06T17:00:00Z"; },
  (c: NflPlayerPropsInferenceContext) => { c.games[0]!.awayDepth.team = "GB"; },
  (c: NflPlayerPropsInferenceContext) => { c.games[0]!.awayDepth.capturedAt = "2026-11-05T16:00:01Z"; },
  (c: NflPlayerPropsInferenceContext) => { c.games[0]!.awayDepth.roster.push({ ...c.games[0]!.awayDepth.roster[0]!, playerId: "99" }); },
]) {
  const changed = structuredClone(context); mutate(changed);
  assert.equal(nflPlayerPropsTrackingIdentity({ decision, context: changed }).playerId, null, "wrong game/team/time or ambiguous identity fails closed");
}
assert.equal(JSON.stringify(decision), original, "identity capture cannot mutate the model decision");
for (const [quoteName, rosterName] of [["Aaron Jones", "Aaron Jones Sr."], ["Michael Penix", "Michael Penix Jr."], ["Luther Burden", "Luther Burden III"]]) {
  const suffixContext = structuredClone(context);
  suffixContext.games[0]!.awayDepth.roster[0]!.name = rosterName!;
  const suffixDecision = { ...decision, playerName: quoteName! };
  assert.equal(nflPlayerPropsTrackingIdentity({ decision: suffixDecision, context: suffixContext }).playerId, "77");
  suffixContext.games[0]!.awayDepth.roster.push({ ...suffixContext.games[0]!.awayDepth.roster[0]!, playerId: "99", name: `${quoteName} Jr.` });
  assert.equal(nflPlayerPropsTrackingIdentity({ decision: suffixDecision, context: suffixContext }).playerId, null, "suffix normalization cannot guess between different same-name IDs");
}

async function main() {
  globalThis.fetch=async()=>{throw Error("Offline tracking proof forbids network");};
  const stored = new Map<string, Record<string, unknown>>();
  const client = { from: () => ({ upsert: async (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
    assert.equal(options.ignoreDuplicates, true);
    for (const row of rows) if (!stored.has(String(row.tracking_key))) stored.set(String(row.tracking_key), structuredClone(row));
    return { error: null };
  } }) } as unknown as SupabaseClient;
  const snapshot = { board: { decisions: [decision] } } as unknown as NflPlayerPropsProductionSnapshot;
  await writeLockedNflPlayerPropsTracking({ client, snapshot, context });
  const first = [...stored.values()][0]!;
  assert.equal(first.provider_player_id, "77");
  assert.deepEqual((first.snapshot_json as { decision: unknown }).decision, decision, "the exact model payload remains unchanged beside new identity provenance");
  const before = JSON.stringify([...stored]);
  const changed = structuredClone(context); changed.games[0]!.awayDepth.roster[0]!.playerId = "99";
  await writeLockedNflPlayerPropsTracking({ client, snapshot, context: changed });
  assert.equal(JSON.stringify([...stored]), before, "subsequent rosters cannot update any already locked tracking field");
  const legacy = { ...first, provider_player_id: null, snapshot_json: { trackingRelease: "legacy", decision } };
  stored.set(String(first.tracking_key), legacy);
  const legacyBefore = JSON.stringify([...stored]);
  await writeLockedNflPlayerPropsTracking({ client, snapshot, context });
  assert.equal(JSON.stringify([...stored]), legacyBefore, "the normal writer cannot silently repair a legacy locked missing identity");
  const legacyQuote={...first,snapshot_json:{trackingRelease:"legacy",decision:{...decision,sportsbook:"legacy-other-book",americanPrice:150}}};
  stored.set(String(first.tracking_key),legacyQuote);
  const legacyQuoteBefore=JSON.stringify([...stored]);
  await writeLockedNflPlayerPropsTracking({client,snapshot,context});
  assert.equal(JSON.stringify([...stored]),legacyQuoteBefore,"even inconsistent legacy quote evidence must remain exact; no silent locked-record correction");
  // The same player/line/side can be offered at multiple books. Each insertion
  // candidate must retain its own immutable quote, including duplicate keys.
  for(const prices of [[-110,125], [125,-110]]){
    const quotes=prices.map((price,i)=>({...decision,sportsbook:`book-${i}`,americanPrice:price,
      finalProbability:i===0?.57:.61,expectedValue:i===0?.08:.3725,providerPlayerId:String(80+i)}));
    const source={board:{decisions:quotes}} as unknown as NflPlayerPropsProductionSnapshot;
    const before=JSON.stringify(source);
    const capture={from:()=>({upsert:async(rows:Record<string,unknown>[],options:Record<string,unknown>)=>{
      assert.equal(options.ignoreDuplicates,true);assert.equal(rows.length,quotes.length);
      rows.forEach((row,i)=>{
        const evidence=(row.snapshot_json as {decision:typeof decision}).decision;
        assert.deepEqual(evidence,quotes[i]);
        assert.equal(row.sportsbook,evidence.sportsbook);assert.equal(row.locked_price,evidence.americanPrice);
        assert.equal(row.locked_probability,evidence.finalProbability);assert.equal(row.locked_expected_value,evidence.expectedValue);
        assert.equal(row.provider_player_id,quotes[i]!.providerPlayerId);
      });return {error:null};
    }})} as unknown as SupabaseClient;
    await writeLockedNflPlayerPropsTracking({client:capture,snapshot:source});
    assert.equal(JSON.stringify(source),before,"the exact source locked board cannot change");
  }
  console.log("NFL props future identity capture and complete legacy lock immutability passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
