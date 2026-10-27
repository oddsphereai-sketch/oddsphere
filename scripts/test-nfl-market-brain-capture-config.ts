import assert from "node:assert/strict";

import {
  parseNflMarketBrainCaptureAttemptSchedule,
  resolveNflMarketBrainCaptureConfiguration,
} from "../lib/services/football/nflMarketBrainCaptureConfig";

const validSchedule = JSON.stringify({
  "1001:opening": [{
    attemptId: "123e4567-e89b-42d3-a456-426614174000",
    windowOpensAt: "2026-09-01T12:00:00.000Z",
    windowClosesAt: "2026-09-01T12:05:00.000Z",
  }],
});

assert.deepEqual(resolveNflMarketBrainCaptureConfiguration({
  NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED: "false",
  NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED: "true",
  NFL_MARKET_BRAIN_SHADOW_CANARY_MAX_GAMES: "not-a-number",
  NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON: "not-json",
}), {
  requested: false,
  enabled: false,
  maximumGames: 0,
  attemptSchedule: undefined,
  error: null,
}, "feature-off must not parse, validate, or fail on dormant research configuration");

const valid = resolveNflMarketBrainCaptureConfiguration({
  NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED: "true",
  NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED: "true",
  NFL_MARKET_BRAIN_SHADOW_CANARY_MAX_GAMES: "2",
  NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON: validSchedule,
});
assert.equal(valid.enabled, true);
assert.equal(valid.maximumGames, 2);
assert.equal(valid.attemptSchedule?.["1001:opening"]?.length, 1);

for (const [label, env] of [
  ["missing schedule", {
    NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED: "true",
    NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED: "true",
  }],
  ["malformed JSON", {
    NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED: "true",
    NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED: "true",
    NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON: "{",
  }],
  ["bad canary limit", {
    NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED: "true",
    NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED: "true",
    NFL_MARKET_BRAIN_SHADOW_CANARY_MAX_GAMES: "5",
    NFL_MARKET_BRAIN_CAPTURE_ATTEMPTS_JSON: validSchedule,
  }],
] as const) {
  const resolved = resolveNflMarketBrainCaptureConfiguration(env);
  assert.equal(resolved.requested, true, label);
  assert.equal(resolved.enabled, false, label);
  assert.equal(resolved.maximumGames, 0, label);
  assert.match(resolved.error ?? "", /^nfl_market_brain_configuration_disabled:/, label);
}

assert.throws(() => parseNflMarketBrainCaptureAttemptSchedule(JSON.stringify({
  "1001:opening": [{
    attemptId: "123e4567-e89b-42d3-a456-426614174000",
    windowOpensAt: "2026-09-01T12:05:00.000Z",
    windowClosesAt: "2026-09-01T12:00:00.000Z",
  }],
})), /valid UUID windows/);

console.log("NFL Market Brain configuration is opt-in, validated, and fail-open to production.");
