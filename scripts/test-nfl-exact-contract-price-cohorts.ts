import assert from "node:assert/strict";
import { resolveNflTargetExcludedMarketAnchor as anchor, resolveNflTargetExcludedMarketAxes as axes, resolveNflTargetExcludedMoneylineAnchor as moneylineAnchor } from "../lib/services/football/nflTargetExcludedMarketOutcome";
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

// Named current pairs are forecast evidence even though they cannot be executed.
const atlRetail = [book("caesars", -2.5, 43), book("betmgm", -2.5, 43), book("fanatics", -2.5, 43),
  book("fanduel", -2.5, 43.5), book("draftkings", -2.5, 43.5), book("betrivers", -2.5, 42.5)];
const atlNamed = [book("circa", -2.5, 43), book("pinnacle", -2.5, 43)].map((row) => ({
  ...row, targetEligible: false, provider: "owls" as const,
  marketObservedAt: { moneyline: at, spread: at, total: at },
}));
assert.equal(axesAt(atlRetail, ["caesars"]).total, null);
const atlCombined = axesAt([...atlRetail, ...atlNamed], ["caesars"]);
assert.equal(atlCombined.total?.total, 43);
assert.equal(atlCombined.total?.totalFamilyCount, 4);
assert.equal(atlCombined.total?.totalOverFairProbability, 0.5);
assert.deepEqual(atlCombined.total?.totalExcludedSportsbooks, ["caesars"]);
assert.equal(atlNamed.every((row) => row.targetEligible === false), true,
  "forecast evidence cannot turn capture-only named quotes into executable offers");
assert.equal(axesAt([...atlRetail, ...atlNamed, { ...atlNamed[0]!, sportsbook: "CIR-CA" }], ["caesars"])
  .total?.totalFamilyCount, 4, "canonical aliases cannot inflate the family count");
for (const badAt of ["2026-11-01T09:00:00Z", "2026-11-01T12:01:00Z"]) {
  const wrongClock = atlNamed.map((row) => ({ ...row, observedAt: at,
    marketObservedAt: { moneyline: at, spread: at, total: badAt } }));
  assert.equal(axesAt([...atlRetail, ...wrongClock], ["caesars"]).total, null,
    "fresh top-level/other-market clocks cannot refresh stale or future named Total pairs");
  assert.ok(axesAt([...atlRetail, ...wrongClock], ["caesars"]).margin,
    "bad Total timestamps cannot erase valid Spread pairs");
  const wrongMarginClock = cohort.map((row) => ({ ...row,
    marketObservedAt: { moneyline: badAt, spread: badAt, total: at } }));
  assert.equal(axesAt(wrongMarginClock).margin, null);
  assert.ok(axesAt(wrongMarginClock).total);
  assert.equal(moneylineAnchor({ books: wrongMarginClock, excludedSportsbooks: [], evaluatedAt: at }), null,
    "Moneyline uses its own original source timestamp");
}
const priorAt = "2026-11-01T11:30:00Z";
const oldFresh = cohort.map((row) => ({ ...row, observedAt: priorAt }));
const partial = { ...cohort[0]!, spread: null, total: null };
assert.ok(axesAt([...oldFresh, partial]).margin);
assert.ok(axesAt([...oldFresh, partial]).total,
  "newer ML-only observation cannot erase an older fresh Total pair from that family");
const malformedNewer = { ...cohort[0]!, spread: { ...cohort[0]!.spread!, awayLine: 99 },
  total: { ...cohort[0]!.total!, overPrice: 0 }, moneyline: { homePrice: 0, awayPrice: -110 } };
assert.ok(axesAt([...oldFresh, malformedNewer]).margin);
assert.ok(axesAt([...oldFresh, malformedNewer]).total);
assert.equal(moneylineAnchor({ books: [...oldFresh, malformedNewer], excludedSportsbooks: [], evaluatedAt: at })?.familyCount, 3,
  "invalid newer observation cannot erase an intact fresh same-family ML pair");
const axisClocks = { ...cohort[0]!, observedAt: at,
  marketObservedAt: { spread: priorAt, total: at, moneyline: priorAt },
  spread: { ...cohort[0]!.spread!, homeLine: -7, awayLine: 7 },
  moneyline: { homePrice: -900, awayPrice: 900 } };
const actualNewerSpread = { ...cohort[0]!, observedAt: priorAt,
  marketObservedAt: { spread: "2026-11-01T11:45:00Z", moneyline: "2026-11-01T11:45:00Z" } };
assert.equal(axesAt([axisClocks, actualNewerSpread, ...cohort.slice(1)]).margin?.homeMargin, 3,
  "family dedup selects newest Spread source clock rather than composite book clock");
assert.equal(moneylineAnchor({ books: [axisClocks, actualNewerSpread, ...cohort.slice(1)],
  excludedSportsbooks: [], evaluatedAt: at })?.homeFairProbability, 0.1);
const halfPairA = { ...cohort[0]!, total: { line: 46, overPrice: -110, underPrice: 0 } };
const halfPairB = { ...halfPairA, total: { line: 46, overPrice: 0, underPrice: -110 } };
assert.equal(axesAt([halfPairA, halfPairB, ...cohort.slice(1)]).total, null,
  "opposing prices from different incomplete observations are never combined");
console.log("NFL named paired-price authority: exact ATL cohort, original per-market clocks, partial rows and family dedup passed");

assert.equal(moneylineAnchor({ books: [cohort[0]!, { ...cohort[0]!, sportsbook: "A!" }, cohort[1]!],
  excludedSportsbooks: [], evaluatedAt: at }), null, "ML family aliases count once");
assert.equal(moneylineAnchor({ books: cohort, excludedSportsbooks: ["C!"], evaluatedAt: at }), null,
  "ML target exclusion applies before family qualification");
const sameClockAlternatives = [...cohort, { ...cohort[0]!,
  total: { line: 47, overPrice: -110, underPrice: -110 } }];
assert.deepEqual(axesAt(sameClockAlternatives), axesAt([...sameClockAlternatives].reverse()),
  "conflicting same-clock complete observations resolve deterministically without pair splicing");
