import assert from "node:assert/strict";

import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import {
  NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE,
  resolveApprovedNbaLegacyLockedEvidenceRecovery,
  type NbaLockedMemberRecord,
} from "../lib/services/nba/nbaLockedMemberSnapshot";
import { buildApprovedNbaLegacyLockedMemberGameEvidence } from "../lib/services/nba/nbaMemberMarketEvidence";
import type { NbaReaderPriceRow } from "../lib/services/nba/nbaProfessionalMarketReader";

const capturedAt = "2026-10-20T18:00:59.148Z";
const lockedAt = "2026-10-20T18:00:59.937Z";

function intel(
  market: "moneyline" | "spread" | "total",
  side: "away" | "over",
  line: number | null,
  price: number,
  sportsbook: string,
) {
  return {
    market,
    pick_side: side,
    consensus_line: line,
    current_price: {
      odds_american: price,
      sportsbook,
      fetched_at: market === "moneyline" ? "2026-10-17T16:42:42.205Z" : "2026-10-20T18:00:30.260Z",
    },
  };
}

const game = {
  game_external_id: 401909088,
  matchup: "BOS @ DET",
  home_abbr: "DET",
  away_abbr: "BOS",
  intelligence: {
    ml: intel("moneyline", "away", null, -105, "ballybet"),
    spread: intel("spread", "away", -1.5, -102, "novig"),
    total: intel("total", "over", 220.5, -106, "novig"),
  },
} as unknown as NbaDailyEdgeGameDto;

const splitByMarket = {
  moneyline: { picked_side: "away", picked_handle_pct: 0.91, picked_bets_pct: 0.86, opp_handle_pct: 0.09, opp_bets_pct: 0.14 },
  spread: { picked_side: "away", picked_handle_pct: 0.90, picked_bets_pct: 0.86, opp_handle_pct: 0.10, opp_bets_pct: 0.14 },
  total: { picked_side: "over", picked_handle_pct: 0.80, picked_bets_pct: 0.69, opp_handle_pct: 0.20, opp_bets_pct: 0.31 },
} as const;

const rows: NbaLockedMemberRecord[] = (["moneyline", "spread", "total"] as const).map((market) => ({
  game_id: 140067,
  market,
  locked_at: lockedAt,
  snapshot_json: {
    as_of: capturedAt,
    splits_state: "available",
    public_splits: splitByMarket[market],
    nba_game_dto_at_capture: game,
  },
}));
const rowsBefore = JSON.stringify(rows);

const recovery = resolveApprovedNbaLegacyLockedEvidenceRecovery({ game, gameId: 140067, rows });
assert.ok(recovery);
assert.equal(recovery.release, NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE);
assert.equal(recovery.lockedAt, lockedAt);
assert.equal(recovery.capturedAt, capturedAt);
assert.deepEqual(
  recovery.publicSplits.moneyline.map((row) => [row.side, row.betsPct, row.moneyPct]),
  [["away", 86, 91], ["home", 14, 9]],
);
assert.deepEqual(
  recovery.publicSplits.spread.map((row) => [row.side, row.betsPct, row.moneyPct]),
  [["away", 86, 90], ["home", 14, 10]],
);
assert.deepEqual(
  recovery.publicSplits.total.map((row) => [row.side, row.betsPct, row.moneyPct]),
  [["over", 69, 80], ["under", 31, 20]],
);
assert.equal(JSON.stringify(rows), rowsBefore, "read-time recovery cannot mutate immutable records");

function price(args: {
  market: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  sportsbook: string;
  americanPrice: number;
  line: number | null;
  at: string;
}): NbaReaderPriceRow {
  return {
    market: args.market,
    sportsbook: args.sportsbook,
    sharpBook: false,
    selectionKey: `401909088:${args.market}:${args.side}`,
    americanPrice: args.americanPrice,
    line: args.line,
    providerTimestamp: args.at,
    fetchedAt: args.at,
  };
}

const priceRows: NbaReaderPriceRow[] = [
  price({ market: "moneyline", side: "away", sportsbook: "ballybet", americanPrice: 100, line: null, at: "2026-10-16T13:12:43Z" }),
  price({ market: "moneyline", side: "home", sportsbook: "ballybet", americanPrice: -122, line: null, at: "2026-10-16T13:12:43Z" }),
  price({ market: "spread", side: "away", sportsbook: "novig", americanPrice: -111, line: 1.5, at: "2026-10-16T13:12:46Z" }),
  price({ market: "spread", side: "home", sportsbook: "novig", americanPrice: 102, line: -1.5, at: "2026-10-16T13:12:46Z" }),
  price({ market: "total", side: "over", sportsbook: "novig", americanPrice: 106, line: 222.5, at: "2026-10-16T13:12:48Z" }),
  price({ market: "total", side: "under", sportsbook: "novig", americanPrice: -113, line: 222.5, at: "2026-10-16T13:12:48Z" }),
  price({ market: "moneyline", side: "away", sportsbook: "ballybet", americanPrice: 999, line: null, at: "2026-10-20T18:01:00Z" }),
  price({ market: "spread", side: "home", sportsbook: "novig", americanPrice: 999, line: 1.5, at: "2026-10-20T18:01:00Z" }),
  price({ market: "total", side: "under", sportsbook: "novig", americanPrice: 999, line: 220.5, at: "2026-10-20T18:01:00Z" }),
];

const evidence = buildApprovedNbaLegacyLockedMemberGameEvidence({ game, priceRows, recovery });
for (const market of ["moneyline", "spread", "total"] as const) {
  assert.equal(evidence[market].evidenceRecoveryRelease, NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE);
  assert.equal(evidence[market].publicSplits.length, 2);
  assert.equal(evidence[market].sharpBookAvailability.status, "provider_limited");
  assert.equal(evidence[market].oddsTrail.some((stop) => stop.american === 999), false, `${market} selected trail must reject post-lock rows`);
  assert.equal(evidence[market].opposingOddsTrail?.stops.some((stop) => stop.american === 999), false, `${market} opposing trail must reject post-lock rows`);
  assert.equal(
    evidence[market].oddsTrail.every((stop) => stop.observedAt !== null && Date.parse(stop.observedAt) <= Date.parse(lockedAt)),
    true,
    `${market} selected trail must stop at lock`,
  );
}
assert.equal(evidence.moneyline.oddsTrail.at(-1)?.american, -105, "stored lock price remains selected terminal authority");
assert.equal(evidence.spread.oddsTrail.at(-1)?.american, -102, "stored spread price remains selected terminal authority");
assert.equal(evidence.total.oddsTrail.at(-1)?.american, -106, "stored total price remains selected terminal authority");
assert.ok(evidence.moneyline.opposingOddsTrail, "moneyline opposing movement should be recovered");
assert.ok(evidence.spread.opposingOddsTrail, "spread opposing movement should be recovered");
assert.ok(evidence.total.opposingOddsTrail, "total opposing movement should be recovered");

assert.equal(resolveApprovedNbaLegacyLockedEvidenceRecovery({
  game: { ...game, game_external_id: 401909089 },
  gameId: 140067,
  rows,
}), null, "the owner exception cannot spread to another legacy card");
assert.throws(() => resolveApprovedNbaLegacyLockedEvidenceRecovery({
  game,
  gameId: 140067,
  rows: rows.slice(0, 2),
}), /exact immutable BOS-DET lock tuple/);

console.log("NBA approved legacy locked evidence recovery tests passed");
