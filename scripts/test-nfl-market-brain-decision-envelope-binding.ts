import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(),
  "lib/db/schema-migration-v50-nfl-market-brain-decision-envelopes.sql"), "utf8");
const postgresProof = readFileSync(resolve(process.cwd(),
  "scripts/test-nfl-market-brain-postgres-v46.sh"), "utf8");
const adversarialFixture = readFileSync(resolve(process.cwd(),
  "scripts/fixtures/nfl-market-brain-v50-decision-envelope-proof.sql"), "utf8");

assert.match(migration, /NEW\.shadow \? 'case'/,
  "every newly inserted successful shadow must freeze a decision envelope");
assert.match(migration, /jsonb_typeof\(NEW\.shadow #> '\{case,decisionEnvelopes\}'\)/);
assert.match(migration, /jsonb_array_elements\(capture_set\.capture_set -> 'membership'\)/,
  "research binding must use the exact finalized membership rather than an event-wide lookup");
assert.match(migration, /shadow\.id = \(membership ->> 'recordId'\)::uuid/);
assert.match(migration, /shadow\.shadow_sha256 = membership ->> 'shadowSha256'/);
assert.match(migration, /membership ->> 'status' = 'captured'/);
assert.match(migration, /case,evaluatedAt.*<= NEW\.cutoff_at/,
  "post-cutoff cases must never supply an inference decision envelope");
assert.match(migration,
  /ORDER BY \(shadow\.shadow #>> '\{case,evaluatedAt\}'\)::timestamptz DESC,[\s\S]*shadow\.captured_at DESC,[\s\S]*shadow\.id DESC/,
  "the database must use the same deterministic latest-case ordering as materialization");
assert.match(migration,
  /captured_decision_envelopes IS DISTINCT FROM NEW\.research_input -> 'decisionEnvelopes'/,
  "a fully rehashed caller-authored envelope must still fail when it differs from capture");
assert.match(migration, /BEFORE INSERT ON public\.nfl_market_brain_research_inputs/);
assert.doesNotMatch(migration, /UPDATE public\.nfl_market_brain_/,
  "the migration must not reinterpret or rewrite an existing immutable research record");
assert.match(postgresProof, /schema-migration-v50-nfl-market-brain-decision-envelopes\.sql/);
assert.match(postgresProof, /nfl-market-brain-v50-decision-envelope-proof\.sql/);
assert.match(adversarialFixture, /v50 accepted a fully rehashed forged decision envelope/);
assert.match(adversarialFixture, /WHERE event_id = ids\.event_id\) <> 1/,
  "the real database proof must retain the legitimate input and reject only the forgery");

console.log("NFL Market Brain database decision-envelope binding contract passed.");
