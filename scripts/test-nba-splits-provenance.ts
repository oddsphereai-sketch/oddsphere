import assert from "node:assert/strict";
import {
  matchSplitsRow,
  type NbaSplitsRow,
} from "../lib/services/nba/nbaSplitsClient";
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
