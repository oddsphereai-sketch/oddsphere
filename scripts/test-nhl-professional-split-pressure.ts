import assert from "node:assert/strict";
import {
  identifiedNhlProfessionalSplits,
  type NhlIdentifiedProfessionalSplit,
  type SharpApiCurrentSplitFeed,
} from "../lib/providers/real_api/sharpApiCurrentSplits";
import { selectNhlProfessionalSplitPressure } from "../lib/services/nhl/nhlProfessionalSplitPressure";

const decisionAt = "2026-11-04T18:00:00.000Z";
const split = (overrides: Partial<NhlIdentifiedProfessionalSplit> = {}): NhlIdentifiedProfessionalSplit => ({
  market: "moneyline",
  sourceBook: "circa",
  observedAt: "2026-11-04T17:00:00.000Z",
  receivedAt: "2026-11-04T17:01:00.000Z",
  awayOrOverMoneyPct: 65,
  awayOrOverBetsPct: 52,
  homeOrUnderMoneyPct: 35,
  homeOrUnderBetsPct: 48,
  ...overrides,
});

const freshFallback = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: [
    split({ sourceBook: "circa", observedAt: "2026-11-04T10:00:00.000Z", receivedAt: "2026-11-04T10:01:00.000Z", awayOrOverMoneyPct: 35, homeOrUnderMoneyPct: 65 }),
    split({ sourceBook: "draftkings", observedAt: "2026-11-04T17:30:00.000Z", receivedAt: "2026-11-04T17:31:00.000Z" }),
  ],
});
assert.equal(freshFallback?.sourceBook, "draftkings", "stale Circa cannot suppress a fresh identified fallback");
assert.equal(freshFallback?.source, "identified_professional_split");

const freshConflict = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: [
    split({ sourceBook: "circa", awayOrOverMoneyPct: 65, awayOrOverBetsPct: 52, homeOrUnderMoneyPct: 35, homeOrUnderBetsPct: 48 }),
    split({ sourceBook: "draftkings", awayOrOverMoneyPct: 35, awayOrOverBetsPct: 48, homeOrUnderMoneyPct: 65, homeOrUnderBetsPct: 52 }),
  ],
});
assert.equal(freshConflict?.source, "identified_professional_conflict");
assert.equal(freshConflict?.confidence, "low");

const futureIgnored = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: [
    split({ sourceBook: "circa", observedAt: "2099-01-01T00:00:00.000Z", receivedAt: "2099-01-01T00:00:01.000Z" }),
    split({ sourceBook: "draftkings", observedAt: "2026-11-04T17:30:00.000Z", receivedAt: "2026-11-04T17:31:00.000Z" }),
  ],
});
assert.equal(futureIgnored?.sourceBook, "draftkings", "a future receipt is quarantined before priority/conflict selection");

const staleObservationCannotBeRenewed = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: [
    split({
      sourceBook: "circa",
      observedAt: "2026-11-01T12:00:00.000Z",
      receivedAt: "2026-11-04T17:59:00.000Z",
    }),
    split({ sourceBook: "draftkings", observedAt: "2026-11-04T17:30:00.000Z", receivedAt: "2026-11-04T17:31:00.000Z" }),
  ],
});
assert.equal(
  staleObservationCannotBeRenewed?.sourceBook,
  "draftkings",
  "a fresh feed receipt cannot renew an old professional split observation",
);

const market = (awayMoney: number, awayBets: number) => ({
  bets_pct: { away: awayBets / 100, home: (100 - awayBets) / 100 },
  handle_pct: { away: awayMoney / 100, home: (100 - awayMoney) / 100 },
});
const extracted = identifiedNhlProfessionalSplits({
  feed: {
    source: "owls_current_splits",
    release: "owls_current_splits_2026_10_27_r1_complete_named_book",
    sport: "nhl",
    fetchedAt: "2026-11-04T17:59:30.000Z",
    rows: [{
      event_id: "nhl-clock-test",
      league: "nhl",
      event_start_time: "2026-11-04T23:00:00.000Z",
      away_team: "Ottawa Senators",
      home_team: "Buffalo Sabres",
      sportsbook: "circa",
      fetched_at: "2026-11-01T12:00:00.000Z",
      _oddsphere_received_at: "2026-11-01T12:00:01.000Z",
      _oddsphere_market_fetched_at: { moneyline: "2026-11-01T12:00:00.000Z" },
      moneyline: market(35, 48),
    }, {
      event_id: "nhl-clock-test",
      league: "nhl",
      event_start_time: "2026-11-04T23:00:00.000Z",
      away_team: "Ottawa Senators",
      home_team: "Buffalo Sabres",
      sportsbook: "draftkings",
      fetched_at: "2026-11-04T17:30:00.000Z",
      _oddsphere_received_at: "2026-11-04T17:30:01.000Z",
      _oddsphere_market_fetched_at: { moneyline: "2026-11-04T17:30:00.000Z" },
      moneyline: market(65, 52),
    }],
  } satisfies SharpApiCurrentSplitFeed,
  slateDate: "2026-11-04",
  gameStartAt: "2026-11-04T23:00:00.000Z",
  awayAbbr: "OTT",
  homeAbbr: "BUF",
  cutoffAt: decisionAt,
});
const extractedPressure = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: extracted,
});
assert.equal(
  extractedPressure?.sourceBook,
  "draftkings",
  "the production extractor preserves each merged row's receipt clock; a new feed envelope cannot renew stale Circa",
);

const withoutProviderStart = identifiedNhlProfessionalSplits({
  feed: {
    source: "owls_current_splits",
    release: "owls_current_splits_2026_10_27_r1_complete_named_book",
    sport: "nhl",
    fetchedAt: "2026-11-04T17:59:30.000Z",
    rows: [{
      event_id: "nhl:Ottawa Senators@Buffalo Sabres-20261105",
      league: "nhl",
      away_team: "Ottawa Senators",
      home_team: "Buffalo Sabres",
      sportsbook: "circa",
      fetched_at: "2026-11-04T17:30:00.000Z",
      _oddsphere_received_at: "2026-11-04T17:30:01.000Z",
      _oddsphere_market_fetched_at: { moneyline: "2026-11-04T17:30:00.000Z" },
      moneyline: market(65, 52),
    }],
  },
  slateDate: "2026-11-04",
  gameStartAt: "2026-11-05T00:30:00.000Z",
  awayAbbr: "OTT",
  homeAbbr: "BUF",
  cutoffAt: decisionAt,
});
assert.equal(withoutProviderStart.length, 1, "an exact provider event-date ID may bind a missing event_start_time");
assert.equal(withoutProviderStart[0]?.sourceBook, "circa");

const wrongProviderDate = identifiedNhlProfessionalSplits({
  feed: {
    source: "owls_current_splits",
    release: "owls_current_splits_2026_10_27_r1_complete_named_book",
    sport: "nhl",
    fetchedAt: "2026-11-04T17:59:30.000Z",
    rows: [{
      event_id: "nhl:Ottawa Senators@Buffalo Sabres-20261106",
      league: "nhl",
      away_team: "Ottawa Senators",
      home_team: "Buffalo Sabres",
      sportsbook: "circa",
      fetched_at: "2026-11-04T17:30:00.000Z",
      _oddsphere_received_at: "2026-11-04T17:30:01.000Z",
      _oddsphere_market_fetched_at: { moneyline: "2026-11-04T17:30:00.000Z" },
      moneyline: market(65, 52),
    }],
  },
  slateDate: "2026-11-04",
  gameStartAt: "2026-11-05T00:30:00.000Z",
  awayAbbr: "OTT",
  homeAbbr: "BUF",
  cutoffAt: decisionAt,
});
assert.equal(wrongProviderDate.length, 0, "an exact-team split for another provider event date must fail closed");

const invalidClockCannotCreateConflict = selectNhlProfessionalSplitPressure({
  market: "moneyline",
  decisionAt,
  splits: [
    split({
      sourceBook: "circa",
      observedAt: "2026-11-04T17:30:00.000Z",
      receivedAt: "2026-11-04T17:00:00.000Z",
      awayOrOverMoneyPct: 35,
      homeOrUnderMoneyPct: 65,
    }),
    split({
      sourceBook: "draftkings",
      observedAt: "2026-11-04T17:30:00.000Z",
      receivedAt: "2026-11-04T17:31:00.000Z",
    }),
  ],
});
assert.equal(invalidClockCannotCreateConflict?.source, "identified_professional_split");
assert.equal(
  invalidClockCannotCreateConflict?.sourceBook,
  "draftkings",
  "a receipt clock preceding its observation is quarantined before priority or conflict selection",
);

console.log("NHL professional split pressure: fresh fallback, conflict veto, distinct-clock and future/stale quarantine passed.");
