import assert from "node:assert/strict";

import {
  MARKET_BRAIN_CANONICAL_JSON_RELEASE,
  marketBrainCanonicalJson,
  marketBrainSha256,
} from "../lib/services/marketBrain/marketBrainCanonical";

const vector = { "ä": 1, Z: -0, a: 2, "😀": 3, "\uD800": 4 };
const expectedJson = "{\"Z\":0,\"a\":2,\"ä\":1,\"\\ud800\":4,\"😀\":3}";
const expectedSha256 = "03cafa78ea77417a9c2c4c4d4c5dd1c9a2e5a556035092aad3ae6468c0709d01";

assert.equal(MARKET_BRAIN_CANONICAL_JSON_RELEASE,
  "market_brain_canonical_json_2026_10_27_r3_strict_json_domain");
assert.equal(marketBrainCanonicalJson(vector), expectedJson);
assert.equal(marketBrainSha256(vector), expectedSha256);
assert.equal(marketBrainCanonicalJson({ negativeZero: -0, positiveZero: 0 }),
  "{\"negativeZero\":0,\"positiveZero\":0}");
assert.throws(() => marketBrainCanonicalJson(Number.NaN), /finite numbers/);
assert.throws(() => marketBrainCanonicalJson(Number.POSITIVE_INFINITY), /finite numbers/);
assert.throws(() => marketBrainCanonicalJson(Number.NEGATIVE_INFINITY), /finite numbers/);
assert.throws(() => marketBrainCanonicalJson(undefined), /cannot encode undefined/);
assert.throws(() => marketBrainCanonicalJson(BigInt(1)), /cannot encode bigint/);
assert.throws(() => marketBrainCanonicalJson(Symbol("x")), /cannot encode symbol/);
const symbolKey = Symbol("key");
assert.throws(() => marketBrainCanonicalJson({ [symbolKey]: 1 }), /cannot encode symbol keys/);
assert.throws(() => marketBrainCanonicalJson(() => undefined), /cannot encode function/);
assert.throws(() => marketBrainCanonicalJson(new Date()), /only plain objects and arrays/);
assert.throws(() => marketBrainCanonicalJson(new Map()), /only plain objects and arrays/);
assert.throws(() => marketBrainCanonicalJson(new Set()), /only plain objects and arrays/);
assert.throws(() => marketBrainCanonicalJson(new Uint8Array([1])), /only plain objects and arrays/);
assert.throws(() => marketBrainCanonicalJson(Array(1)), /dense arrays/);
const cyclic: { self?: unknown } = {};
cyclic.self = cyclic;
assert.throws(() => marketBrainCanonicalJson(cyclic), /cannot encode cycles/);
const accessor = {};
Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
assert.throws(() => marketBrainCanonicalJson(accessor), /enumerable data properties/);

const originalLocaleCompare = String.prototype.localeCompare;
try {
  String.prototype.localeCompare = () => { throw new Error("locale-dependent ordering was invoked"); };
  assert.equal(marketBrainCanonicalJson(vector), expectedJson,
    "canonical ordering must not call localeCompare");
} finally {
  String.prototype.localeCompare = originalLocaleCompare;
}

console.log("Market Brain canonical JSON UTF-16 ordering, numeric policy, and golden hash vectors passed.");
