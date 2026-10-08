import assert from "node:assert/strict";
import {
  buildNflNamedMarketSequenceAuthority,
  NFL_NAMED_MARKET_SEQUENCE_RELEASE,
} from "@/lib/services/football/nflNamedMarketSequence";
import type { NflForwardPlaybookSplitSet } from "@/lib/services/football/nflForwardEvidence";
import type { NflForwardContextFamily } from "@/lib/services/football/nflForwardEvidenceCapture";
import type { NflRegularSharpSplitSet } from "@/lib/services/football/sharpApiNflSplits";

const OPEN = "2026-10-01T12:00:00.000Z";
const MOVE = "2026-10-02T12:00:00.000Z";
const FOLLOW = "2026-10-02T13:00:00.000Z";
const EVALUATED = "2026-10-02T14:00:00.000Z";

function family(source: string, openingHomeLine: number, currentHomeLine: number, at = MOVE): NflForwardContextFamily {
  return [
    source,
    source === "circa" || source === "pinnacle" || source === "bookmaker" ? "s" : "b",
    source === "circa" ? "c" : source === "pinnacle" ? "p" : source === "bookmaker" ? "b" : "n",
    null,
    [OPEN, 0, "f", openingHomeLine, -110, -110],
    [at, 0, "f", currentHomeLine, -110, -110],
  ];
}

function moneylineFamily(source: string, currentHomePrice: number, currentAwayPrice: number): NflForwardContextFamily {
  return [
    source,
    source === "circa" || source === "pinnacle" ? "s" : "b",
    source === "circa" ? "c" : source === "pinnacle" ? "p" : "n",
    null,
    [OPEN, 0, "f", null, -110, -110],
    [MOVE, 0, "f", null, currentAwayPrice, currentHomePrice],
  ];
}

function splits(homeMoneyPct: number, homeBetsPct: number): NflForwardPlaybookSplitSet {
  const value = {
    provider: "playbook" as const,
    capturedAt: EVALUATED,
    booksUsed: 6,
    homeMoneyPct,
    awayMoneyPct: 100 - homeMoneyPct,
    homeBetsPct,
    awayBetsPct: 100 - homeBetsPct,
    overMoneyPct: homeMoneyPct,
    underMoneyPct: 100 - homeMoneyPct,
    overBetsPct: homeBetsPct,
    underBetsPct: 100 - homeBetsPct,
  };
  return { moneyline: value, spread: value, total: value };
}

function sharp(homeMoneyPct: number, homeBetsPct: number): NflRegularSharpSplitSet {
  const value = {
    provider: "sharpapi" as const,
    providerGameId: "game",
    sourceEventId: "event",
    sourceSportsbook: "circa",
    capturedAt: EVALUATED,
    providerFetchedAt: EVALUATED,
    homeMoneyPct,
    awayMoneyPct: 100 - homeMoneyPct,
    homeBetsPct,
    awayBetsPct: 100 - homeBetsPct,
    overMoneyPct: homeMoneyPct,
    underMoneyPct: 100 - homeMoneyPct,
    overBetsPct: homeBetsPct,
    underBetsPct: 100 - homeBetsPct,
  };
  return { moneyline: value, spread: value, total: value };
}

function authority(args: {
  moneyline?: NflForwardContextFamily[];
  spread?: NflForwardContextFamily[];
  playbook?: NflForwardPlaybookSplitSet | null;
  sharp?: NflRegularSharpSplitSet | null;
}) {
  return buildNflNamedMarketSequenceAuthority({
    evaluatedAt: EVALUATED,
    snapshots: [{
      capturedAt: EVALUATED,
      markets: {
        moneyline: { families: args.moneyline ?? [] },
        spread: { families: args.spread ?? [] },
        total: { families: [] },
      },
    }],
    current: { spread: { homeLine: -3.5 }, total: { line: 45 } },
    playbookLine: {
      provider: "playbook",
      capturedAt: EVALUATED,
      sourceTier: null,
      homeMoneyline: -110,
      awayMoneyline: -110,
      homeSpread: -3.5,
      awaySpread: 3.5,
      total: 45,
    },
    playbookSplits: args.playbook ?? null,
    sharpSplits: args.sharp ?? null,
  });
}

const namedHomeSpread = [family("circa", -3, -4), family("pinnacle", -3, -4)];
const sharpConfirmed = authority({ spread: namedHomeSpread, sharp: sharp(65, 45) });
assert.equal(sharpConfirmed.release, NFL_NAMED_MARKET_SEQUENCE_RELEASE);
assert.equal(sharpConfirmed.spreadSide, "home");
assert.equal(sharpConfirmed.reads.spread.reason, "named_move_sharp_flow_confirmed");
assert.equal(sharpConfirmed.totalSide, null, "Total sequence remains audit-only until separately validated");

const opposingSharp = authority({ spread: namedHomeSpread, sharp: sharp(35, 55) });
assert.equal(opposingSharp.spreadSide, null);
assert.equal(opposingSharp.reads.spread.reason, "opposing_fresh_split");

const twoRetailFollowers = authority({
  spread: [...namedHomeSpread, family("fanduel", -3, -4, FOLLOW), family("draftkings", -3, -4, FOLLOW)],
});
assert.equal(twoRetailFollowers.spreadSide, null, "two followers cannot survive exclusion of the eventual target book");

const threeRetailFollowers = authority({
  spread: [
    ...namedHomeSpread,
    family("fanduel", -3, -4, FOLLOW),
    family("draftkings", -3, -4, FOLLOW),
    family("caesars", -3, -4, FOLLOW),
  ],
});
assert.equal(threeRetailFollowers.spreadSide, "home");
assert.equal(threeRetailFollowers.reads.spread.reason, "named_lead_retail_follow");

const namedBuyback = authority({
  spread: namedHomeSpread,
  sharp: sharp(65, 45),
});
namedBuyback.reads.spread.namedSources.sort();
const buyback = buildNflNamedMarketSequenceAuthority({
  evaluatedAt: EVALUATED,
  snapshots: [
    {
      capturedAt: MOVE,
      markets: {
        moneyline: { families: [] }, total: { families: [] },
        spread: { families: [family("circa", -3, -4), family("pinnacle", -3, -4)] },
      },
    },
    {
      capturedAt: EVALUATED,
      markets: {
        moneyline: { families: [] }, total: { families: [] },
        spread: { families: [family("circa", -3, -2.5, EVALUATED), family("pinnacle", -3, -4, EVALUATED)] },
      },
    },
  ],
  current: { spread: { homeLine: -3.5 }, total: { line: 45 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: sharp(65, 45),
});
assert.equal(buyback.spreadSide, null);
assert.equal(buyback.reads.spread.reason, "named_book_disagreement");

const conflictedMoneyline = authority({
  moneyline: [moneylineFamily("circa", -130, 110), moneylineFamily("pinnacle", -130, 110)],
  sharp: sharp(35, 55),
});
assert.equal(conflictedMoneyline.moneylineSide, null);
assert.equal(conflictedMoneyline.reads.moneyline.reason, "opposing_fresh_split");

const futureEvidence = buildNflNamedMarketSequenceAuthority({
  evaluatedAt: EVALUATED,
  snapshots: [{
    capturedAt: "2026-10-02T15:00:00.000Z",
    markets: {
      moneyline: { families: [] },
      spread: { families: [
        family("circa", -3, -4, "2026-10-02T15:00:00.000Z"),
        family("pinnacle", -3, -4, "2026-10-02T15:00:00.000Z"),
      ] },
      total: { families: [] },
    },
  }],
  current: { spread: { homeLine: -3.5 }, total: { line: 45 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: sharp(65, 45),
});
assert.equal(futureEvidence.spreadSide, null, "observations after evaluatedAt must never enter the forecast");

const staleNamedPrices = authority({
  spread: [
    family("circa", -3, -4, "2026-10-02T10:30:00.000Z"),
    family("pinnacle", -3, -4, "2026-10-02T10:30:00.000Z"),
  ],
  sharp: sharp(65, 45),
});
assert.equal(staleNamedPrices.spreadSide, null, "named price trails older than two hours are neutral");

console.log("NFL named market sequence tests passed.");
