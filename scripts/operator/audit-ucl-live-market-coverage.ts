/** Read-only UCL provider coverage diagnostic. Makes no database writes. */
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import {
  SharpApiUclMarketProvider,
  type UclSharpFixtureMarket,
} from "../../lib/providers/real_api/SharpApiUclMarketProvider";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";

const MARKET_NAMES = ["match_result", "double_chance", "total", "btts"] as const;

type SharpEvent = {
  id?: string;
  home_team?: string;
  away_team?: string;
  start_time?: string;
  market_count?: number;
};

function coverage(value: UclSharpFixtureMarket) {
  return Object.fromEntries(MARKET_NAMES.map((market) => {
    const rows = value.odds.filter((row) => row.market === market);
    return [market, {
      rows: rows.length,
      books: [...new Set(rows.map((row) => row.sportsbook).filter(Boolean))].sort(),
      events: [...new Set(rows.map((row) => row.provider_event_id).filter(Boolean))].sort(),
      selections: [...new Set(rows.map((row) => row.selection))].sort(),
    }];
  }));
}

async function main() {
  const key = process.env.SHARPAPI_KEY;
  if (!key) throw new Error("SHARPAPI_KEY is required");
  const slate = await buildUclSlate();
  const eventClient = new SharpApiClient(key);
  const eventDates = [...new Set(slate.matches.map((match) => match.kickoff.slice(0, 10)))];
  const eventCatalog = (await Promise.all(eventDates.map(async (date) => {
    const events = await eventClient.fetchAll<SharpEvent>({
      path: "/events",
      query: { sport: "soccer", league: "uefa_-_champions_league", date, limit: 100 },
      maxPages: 8,
    });
    return events.map((event) => ({ date, ...event }));
  }))).flat();
  const sharedProvider = new SharpApiUclMarketProvider(new SharpApiClient(key));
  const rows = [];
  for (const match of slate.matches) {
    const fixture = {
      home: match.homeTeam.short_name,
      away: match.awayTeam.short_name,
      kickoff: match.kickoff,
    };
    const shared = await sharedProvider.loadFixture(fixture);
    const isolated = await new SharpApiUclMarketProvider(new SharpApiClient(key)).loadFixture(fixture);
    rows.push({
      matchId: match.id,
      fixture: `${fixture.away} @ ${fixture.home}`,
      kickoff: fixture.kickoff,
      sharedEventId: shared.eventId,
      shared: coverage(shared),
      isolatedEventId: isolated.eventId,
      isolated: coverage(isolated),
    });
  }
  console.log(JSON.stringify({
    mode: "read_only",
    providerEvents: eventCatalog.map((event) => ({
      id: event.id ?? null,
      home: event.home_team ?? null,
      away: event.away_team ?? null,
      kickoff: event.start_time ?? null,
      marketCount: event.market_count ?? null,
    })),
    fixtures: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
