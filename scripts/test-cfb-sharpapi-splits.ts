import assert from "node:assert/strict";
import type { SharpApiRequestOptions, SharpApiResponse } from "../lib/providers/real_api/_sharpApiClient";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import { fetchCfbSharpApiSplits } from "../lib/services/football/cfbSharpApiSplits";

const game: NcaafGame = {
  providerGameId: "457159",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-08-29T23:00:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 1, conferenceId: 1, abbreviation: "HAW", name: "Hawai'i Rainbow Warriors", fbs: true },
  home: { id: 2, conferenceId: 2, abbreviation: "STAN", name: "Stanford Cardinal", fbs: true },
};

async function main(): Promise<void> {
  const draftKings = row({ sportsbook: "draftkings" });
  const circa = row({ sportsbook: "circa", fetched_at: "2026-08-28T12:06:00Z" });
  const client = new StubClient([draftKings, circa, row({ event_id: "ncaaf_other_teams_2026-08-29", away_team: "Other", home_team: "Teams" })]);
  const result = await fetchCfbSharpApiSplits({ games: [game], client });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.path, "/splits");
  assert.deepEqual(client.calls[0]?.query, { league: "ncaaf", sportsbook: "draftkings,circa", limit: 200 });
  assert.equal(result.requests, 1);
  assert.equal(result.matchedGames, 1);
  assert.equal(result.recordsByGame[game.providerGameId]?.length, 2);
  assert.equal(result.recordsByGame[game.providerGameId]?.[0]?.sportsbook, "circa");
  assert.equal(result.recordsByGame[game.providerGameId]?.[0]?.sourceSemantics, "sharp_adjacent");
  assert.equal(result.recordsByGame[game.providerGameId]?.[1]?.sourceSemantics, "public_recreational");
  assert.deepEqual(result.recordsByGame[game.providerGameId]?.[1]?.spread, {
    awayLine: 4,
    homeLine: -4,
    away: { ticketsPct: 42, moneyPct: 38 },
    home: { ticketsPct: 58, moneyPct: 62 },
  });
  assert.deepEqual(result.recordsByGame[game.providerGameId]?.[1]?.total, {
    line: 48.5,
    over: { ticketsPct: 55, moneyPct: 51 },
    under: { ticketsPct: 45, moneyPct: 49 },
  });

  const wrongDate = await fetchCfbSharpApiSplits({ games: [game], client: new StubClient([row({ event_id: "ncaaf_hawaiirainbowwarriors_stanfordcardinal_2026-08-28" })]) });
  assert.equal(wrongDate.matchedGames, 0, "wrong-date split rows fail closed");

  await assert.rejects(
    fetchCfbSharpApiSplits({ games: [game], client: new StubClient([draftKings, draftKings]) }),
    /Ambiguous SharpAPI draftkings split identity/,
  );
  await assert.rejects(
    fetchCfbSharpApiSplits({ games: [game], client: new StubClient([draftKings], true) }),
    /exceeded the bounded 200-row slate request/,
  );

  const incomplete = await fetchCfbSharpApiSplits({
    games: [game],
    client: new StubClient([row({ total: { line: 48.5, bets_pct: { over: 0.55, under: 0.4 }, handle_pct: { over: 0.51, under: 0.49 } } })]),
  });
  assert.equal(incomplete.recordsByGame[game.providerGameId]?.[0]?.total, null, "non-complementary market fails closed without suppressing the record");

  console.log("CFB SharpAPI strict split matching tests passed.");
}

class StubClient {
  readonly calls: SharpApiRequestOptions[] = [];
  constructor(private readonly rows: unknown[], private readonly hasMore = false) {}
  async fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>> {
    this.calls.push(opts);
    return {
      data: this.rows as T,
      pagination: { limit: 200, offset: 0, count: this.rows.length, total: this.rows.length, has_more: this.hasMore, next_offset: this.hasMore ? 200 : undefined },
    };
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "ncaaf_hawaiirainbowwarriors_stanfordcardinal_2026-08-29",
    sport: "football",
    league: "ncaaf",
    sportsbook: "draftkings",
    away_team: "Hawai'i Rainbow Warriors",
    home_team: "Stanford Cardinal",
    fetched_at: "2026-08-28T12:05:00Z",
    moneyline: {
      away_odds: 152,
      home_odds: -180,
      bets_pct: { away: 0.35, home: 0.65 },
      handle_pct: { away: 0.41, home: 0.59 },
    },
    spread: {
      away_odds: 4,
      home_odds: -4,
      bets_pct: { away: 0.42, home: 0.58 },
      handle_pct: { away: 0.38, home: 0.62 },
    },
    total: {
      line: 48.5,
      bets_pct: { over: 0.55, under: 0.45 },
      handle_pct: { over: 0.51, under: 0.49 },
    },
    ...overrides,
  };
}

void main();
