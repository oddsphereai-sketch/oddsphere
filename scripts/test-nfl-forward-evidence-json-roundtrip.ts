import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "../lib/services/football/nflForwardEvidence";
import { appendNflForwardEvidence, nflForwardEvidenceStoredHashMatches, readNflForwardEvidence } from "../lib/services/football/nflForwardEvidenceStore";

const clock = "2026-11-01T12:51:37.596Z";
const deployedFixture = () => ({
  schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  collectorRelease: "nfl_forward_evidence_collector_2026_10_27_r29_owls_capture_only",
  season: 2026, week: 8, stage: "unlocked", capturedAt: clock, cutoffAt: null,
  game: { providerGameId: "1392327", scheduledStart: "2026-11-01T18:00:00.000Z",
    away: { abbreviation: "MIN" }, home: { abbreviation: "DET" } },
  outcomeForecast: { expectedAwayScore: 20.9, expectedHomeScore: 24.9 },
  decisions: {
    modelPromotionStatus: "nfl_v1_member_release_2026_11_01_r50_independent_market_axes",
    evaluatedBets: (["moneyline", "spread", "total"] as const).map((market) => ({
      market, side: market === "total" ? "Under 46" : "DET", grade: "No Play",
      evaluatedQuote: { sportsbook: "draftkings", line: market === "moneyline" ? null : market === "spread" ? -3.5 : 46,
        price: -110, observedAt: clock },
      modelRelease: market === "moneyline" ? "nfl_v1_daily_edge_model_2026_11_01_r45_independent_market_axes"
        : market === "spread" ? "nfl_v1_spread_market_direction_2026_10_31_r23_named_price_chronology"
          : "nfl_v1_total_market_evidence_2026_10_25_r13_unified_total_interpreter",
      calibrationRelease: "nfl_v1_daily_edge_calibration_2026_11_01_r44_independent_market_axes",
      decisionRelease: "nfl_v1_daily_edge_decision_2026_11_01_r53_independent_market_axes",
    })),
  },
  fullGameEvidenceInterpretation: {
    runtimeRelease: "nfl_full_game_evidence_runtime_2026_11_01_r11_independent_market_axes",
    arbiterRelease: "nfl_full_game_evidence_arbiter_candidate_2026_11_01_r26_independent_market_axes",
    ledgerRelease: "nfl_full_game_evidence_ledger_2026_11_01_r10_independent_market_axes", status: "applied",
  },
  coverage: { currentOdds: true },
}) as unknown as NflForwardEvidencePayload;

function readClient(payload: NflForwardEvidencePayload, hash: string): SupabaseClient {
  const row = { id: "stored-immutable-row", provider_game_id: payload.game.providerGameId,
    stage: payload.stage, captured_at: payload.capturedAt, game_start_at: payload.game.scheduledStart,
    payload_sha256: hash, payload };
  const query = { eq: () => query, order: () => query, range: async () => ({ data: [row], error: null }) };
  return { from: () => ({ select: () => query }) } as unknown as SupabaseClient;
}

async function main() {
  const payload = deployedFixture();
  const rawOutcome = payload.outcomeForecast as unknown as Record<string, unknown>;
  rawOutcome.marketEvidence = undefined;
  rawOutcome.noWeightMarketReader = undefined;
  rawOutcome.optionalNested = { omitted: undefined, retained: "source", slots: [undefined, null] };
  const originalHash = hashNflForwardEvidencePayload(payload);
  let insertedRows: Array<{ payload: NflForwardEvidencePayload; payload_sha256: string }> = [];
  const writeClient = { from: () => ({ insert: (rows: typeof insertedRows) => {
    insertedRows = rows;
    return { select: async () => ({ data: [{ id: "new-row" }], error: null }) };
  } }) } as unknown as SupabaseClient;
  const written = await appendNflForwardEvidence({ client: writeClient, runId: "roundtrip", payloads: [payload], apply: true });
  assert.equal(written.inserted, 1);
  assert.notEqual(insertedRows[0]!.payload, payload, "normalization cannot mutate the caller's authoritative forecast");
  assert.equal(Object.hasOwn(payload.outcomeForecast, "marketEvidence"), true);
  assert.equal(rawOutcome.marketEvidence, undefined);
  assert.equal(hashNflForwardEvidencePayload(payload), originalHash, "caller remains unchanged after persistence preparation");
  const transported = JSON.parse(JSON.stringify(insertedRows[0]!.payload)) as NflForwardEvidencePayload;
  assert.equal(Object.hasOwn(transported.outcomeForecast, "marketEvidence"), false);
  assert.equal(hashNflForwardEvidencePayload(transported), insertedRows[0]!.payload_sha256);
  assert.equal(written.hashes[0], insertedRows[0]!.payload_sha256);
  const ordinaryRead = await readNflForwardEvidence({ client: readClient(transported, written.hashes[0]!), season: 2026, week: 8 });
  assert.equal(ordinaryRead[0]!.payload, transported);

  const legacy = deployedFixture();
  const legacyWithHashedNullSlots = { ...legacy, outcomeForecast: { ...legacy.outcomeForecast,
    marketEvidence: null, noWeightMarketReader: null } } as unknown as NflForwardEvidencePayload;
  const legacyHash = hashNflForwardEvidencePayload(legacyWithHashedNullSlots);
  assert.notEqual(hashNflForwardEvidencePayload(legacy), legacyHash);
  assert.equal(nflForwardEvidenceStoredHashMatches(legacy, legacyHash), true,
    "only the exact deployed release's two omitted null slots may attest the original stored digest");
  const untouchedJson = JSON.stringify(legacy);
  const legacyRead = await readNflForwardEvidence({ client: readClient(legacy, legacyHash), season: 2026, week: 8 });
  assert.equal(legacyRead[0]!.payload, legacy, "compatibility returns exact stored payload identity, not hash-only reconstruction");
  assert.equal(JSON.stringify(legacy), untouchedJson);
  assert.equal(legacyRead[0]!.payloadSha256, legacyHash, "stored digest is never replaced");

  for (const mutate of [
    (p: NflForwardEvidencePayload) => { p.outcomeForecast.expectedHomeScore += 1; },
    (p: NflForwardEvidencePayload) => { p.decisions.evaluatedBets[0]!.side = "MIN"; },
    (p: NflForwardEvidencePayload) => { p.decisions.evaluatedBets[0]!.evaluatedQuote.price = 125; },
    (p: NflForwardEvidencePayload) => { p.decisions.modelPromotionStatus = "other-release" as never; },
    (p: NflForwardEvidencePayload) => { p.stage = "t60"; },
    (p: NflForwardEvidencePayload) => { p.fullGameEvidenceInterpretation!.runtimeRelease = "other-runtime"; },
    (p: NflForwardEvidencePayload) => { p.decisions.evaluatedBets[0]!.decisionRelease = "other-decision"; },
    (p: NflForwardEvidencePayload) => { (p.outcomeForecast as unknown as Record<string, unknown>).marketEvidence = { source: "real-value" }; },
    (p: NflForwardEvidencePayload) => { (p.outcomeForecast as unknown as Record<string, unknown>).noWeightMarketReader = null; },
  ]) {
    const altered = structuredClone(legacy);
    mutate(altered);
    assert.equal(nflForwardEvidenceStoredHashMatches(altered, legacyHash), false,
      "narrow transport compatibility cannot attest changed stored facts or another release");
    await assert.rejects(readNflForwardEvidence({ client: readClient(altered, legacyHash), season: 2026, week: 8 }), /checksum mismatch/);
  }
  assert.equal(nflForwardEvidenceStoredHashMatches(legacy, "0".repeat(64)), false);
  const lockedLegacy = { ...legacy, stage: "t60" as const };
  assert.equal(nflForwardEvidenceStoredHashMatches(lockedLegacy, hashNflForwardEvidencePayload(lockedLegacy)), true,
    "strict valid locked legacy payloads remain readable without any compatibility reconstruction");
  console.log("NFL evidence JSON roundtrip: exact transport hash, caller/legacy immutability, bounded omission attestation and corruption rejection passed");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
