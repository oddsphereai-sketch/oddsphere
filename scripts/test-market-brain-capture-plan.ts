import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MARKET_BRAIN_CAPTURE_PLAN_RELEASE,
  assertMarketBrainCapturePlan,
  createMarketBrainCapturePlan,
  type MarketBrainCapturePlanPayload,
  type MarketBrainPlannedAttempt,
} from "../lib/services/marketBrain/marketBrainCapturePlan";

const firstAttempt: MarketBrainPlannedAttempt = Object.freeze({
  attemptId: "20000000-0000-4000-8000-000000000001",
  product: "nba_daily_edge",
  qualificationScopeKeys: Object.freeze(["moneyline", "spread", "total"]),
  provider: "sharpapi",
  feed: "main_odds",
  adapterRelease: "sharpapi_main_odds_adapter_test_r1",
  parserRelease: "sharpapi_main_odds_parser_test_r1",
  participant: "circa",
  eventId: "nba:2026-10-28:bos-nyk",
  phase: "current",
  plannedAt: "2026-10-28T16:02:00.000Z",
  windowOpensAt: "2026-10-28T16:00:00.000Z",
  windowClosesAt: "2026-10-28T16:05:00.000Z",
});
const secondAttempt: MarketBrainPlannedAttempt = Object.freeze({
  ...firstAttempt,
  attemptId: "20000000-0000-4000-8000-000000000002",
  feed: "sportsbook_splits",
  adapterRelease: "sharpapi_sportsbook_splits_adapter_test_r1",
  parserRelease: "sharpapi_sportsbook_splits_parser_test_r1",
  participant: null,
});
const basePayload: MarketBrainCapturePlanPayload = Object.freeze({
  planId: "30000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-27T12:00:00.000Z",
  horizonOpensAt: "2026-10-28T15:00:00.000Z",
  horizonClosesAt: "2026-10-28T17:00:00.000Z",
  attempts: Object.freeze([firstAttempt, secondAttempt]),
  details: Object.freeze({ cycle: "pregame_current", owner: "market_brain_research" }),
});

function payload(overrides: Partial<MarketBrainCapturePlanPayload>): MarketBrainCapturePlanPayload {
  return { ...basePayload, ...overrides };
}

const plan = createMarketBrainCapturePlan(basePayload);
assert.equal(plan.release, MARKET_BRAIN_CAPTURE_PLAN_RELEASE);
assert.equal(plan.checksum.length, 64);
assert.ok(Object.isFrozen(plan.attempts) && Object.isFrozen(plan.attempts[0]) && Object.isFrozen(plan.details));
assert.doesNotThrow(() => assertMarketBrainCapturePlan(plan));
assert.throws(() => assertMarketBrainCapturePlan({ ...plan, horizonClosesAt: "2026-10-29T17:00:00.000Z" }),
  /checksum/);

for (const [name, invalid] of [
  ["late precommit", payload({ createdAt: "2026-10-28T15:00:00.001Z" })],
  ["unbounded horizon", payload({ horizonClosesAt: "2026-10-28T15:00:00.000Z" })],
  ["empty plan", payload({ attempts: [] })],
  ["duplicate attempt id", payload({ attempts: [firstAttempt, { ...secondAttempt, attemptId: firstAttempt.attemptId }] })],
  ["duplicate obligation", payload({ attempts: [firstAttempt, { ...firstAttempt, attemptId: secondAttempt.attemptId }] })],
  ["duplicate physical request under narrower scopes", payload({ attempts: [firstAttempt, {
    ...firstAttempt, attemptId: secondAttempt.attemptId, qualificationScopeKeys: ["moneyline"],
  }] })],
  ["noncanonical order", payload({ attempts: [secondAttempt, firstAttempt] })],
  ["outside horizon", payload({ attempts: [{ ...firstAttempt, windowClosesAt: "2026-10-28T18:00:00.000Z" }] })],
  ["unknown feed", payload({ attempts: [{ ...firstAttempt, feed: "unknown" }] })],
  ["missing adapter release", payload({ attempts: [{ ...firstAttempt, adapterRelease: "" }] })],
  ["invalid parser release", payload({ attempts: [{ ...firstAttempt, parserRelease: "BAD RELEASE" }] })],
  ["isolated scope order", payload({ attempts: [{ ...firstAttempt, qualificationScopeKeys: ["total", "moneyline"] }] })],
] as const) {
  assert.throws(() => createMarketBrainCapturePlan(invalid), `must reject ${name}`);
}

const migration = readFileSync(resolve(process.cwd(),
  "lib/db/schema-migration-v48-market-brain-capture-plans.sql"), "utf8");
assert.match(migration, /server_created_at <= horizon_opens_at/,
  "database receipt time must prove the plan existed before its first capture horizon");
assert.match(migration, /persist_market_brain_capture_plan_v1/);
assert.match(migration, /ON CONFLICT \(release, plan_id\) DO NOTHING/);
assert.match(migration, /identity collision differs from immutable stored bytes/);
assert.match(migration, /FOREIGN KEY \(plan_release, plan_id\)/);
assert.match(migration, /attempt_id uuid NOT NULL UNIQUE/);
assert.match(migration, /market_brain_planned_attempts_logical_obligation/);
assert.match(migration, /adapter_release text NOT NULL/);
assert.match(migration, /parser_release text NOT NULL/);
assert.match(migration, /planned\.adapter_release IS DISTINCT FROM NEW\.adapter_release/);
assert.match(migration, /planned\.parser_release IS DISTINCT FROM NEW\.parser_release/);
assert.match(migration, /NULLS NOT DISTINCT/,
  "null participant or event identity must not permit duplicate logical obligations across plans");
assert.match(migration, /evidence attempt is unplanned or differs from its immutable precommit/);
assert.ok(migration.indexOf("IF FOUND THEN") < migration.indexOf("statement_timestamp() > v_horizon_opens_at"),
  "an exact already-persisted plan retry must attest even after the original precommit horizon opens");
assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.market_brain_capture_plans/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.market_brain_planned_attempts/);
assert.match(migration, /REVOKE ALL ON FUNCTION .* FROM PUBLIC/);
assert.doesNotMatch(migration, /GRANT INSERT ON public\.market_brain_capture_plans/,
  "plans must enter only through the atomic validated RPC");

const source = readFileSync(resolve(process.cwd(),
  "lib/services/marketBrain/marketBrainCapturePlan.ts"), "utf8");
assert.match(source, /\.rpc\("persist_market_brain_capture_plan_v1"/);
assert.match(source, /assertMarketBrainCapturePlanExecutable\(args\.plan, args\.capabilities\)/,
  "unsupported adapter/parser contracts must fail before plan persistence");
assert.doesNotMatch(source, /\.from\("market_brain_capture_plans"\)\.insert/);
assert.match(source, /Stored Market Brain capture plan differs/,
  "an idempotent retry must reload and attest exact stored bytes");

console.log("Market Brain all-product immutable capture-plan precommit contract passed.");
