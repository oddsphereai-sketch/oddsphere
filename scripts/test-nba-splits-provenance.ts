import assert from "node:assert/strict";
import {
  matchSplitsRow,
  type NbaSplitsRow,
} from "../lib/services/nba/nbaSplitsClient";
import {
  matchOpportunitiesForGame,
  type NbaOpportunity,
} from "../lib/services/nba/nbaOpportunitiesClient";
import {
  publicSplitsDisplaySupported,
  publicSplitsSupported,
} from "../lib/config/publicSplitsCapability";

function row(args: {
  sportsbook: string;
  fetchedAt: string;
  handleAvailable: boolean;
}): NbaSplitsRow {
  const paired = args.handleAvailable ? { home: 0.57, away: 0.43 } : null;
  return {
    event_id: `nba_${args.sportsbook}`,
    home_team: "Denver Nuggets",
    away_team: "Sacramento Kings",
    sportsbook: args.sportsbook,
    fetched_at: args.fetchedAt,
    ml: {
      home_odds_american: -180,
      away_odds_american: 155,
      bets_pct: { home: 0.62, away: 0.38 },
      handle_pct: paired,
    },
    spread: {
      home_line: -4.5,
      bets_pct: { home: 0.60, away: 0.40 },
      handle_pct: paired,
    },
    total: {
      line: 229.5,
      bets_pct: { over: 0.55, under: 0.45 },
      handle_pct: args.handleAvailable ? { over: 0.51, under: 0.49 } : null,
    },
  };
}

const betMgm = row({
  sportsbook: "betmgm",
  fetchedAt: "2026-10-15T16:00:00Z",
  handleAvailable: false,
});
const draftKings = row({
  sportsbook: "draftkings",
  fetchedAt: "2026-10-15T15:55:00Z",
  handleAvailable: true,
});
assert.equal(
  matchSplitsRow([betMgm, draftKings], "DEN", "SAC")?.sportsbook,
  "draftkings",
  "the selected split row must prefer same-book ticket+handle evidence without collapsing books",
);

const aliasMatchups = [
  { databaseAway: "GS", databaseHome: "LAL", providerAway: "Golden State Warriors", providerHome: "Los Angeles Lakers" },
  { databaseAway: "NO", databaseHome: "NY", providerAway: "New Orleans Pelicans", providerHome: "New York Knicks" },
  { databaseAway: "OKC", databaseHome: "SA", providerAway: "Oklahoma City Thunder", providerHome: "San Antonio Spurs" },
  { databaseAway: "UTAH", databaseHome: "WSH", providerAway: "Utah Jazz", providerHome: "Washington Wizards" },
] as const;

function matchupRow(providerAway: string, providerHome: string): NbaSplitsRow {
  return {
    ...draftKings,
    event_id: `${providerAway}@${providerHome}`,
    away_team: providerAway,
    home_team: providerHome,
  };
}

function matchupOpportunity(providerAway: string, providerHome: string): NbaOpportunity {
  return {
    id: `${providerAway}@${providerHome}`,
    event_id: `${providerAway}@${providerHome}`,
    event_name: null,
    away_team: providerAway,
    home_team: providerHome,
    market_type: "moneyline",
    side: "home",
    line: null,
    sportsbook: "draftkings",
    sharp_book: "circa",
    odds_american: -110,
    no_vig_odds_american: -105,
    fair_probability: 0.51,
    ev_percentage: 1,
    kelly_percent: 0,
    confidence: 0.5,
    market_width: 0.02,
    cross_ref_count: 3,
    cross_ref_dispersion: 0.01,
    book_count: 4,
    oldest_odds_age_seconds: 60,
    possibly_stale: false,
    is_alternate_line: false,
    is_live: false,
    detected_at: "2026-10-16T16:00:00Z",
    warnings: [],
    devig_method: "multiplicative",
    display_selection: providerHome,
  };
}

for (const matchup of aliasMatchups) {
  assert.ok(
    matchSplitsRow(
      [matchupRow(matchup.providerAway, matchup.providerHome)],
      matchup.databaseHome,
      matchup.databaseAway,
    ),
    `split matching must canonicalize ${matchup.databaseAway}@${matchup.databaseHome}`,
  );
  assert.equal(
    matchOpportunitiesForGame(
      [matchupOpportunity(matchup.providerAway, matchup.providerHome)],
      matchup.databaseHome,
      matchup.databaseAway,
    ).length,
    1,
    `opportunity matching must canonicalize ${matchup.databaseAway}@${matchup.databaseHome}`,
  );
}
assert.equal(
  publicSplitsSupported("nba"),
  false,
  "NBA split observations must remain model-ineligible until immutable forward validation clears",
);
assert.equal(
  publicSplitsDisplaySupported("nba"),
  true,
  "the separately audited NBA Playbook pairs may render without granting model authority",
);

console.log("NBA sportsbook split provenance and observe-only boundary tests passed.");
