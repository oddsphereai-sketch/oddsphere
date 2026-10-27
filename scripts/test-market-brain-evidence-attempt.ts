import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE,
  assertMarketBrainEvidenceAttempt,
  createMarketBrainEvidenceAttempt,
  type MarketBrainEvidenceAttemptPayload,
} from "../lib/services/marketBrain/marketBrainEvidenceAttempt";
import { marketBrainCanonicalJson } from "../lib/services/marketBrain/marketBrainCanonical";

const ZERO_ACCOUNTING = Object.freeze({
  rawRows: 0,
  parsedRows: 0,
  unsupportedRows: 0,
  malformedRows: 0,
  matchedRows: 0,
  unmatchedRows: 0,
  ambiguousRows: 0,
  retainedRows: 0,
  duplicateRows: 0,
  filteredRows: 0,
  writeFailedRows: 0,
});

const successPayload: MarketBrainEvidenceAttemptPayload = Object.freeze({
  attemptId: "10000000-0000-4000-8000-000000000001",
  product: "nba_daily_edge",
  qualificationScopeKeys: Object.freeze(["moneyline", "spread", "total"]),
  provider: "sharpapi",
  feed: "main_odds",
  participant: "circa",
  eventId: "nba:2026-10-27:bos-nyk",
  phase: "current",
  plannedAt: "2026-10-27T16:02:00.000Z",
  windowOpensAt: "2026-10-27T16:00:00.000Z",
  windowClosesAt: "2026-10-27T16:05:00.000Z",
  startedAt: "2026-10-27T16:01:00.000Z",
  completedAt: "2026-10-27T16:03:00.000Z",
  outcome: "success_with_rows",
  reasonCode: null,
  requestCount: 1,
  expectedPages: 1,
  receivedPages: 1,
  responseSha256: "a".repeat(64),
  rawArchiveSha256: "b".repeat(64),
  parserRelease: "sharpapi_main_odds_parser_test_r1",
  accounting: Object.freeze({
    ...ZERO_ACCOUNTING,
    rawRows: 4,
    parsedRows: 3,
    unsupportedRows: 1,
    matchedRows: 2,
    unmatchedRows: 1,
    retainedRows: 1,
    duplicateRows: 1,
  }),
  details: Object.freeze({ httpStatus: 200, cursor: null }),
});

function payload(overrides: Partial<MarketBrainEvidenceAttemptPayload>): MarketBrainEvidenceAttemptPayload {
  return { ...successPayload, ...overrides };
}

const created = createMarketBrainEvidenceAttempt(successPayload);
assert.equal(created.release, MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE);
assert.equal(created.checksum.length, 64);
assert.doesNotThrow(() => assertMarketBrainEvidenceAttempt(created));
assert.throws(() => assertMarketBrainEvidenceAttempt({ ...created, requestCount: 2 }), /checksum/);
assert.ok(Object.isFrozen(created.accounting) && Object.isFrozen(created.details),
  "created receipts must not expose mutable nested checksum material");
assert.equal(marketBrainCanonicalJson(created), marketBrainCanonicalJson(structuredClone(created)),
  "the persisted payload must retain a deterministic byte representation");

assert.doesNotThrow(() => createMarketBrainEvidenceAttempt(payload({
  attemptId: "10000000-0000-4000-8000-000000000002",
  outcome: "success_empty",
  reasonCode: "provider_returned_empty",
  rawArchiveSha256: null,
  parserRelease: null,
  accounting: ZERO_ACCOUNTING,
})));
assert.doesNotThrow(() => createMarketBrainEvidenceAttempt(payload({
  attemptId: "10000000-0000-4000-8000-000000000006",
  outcome: "skipped",
  reasonCode: "missed_window",
  startedAt: null,
  requestCount: 0,
  expectedPages: null,
  receivedPages: 0,
  responseSha256: null,
  rawArchiveSha256: null,
  parserRelease: null,
  accounting: ZERO_ACCOUNTING,
})), "an expired unexecuted obligation must remain visible instead of disappearing");
assert.doesNotThrow(() => createMarketBrainEvidenceAttempt(payload({
  attemptId: "10000000-0000-4000-8000-000000000003",
  outcome: "partial",
  reasonCode: "pagination_incomplete",
  expectedPages: 3,
  receivedPages: 2,
})));
assert.doesNotThrow(() => createMarketBrainEvidenceAttempt(payload({
  attemptId: "10000000-0000-4000-8000-000000000004",
  outcome: "failed",
  reasonCode: "timeout",
  expectedPages: null,
  receivedPages: 0,
  responseSha256: null,
  rawArchiveSha256: null,
  parserRelease: null,
  accounting: ZERO_ACCOUNTING,
})));
assert.doesNotThrow(() => createMarketBrainEvidenceAttempt(payload({
  attemptId: "10000000-0000-4000-8000-000000000005",
  outcome: "skipped",
  reasonCode: "cadence_suppressed",
  startedAt: null,
  requestCount: 0,
  expectedPages: null,
  receivedPages: 0,
  responseSha256: null,
  rawArchiveSha256: null,
  parserRelease: null,
  accounting: ZERO_ACCOUNTING,
})));

for (const [name, invalid] of [
  ["qualification scope", payload({ qualificationScopeKeys: ["first_half_moneyline"] })],
  ["duplicate scope", payload({ qualificationScopeKeys: ["moneyline", "moneyline"] })],
  ["noncanonical scope order", payload({ qualificationScopeKeys: ["spread", "moneyline"] })],
  ["feed", payload({ feed: "unknown_odds" })],
  ["phase", payload({ phase: "settlement" })],
  ["raw accounting", payload({ accounting: { ...successPayload.accounting, rawRows: 5 } })],
  ["parsed accounting", payload({ accounting: { ...successPayload.accounting, parsedRows: 4 } })],
  ["matched accounting", payload({ accounting: { ...successPayload.accounting, matchedRows: 3 } })],
  ["missing replay archive", payload({ rawArchiveSha256: null })],
  ["success reason", payload({ reasonCode: "parser_partial" })],
  ["failed without request", payload({ outcome: "failed", reasonCode: "timeout", requestCount: 0 })],
] as const) {
  assert.throws(() => createMarketBrainEvidenceAttempt(invalid), `must reject invalid ${name}`);
}

assert.throws(() => createMarketBrainEvidenceAttempt(payload({
  product: "ucl_daily_edge",
  qualificationScopeKeys: ["match_result", "double_chance", "total", "btts"],
  provider: "sharpapi",
  feed: "soccer_market_odds",
  participant: "polymarket",
})), /frozen product\/feed\/participant contract/,
"an explicitly excluded participant must never enter the evidence ledger");

const migration = readFileSync(resolve(process.cwd(),
  "lib/db/schema-migration-v47-market-brain-evidence-attempts.sql"), "utf8");
assert.match(migration, /PRIMARY KEY \(release, attempt_id\)/);
assert.match(migration, /completed_at <= server_created_at/,
  "a caller must not predeclare a successful future receipt before provider work occurs");
assert.match(migration, /claim_token uuid NOT NULL/);
assert.match(migration, /claim_mode = 'missed_window_reconcile'[\s\S]*reason_code = 'missed_window'/);
assert.match(migration, /product_key text NOT NULL CHECK \(product_key IN/);
assert.match(migration, /product_key = 'nba_player_props' AND qualification_scope_keys <@ ARRAY/);
assert.match(migration, /count\(DISTINCT scope_key\)/,
  "the database must reject duplicate qualification scopes in a joint attempt");
assert.match(migration, /raw_rows = parsed_rows \+ unsupported_rows \+ malformed_rows/);
assert.match(migration, /parsed_rows = matched_rows \+ unmatched_rows \+ ambiguous_rows/);
assert.match(migration, /matched_rows = retained_rows \+ duplicate_rows \+ filtered_rows \+ write_failed_rows/);
assert.match(migration, /checksum_payload_text::jsonb = attempt_payload - 'checksum'/);
assert.match(migration, /digest\(convert_to\(checksum_payload_text, 'UTF8'\), 'sha256'\)/);
assert.match(migration, /validate_market_brain_evidence_attempt/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL .* FROM anon, authenticated/);
assert.match(migration, /GRANT SELECT, INSERT .* TO service_role/);

const source = readFileSync(resolve(process.cwd(),
  "lib/services/marketBrain/marketBrainEvidenceAttempt.ts"), "utf8");
assert.match(source, /\.insert\(toRow\(args\.attempt, args\.claim\)\)/,
  "first persistence must be a create-only insert");
assert.doesNotMatch(source, /\.upsert\(/,
  "idempotent retries must never overwrite an earlier attempt");
assert.match(source, /\.eq\("release", args\.attempt\.release\)\.eq\("attempt_id", args\.attempt\.attemptId\)/,
  "an insert collision must reload only the immutable release/attempt identity");
assert.match(source, /Stored Market Brain evidence attempt differs/,
  "a retry collision must attest exact bytes instead of treating existence as success");

console.log("Market Brain all-product append-only evidence-attempt contract passed.");
