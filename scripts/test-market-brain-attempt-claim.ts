import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
  claimDueMarketBrainAttempts,
  claimExpiredMarketBrainAttemptsForReconciliation,
} from "../lib/services/marketBrain/marketBrainAttemptClaim";

function clientFor(mode: "due" | "missed_window_reconcile"): SupabaseClient {
  const claimedAt = mode === "due" ? "2026-10-28T16:02:30.000+00:00" : "2026-10-28T16:06:00.000+00:00";
  return {
    rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, mode === "due"
        ? "claim_due_market_brain_attempts_v1" : "claim_expired_market_brain_attempts_v1");
      assert.equal(args.p_claim_release, MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE);
      return Promise.resolve({ error: null, data: [{
        attempt_id: mode === "due"
          ? "50000000-0000-4000-8000-000000000001" : "50000000-0000-4000-8000-000000000002",
        product_key: "nba_daily_edge",
        qualification_scope_keys: ["moneyline", "spread", "total"],
        provider: "sharpapi",
        feed: "main_odds",
        adapter_release: "sharpapi_main_odds_adapter_test_r1",
        parser_release: "sharpapi_main_odds_parser_test_r1",
        participant: "circa",
        event_id: "nba:claim-proof",
        phase: "current",
        planned_at: "2026-10-28T16:02:00.000+00:00",
        window_opens_at: "2026-10-28T16:00:00.000+00:00",
        window_closes_at: "2026-10-28T16:05:00.000+00:00",
        claim_release: MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
        claim_token: mode === "due"
          ? "50000000-0000-4000-8000-000000000011" : "50000000-0000-4000-8000-000000000012",
        claim_mode: mode,
        claimed_by: "market-brain-test-worker",
        claimed_at: claimedAt,
        lease_expires_at: mode === "due"
          ? "2026-10-28T16:04:30.000+00:00" : "2026-10-28T16:08:00.000+00:00",
        claim_sequence: 1,
      }] });
    },
  } as unknown as SupabaseClient;
}

async function main(): Promise<void> {
  const due = await claimDueMarketBrainAttempts({
    client: clientFor("due"), workerId: "market-brain-test-worker",
  });
  assert.equal(due.length, 1);
  assert.equal(due[0]?.claimMode, "due");
  assert.equal(due[0]?.claimedAt, "2026-10-28T16:02:30.000Z",
    "database timestamptz offsets must normalize to canonical ISO timestamps");
  assert.ok(Object.isFrozen(due) && Object.isFrozen(due[0]?.qualificationScopeKeys));

  const missed = await claimExpiredMarketBrainAttemptsForReconciliation({
    client: clientFor("missed_window_reconcile"), workerId: "market-brain-test-worker",
  });
  assert.equal(missed.length, 1);
  assert.equal(missed[0]?.claimMode, "missed_window_reconcile");
  assert.ok(Date.parse(missed[0]!.claimedAt) > Date.parse(missed[0]!.windowClosesAt));

  await assert.rejects(() => claimDueMarketBrainAttempts({
    client: clientFor("due"), workerId: "bad worker id", limit: 101, leaseSeconds: 1,
  }), /worker, batch limit, or lease duration/);

  const migration = readFileSync(resolve(process.cwd(),
    "lib/db/schema-migration-v49-market-brain-attempt-claims.sql"), "utf8");
  assert.match(migration, /FOR UPDATE OF planned_attempt SKIP LOCKED/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(planned\.attempt_id::text, 0\)\)/);
  assert.match(migration, /claim_sequence = public\.market_brain_attempt_claims\.claim_sequence \+ 1/);
  assert.match(migration,
    /ON CONFLICT ON CONSTRAINT market_brain_attempt_claims_pkey DO UPDATE SET/,
    "the upsert must not ambiguously resolve the RETURNS TABLE attempt_id output variable");
  assert.doesNotMatch(migration, /ON CONFLICT \(attempt_id\)/);
  assert.match(migration, /market_brain_attempt_claim_history/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.market_brain_attempt_claim_history/);
  assert.match(migration, /market_brain_evidence_attempts_00_serialize_claim/);
  assert.match(migration, /AFTER INSERT ON public\.market_brain_evidence_attempts/);
  assert.match(migration, /current_claim\.lease_expires_at <= v_now/);
  assert.match(migration, /planned_attempt\.window_closes_at < v_now/,
    "expired obligations must remain independently claimable for missed-window receipts");
  assert.match(migration, /planned_attempt\.planned_at <= v_now/,
    "an obligation must not execute merely because its wider capture window has opened");
  assert.match(migration, /active_claim\.lease_expires_at <= statement_timestamp\(\)/,
    "an expired worker must not finalize even before a replacement claim is issued");
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE) ON public\.market_brain_attempt_claims/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_due_market_brain_attempts_v1/);

  console.log("Market Brain leased due-work and missed-window claim contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
