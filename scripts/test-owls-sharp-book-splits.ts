import assert from "node:assert/strict";
import { OwlsInsightAuthError, OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookSplits,
  selectCompleteNamedBookSplit,
  type RawOwlsSplitsResponse,
} from "../lib/providers/owls/owlsSharpBookSplits";
import { mapOwlsCurrentSplitRows } from "../lib/providers/owls/owlsCurrentSplits";
import { __TEST__ as currentSplitTest } from "../lib/providers/real_api/sharpApiCurrentSplits";

const observedAt = "2026-10-27T20:07:53.171Z";
const fixture: RawOwlsSplitsResponse = {
  sport: "nba",
  data: [{
    event_id: "nba:Away@Home-20261027",
    home_team: "Home",
    away_team: "Away",
    splits: [
      {
        book: "circa",
        as_of: observedAt,
        moneyline: {
          away_price: 130,
          home_price: -150,
          away_handle_pct: 36,
          home_handle_pct: 64,
          away_bets_pct: 42,
          home_bets_pct: 58,
        },
        spread: {
          away_line: 3.5,
          home_line: -3.5,
          away_handle_pct: 44,
          home_handle_pct: 56,
          away_bets_pct: 47,
          home_bets_pct: 53,
        },
        total: {
          line: 224.5,
          over_handle_pct: 61,
          under_handle_pct: 39,
          over_bets_pct: 55,
          under_bets_pct: 45,
        },
      },
      {
        book: "betmgm",
        as_of: observedAt,
        moneyline: { away_bets_pct: 51, home_bets_pct: 49 },
      },
    ],
  }],
  meta: {
    books: ["circa", "betmgm"],
    total_games: 1,
    status: "partial",
    partial_reason: "book_unavailable",
  },
};

const normalized = normalizeOwlsSharpBookSplits(fixture, "nba");
assert.equal(normalized.feedStatus, "partial");
assert.deepEqual(normalized.advertisedBooks, ["circa", "betmgm"]);
assert.equal(normalized.eventCount, 1);
assert.equal(normalized.rejected.length, 0);
assert.equal(normalized.observations.filter((row) => row.sourceBook === "circa").length, 6);
assert.equal(normalized.observations.filter((row) => row.sourceBook === "circa" && row.complete).length, 6);
assert.equal(normalized.observations.filter((row) => row.sourceBook === "betmgm" && row.complete).length, 0);

const selected = selectCompleteNamedBookSplit(normalized.observations, {
  providerEventId: "nba:Away@Home-20261027",
  market: "moneyline",
  nowMs: Date.parse("2026-10-27T20:10:00.000Z"),
});
assert.equal(selected.length, 2);
assert.ok(selected.every((row) => row.sourceBook === "circa"));
assert.deepEqual(selected.map((row) => row.side), ["away", "home"]);

const stale = selectCompleteNamedBookSplit(normalized.observations, {
  providerEventId: "nba:Away@Home-20261027",
  market: "moneyline",
  nowMs: Date.parse("2026-10-28T00:00:00.000Z"),
});
assert.deepEqual(stale, []);

const malformed = normalizeOwlsSharpBookSplits({
  data: [{
    event_id: "nba:Bad@Sum-20261027",
    home_team: "Sum",
    away_team: "Bad",
    splits: [{
      book: "circa",
      as_of: observedAt,
      moneyline: {
        away_handle_pct: 80,
        home_handle_pct: 50,
        away_bets_pct: 20,
        home_bets_pct: 80,
      },
    }],
  }],
}, "nba");
assert.equal(malformed.observations.length, 0);
assert.match(malformed.rejected[0] ?? "", /do not sum to 100%/);

const wrongSport = normalizeOwlsSharpBookSplits({ ...fixture, sport: "nhl" }, "nba");
assert.equal(wrongSport.observations.length, 0);
assert.match(wrongSport.rejected[0] ?? "", /does not match requested sport/);

const future = selectCompleteNamedBookSplit(normalized.observations, {
  providerEventId: "nba:Away@Home-20261027",
  market: "moneyline",
  nowMs: Date.parse("2026-10-27T19:00:00.000Z"),
});
assert.deepEqual(future, []);

const onePercentRows = mapOwlsCurrentSplitRows("cfb", {
  sport: "ncaaf",
  data: [{
    event_id: "ncaaf:Away@Home-20261027",
    away_team: "Away",
    home_team: "Home",
    splits: [{
      book: "circa",
      as_of: observedAt,
      moneyline: {
        away_handle_pct: 1,
        home_handle_pct: 99,
        away_bets_pct: 1,
        home_bets_pct: 99,
      },
    }],
  }],
});
assert.deepEqual(
  (onePercentRows[0]?.moneyline as { handle_pct?: unknown } | undefined)?.handle_pct,
  { away: 0.01, home: 0.99 },
  "Owls whole-number percentages must not turn 1% into 100% in the legacy overlay transport",
);

for (const [providerName, boardAbbreviation] of [
  ["Brooklyn Nets", "BKN"],
  ["Boston Celtics", "BOS"],
  ["Detroit Pistons", "DET"],
  ["New York Knicks", "NY"],
  ["Sacramento Kings", "SAC"],
  ["San Antonio Spurs", "SA"],
  ["Portland Trail Blazers", "POR"],
  ["Los Angeles Lakers", "LAL"],
  ["Philadelphia 76ers", "PHI"],
  ["Indiana Pacers", "IND"],
] as const) {
  assert.equal(
    currentSplitTest.teamMatches("nba", providerName, boardAbbreviation, boardAbbreviation),
    true,
    `Owls NBA full-name identity ${providerName} must match member abbreviation ${boardAbbreviation}`,
  );
}

assert.equal(
  currentSplitTest.teamMatches("wnba", "New York Liberty", "NY", "NY"),
  true,
  "Owls WNBA full-name identity must match the canonical member abbreviation",
);

assert.equal(
  currentSplitTest.rowMatchesGame(
    {
      event_id: "nba:Detroit Pistons@New York Knicks-20261028",
      league: "nba",
      away_team: "Detroit Pistons",
      home_team: "New York Knicks",
    },
    {
      id: "nba-401909878",
      external_id: 401909878,
      sport: "nba",
      awayTeam: "DET",
      awayTeamDisplayName: "DET",
      homeTeam: "NY",
      homeTeamDisplayName: "NY",
      gameStartAt: "2026-10-28T00:00:00.000Z",
      lockState: "open",
      lockedAt: null,
      markets: {},
    } as Parameters<typeof currentSplitTest.rowMatchesGame>[1],
    "2026-10-27",
    "nba",
  ),
  true,
  "Owls UTC-date NBA event ids must match the same ET slate game",
);

async function main(): Promise<void> {
  let requestedAuthorization = "";
  const client = new OwlsInsightClient("test-key", {
    fetchImpl: (async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining-minute": "399",
          "x-ratelimit-remaining-month": "299999",
        },
      });
    }) as typeof fetch,
  });
  const response = await client.splits<RawOwlsSplitsResponse>("nba");
  assert.equal(requestedAuthorization, "Bearer test-key");
  assert.equal(response.rateLimit.remainingMinute, 399);
  assert.equal(response.rateLimit.remainingMonth, 299999);

  const denied = new OwlsInsightClient("secret-must-not-leak", {
    fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch,
  });
  await assert.rejects(
    () => denied.splits("nba"),
    (error: unknown) => error instanceof OwlsInsightAuthError && !error.message.includes("secret-must-not-leak"),
  );

  if (process.argv.includes("--live")) {
    const apiKey = process.env.OWLS_INSIGHT_API_KEY;
    assert.ok(apiKey, "--live requires OWLS_INSIGHT_API_KEY");
    const liveClient = new OwlsInsightClient(apiKey);
    for (const sport of ["mlb", "nba", "wnba", "nfl", "ncaaf", "ncaab", "nhl"] as const) {
      const live = await liveClient.splits<RawOwlsSplitsResponse>(sport);
      const coverage = normalizeOwlsSharpBookSplits(live.body, sport);
      const completeCirca = coverage.observations.filter((row) => row.sourceBook === "circa" && row.complete);
      if (coverage.eventCount > 0) {
        assert.ok(completeCirca.length > 0, `${sport}: current/upcoming events require at least one complete Circa split pair`);
      }
      console.log(JSON.stringify({
        sport,
        status: coverage.feedStatus,
        events: coverage.eventCount,
        books: coverage.advertisedBooks,
        completeCircaObservations: completeCirca.length,
        rejected: coverage.rejected.length,
      }));
    }
    if (process.argv.includes("--props")) {
      for (const sport of ["mlb", "nba", "wnba", "nfl", "ncaaf", "ncaab", "nhl"] as const) {
        const live = await liveClient.props<{ data?: unknown[]; meta?: { status?: unknown } }>(sport);
        console.log(JSON.stringify({
          sport,
          endpoint: "props",
          rows: Array.isArray(live.body.data) ? live.body.data.length : 0,
          status: typeof live.body.meta?.status === "string" ? live.body.meta.status : "unknown",
        }));
      }
    }
  }

  console.log("owls sharp-book split adapter tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
