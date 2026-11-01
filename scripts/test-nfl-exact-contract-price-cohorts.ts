import assert from "node:assert/strict";
import { resolveNflTargetExcludedMarketAnchor as anchor, resolveNflTargetExcludedMarketAxes as axes } from "../lib/services/football/nflTargetExcludedMarketOutcome";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";

const at = "2026-11-01T12:00:00.000Z";
const book = (sportsbook: string, spread: number, total: number, first = -110, second = -110): NflPreviewBookOdds => ({
  providerGameId: "exact-contract-test", sportsbook, observedAt: at,
  moneyline: { homePrice: first, awayPrice: second },
  spread: { homeLine: spread, awayLine: -spread, homePrice: first, awayPrice: second },
  total: { line: total, overPrice: first, underPrice: second },
});
const resolve = (books: NflPreviewBookOdds[], excluded: string[] = []) => anchor({
  books, evaluatedAt: at, marginExcludedSportsbooks: excluded, totalExcludedSportsbooks: excluded,
});
const stitched = [book("a", -1, 44, -900, 900), book("b", -2, 45, 900, -900), book("c", -3, 46, -900, 900)];
assert.equal(resolve(stitched), null,
  "90% probability at other lines must not replace the actual median-line book's 10% probability");

const cohort = [book("a", -3, 46, 900, -900), book("b", -3, 46, 900, -900), book("c", -3, 46, 900, -900)];
const valid = resolve([...stitched, ...cohort.map((row) => ({ ...row, sportsbook: `valid-${row.sportsbook}` }))]);
assert.ok(valid);
assert.equal(valid.homeMargin, 3);
assert.equal(valid.total, 46);
assert.equal(valid.spreadHomeFairProbability, 0.1);
assert.equal(valid.totalOverFairProbability, 0.1);
assert.equal(valid.marginFamilyCount, 4);
assert.equal(valid.totalFamilyCount, 4,
  "family count must describe the quoted cohort rather than every off-line book");

assert.equal(resolve(cohort, ["c"]), null, "target exclusion applies before cohort qualification");
assert.equal(resolve([cohort[0]!, cohort[0]!, cohort[1]!]), null, "duplicate family cannot become corroboration");
assert.equal(resolve([cohort[0]!, cohort[1]!, { ...cohort[2]!, observedAt: "2026-11-01T09:00:00Z" }]), null);
assert.equal(resolve([cohort[0]!, cohort[1]!, { ...cohort[2]!, observedAt: "2026-11-01T12:01:00Z" }]), null);
assert.equal(resolve([cohort[0]!, cohort[1]!, { ...cohort[2]!, spread: { ...cohort[2]!.spread!, awayLine: 4 } }]), null);
assert.equal(resolve([cohort[0]!, cohort[1]!, { ...cohort[2]!, total: { ...cohort[2]!.total!, overPrice: 0 } }]), null);

const tied = [...cohort, ...cohort.map((row) => ({ ...row, sportsbook: `other-${row.sportsbook}`,
  spread: { ...row.spread!, homeLine: -4, awayLine: 4 }, total: { ...row.total!, line: 48 } }))];
assert.deepEqual(resolve(tied), resolve([...tied].reverse()), "cohort choice must not depend on provider row order");
const axesAt = (books: NflPreviewBookOdds[], excluded: string[] = []) => axes({
  books, evaluatedAt: at, marginExcludedSportsbooks: excluded, totalExcludedSportsbooks: excluded,
});
const marginOnly = cohort.map((row, i) => ({ ...row, total: { ...row.total!, line: 44 + i } }));
assert.ok(axesAt(marginOnly).margin, "valid Spread cohort survives missing Total cohort");
assert.equal(axesAt(marginOnly).total, null, "missing Total evidence must remain missing");
assert.equal(resolve(marginOnly), null, "legacy combined consumer still requires both real axes");
const totalOnly = cohort.map((row, i) => ({ ...row, spread: { ...row.spread!, homeLine: -i - 1, awayLine: i + 1 } }));
assert.ok(axesAt(totalOnly).total, "valid Total cohort survives missing Spread cohort");
assert.equal(axesAt(totalOnly).margin, null);
const invalidUnrelatedTotal = cohort.map((row) => ({ ...row, total: { ...row.total!, overPrice: 0 } }));
assert.ok(axesAt(invalidUnrelatedTotal).margin, "malformed Total cannot erase valid Spread evidence");
assert.equal(axesAt(invalidUnrelatedTotal).total, null);
const invalidUnrelatedSpread = cohort.map((row) => ({ ...row, spread: { ...row.spread!, awayLine: 5 } }));
assert.ok(axesAt(invalidUnrelatedSpread).total, "malformed Spread cannot erase valid Total evidence");
assert.equal(axesAt(invalidUnrelatedSpread).margin, null);
assert.deepEqual(axesAt(cohort, ["c"]), { margin: null, total: null });
assert.deepEqual(axesAt([cohort[0]!, cohort[0]!, cohort[1]!]), { margin: null, total: null });
assert.deepEqual(axesAt(cohort.map((row) => ({ ...row, observedAt: "2026-11-01T09:00:00Z" }))), { margin: null, total: null });
console.log("NFL exact-contract price cohorts: cross-line direction, source counts, exclusion, clocks and pair coherence passed");
