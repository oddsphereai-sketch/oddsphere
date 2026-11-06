import assert from "node:assert/strict";
import { allocation } from "./monthly-cost-report";
const normal = allocation(Array.from({ length: 100 }, () => ({ primary: 0.1, upgrade: 0.9 })));
assert.equal(normal.affordableStrongerFinals, 10);
assert.equal(normal.logicalReviews, 200);
assert.ok(normal.adaptive < 50 && normal.primaryFits);
const tight = allocation(Array.from({ length: 100 }, () => ({ primary: 0.18, upgrade: 1.62 })));
assert.equal(tight.affordableStrongerFinals, 0);
assert.ok(tight.primaryFits && tight.adaptive < 50 && tight.fixedTenPercent > 50);
const impossible = allocation(Array.from({ length: 100 }, () => ({ primary: 0.3, upgrade: 2.7 })));
assert.equal(impossible.primaryFits, false);
assert.equal(impossible.affordableStrongerFinals, 0);
assert.ok(impossible.adaptive > 50); // Failure is explicit; coverage is never silently deleted.
assert.throws(() => allocation([{ primary: -1, upgrade: 0 }]), /Invalid/);
assert.throws(() => allocation([{ primary: NaN, upgrade: 1 }]), /Invalid/);
console.log("Whole-month primary coverage and stronger-allocation bounds passed: no network calls.");
