import assert from "node:assert/strict";
import { withFirstTrackedSplitObservation } from "../lib/services/splitDisplayMovement";

const current = {
  side: "home" as const,
  label: "Home",
  moneyPct: 64,
  betsPct: 41,
  observedAt: "2026-09-05T16:00:00.000Z",
  moneyDeltaPp: null,
  betsDeltaPp: null,
  comparisonObservedAt: null,
};
const firstTracked = {
  moneyPct: 52,
  betsPct: 48,
  observedAt: "2026-09-05T10:00:00.000Z",
};

const display = withFirstTrackedSplitObservation(current, firstTracked);
assert.equal(display.moneyDeltaPp, 12);
assert.equal(display.betsDeltaPp, -7);
assert.equal(display.comparisonObservedAt, firstTracked.observedAt);
assert.equal(display.moneyPct, current.moneyPct);
assert.equal(display.betsPct, current.betsPct);

const noHistory = withFirstTrackedSplitObservation(current, null);
assert.deepEqual(noHistory, current);

console.log("PASS split display compares current money/tickets with the first tracked observation without changing the market read");
