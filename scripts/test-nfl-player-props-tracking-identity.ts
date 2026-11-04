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

async function main() {
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
  console.log("NFL props future identity capture and complete legacy lock immutability passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
