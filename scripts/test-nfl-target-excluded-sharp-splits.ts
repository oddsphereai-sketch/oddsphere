import assert from "node:assert/strict";

import { targetContractPlaybookSplits, targetFreeSharpSplits } from "../lib/services/football/nflTargetExcludedMarketOutcome";
import { buildNflMarketEvidenceOutcomeForecast, getNflV1WeekOneOutcomeForecast } from "../lib/services/football/nflV1WeekOneOutcome";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "../lib/services/football/sharpApiNflSplits";

const row = (provider: "owls" | "sharpapi", sourceSportsbook: string): NflRegularSharpSplit => ({
  provider, providerGameId: "game-1", sourceEventId: "event-1", sourceSportsbook,
  capturedAt: "2026-10-31T20:00:00.000Z", providerFetchedAt: "2026-10-31T19:59:00.000Z",
  homeMoneyPct: 70, awayMoneyPct: 30, homeBetsPct: 40, awayBetsPct: 60,
  overMoneyPct: 65, underMoneyPct: 35, overBetsPct: 45, underBetsPct: 55,
});

for (const provider of ["owls", "sharpapi"] as const) {
  const splits: NflRegularSharpSplitSet = {
    moneyline: row(provider, "circa"), spread: row(provider, "circa"),
    total: row(provider, "pinnacle"),
  };
  const targetFree = targetFreeSharpSplits(splits, {
    byMarket: { moneyline: "circa", spread: "circa", total: "other" },
    margin: ["circa"], total: ["other"],
  });
  assert.ok(targetFree);
  assert.equal(targetFree.moneyline.sourceSportsbook, "circa");
  assert.equal(targetFree.moneyline.homeMoneyPct, null,
    "an evaluated-book split must lose its value, not merely its book name");
  assert.equal(targetFree.spread.homeBetsPct, null);
  assert.equal(targetFree.total.overMoneyPct, 65,
    "a distinct non-evaluated book remains usable on its own market");
  assert.equal(splits.moneyline.homeMoneyPct, 70, "the original observation remains immutable");
  const excludedTotal = targetFreeSharpSplits(splits, {
    byMarket: { moneyline: "other", spread: "other", total: "pinnacle" },
    margin: ["other"], total: ["pinnacle"],
  });
  assert.equal(excludedTotal?.total.overMoneyPct, null,
    "the Total reader cannot consume self-evaluated money/ticket percentages");
  assert.equal(excludedTotal?.moneyline.homeMoneyPct, 70);

  const contractSplits = { ...splits,
    spread: { ...splits.spread, sourceLine: 3.5 },
    total: { ...splits.total, sourceLine: 46.5 },
  };
  const target = {
    byMarket: { moneyline: "other", spread: "other", total: "other" },
    margin: ["other"], total: ["other"], contractLines: { homeSpread: 3.5, total: 46 },
  };
  assert.equal(targetFreeSharpSplits(contractSplits, target)?.total.overMoneyPct, null,
    "a source split at 46.5 cannot direct the selected 46 contract even when its book is target-free");
  assert.equal(targetFreeSharpSplits(contractSplits, target)?.spread.homeMoneyPct, 70);
  assert.equal(targetFreeSharpSplits(contractSplits, { ...target,
    contractLines: { homeSpread: 3, total: 46.5 } })?.spread.homeMoneyPct, null);
  assert.equal(targetFreeSharpSplits(contractSplits, { ...target,
    contractLines: { homeSpread: 3, total: 46.5 } })?.total.overMoneyPct, 65);
  assert.equal(targetFreeSharpSplits(splits, target)?.total.overMoneyPct, null,
    "unknown source line is not exact-contract evidence");
}

const publicRow = { provider: "playbook" as const, capturedAt: "2026-08-25T11:20:00.000Z", booksUsed: 4,
  homeMoneyPct: 70, awayMoneyPct: 30, homeBetsPct: 40, awayBetsPct: 60,
  overMoneyPct: 70, underMoneyPct: 30, overBetsPct: 40, underBetsPct: 60 };
const publicSplits = { moneyline: publicRow, spread: publicRow, total: publicRow };
const publicLine = { provider: "playbook" as const, capturedAt: publicRow.capturedAt,
  homeSpread: 3.5, awaySpread: -3.5, total: 46, homeMoneyline: 120, awayMoneyline: -140, sourceTier: null };
const maskedPublic = targetContractPlaybookSplits(publicSplits, publicLine, { homeSpread: 3.5, total: 46.5 });
assert.equal(maskedPublic?.total.overMoneyPct, null);
assert.equal(maskedPublic?.spread.homeMoneyPct, 70);
assert.equal(maskedPublic?.moneyline.homeMoneyPct, 70,
  "split line mismatch does not erase a distinct moneyline observation");
assert.equal(publicSplits.total.overMoneyPct, 70, "contract qualification cannot mutate captured source values");
const forecastArgs = {
  baseForecast: getNflV1WeekOneOutcomeForecast({ providerGameId: "1392216", awayTeam: "NE", homeTeam: "SEA" }),
  footballHomeMargin: -3.5,
  current: { providerGameId: "1392216", sportsbook: "target-excluded-consensus", observedAt: "2026-08-25T11:21:34.519Z",
    spread: { homeLine: 3.5, awayLine: -3.5, homePrice: -110, awayPrice: -110 },
    total: { line: 46.5, overPrice: -110, underPrice: -110 }, moneyline: null },
  playbookLine: publicLine, playbookSplits: publicSplits, sharpSplits: null,
  evaluatedAt: "2026-08-25T11:21:34.519Z",
};
const selectedContractOutcome = buildNflMarketEvidenceOutcomeForecast({ ...forecastArgs,
  splitContractCurrent: { spread: { homeLine: 3.5 }, total: { line: 46 } } });
const mismatchedContractOutcome = buildNflMarketEvidenceOutcomeForecast({ ...forecastArgs,
  splitContractCurrent: { spread: { homeLine: 3.5 }, total: { line: 46.5 } } });
assert.equal(selectedContractOutcome.marketEvidence?.publicConsensus.overTotalGapPp, 30,
  "public evidence matches the actual selected contract rather than a different synthetic anchor level");
assert.equal(mismatchedContractOutcome.marketEvidence?.publicConsensus.overTotalGapPp, null,
  "a public split at 46 cannot direct an evaluated 46.5 contract");

console.log("NFL target-excluded split-value isolation tests passed");
