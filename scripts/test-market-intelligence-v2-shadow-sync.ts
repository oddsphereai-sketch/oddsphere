import {
  MARKET_INTELLIGENCE_V2_SHADOW_CAPTURE_RELEASE,
  buildOwlsSharpPriceObservations,
  collectCompleteCountedPages,
  assessAdvertisedSharpHistoryCoverage,
  dedupeSharpApiHistorySplitObservations,
  assessSharpApiSplitSlateAlignment,
  classifySharpHistoryFailure,
  fetchSharpHistoryWithRetry,
  findSharpApiSplitGameMatches,
  isSharpApiHistoryUniqueConflict,
  marketIntelligenceGameKey,
  selectNbaRollingMarketGames,
  selectVerifiedSharpApiCurrentRows,
  selectVerifiedSharpApiWindowRows,
  writeRows,
} from "../lib/services/marketIntelligenceV2/shadowSync";
import {
  SharpApiClient,
  SharpApiClientError,
  SharpApiNotFoundError,
  SharpApiRateLimitError,
} from "../lib/providers/real_api/_sharpApiClient";
import type { MarketSplitObservationV2 } from "../lib/types/domain/MarketIntelligenceV2";

let pass = 0;
let fail = 0;
const failures: string[] = [];

check(
  "Market Intelligence V2 exposes the versioned NBA per-book forward capture release",
  MARKET_INTELLIGENCE_V2_SHADOW_CAPTURE_RELEASE ===
    "market_intelligence_v2_capture_2026_10_28_r10_owls_ticket_share_retention",
);

{
  const mapped = buildOwlsSharpPriceObservations({
    sport: "nba",
    fetchedAt: new Date("2026-10-27T22:18:00.000Z"),
    games: [{
      id: 1,
      externalId: 401909878,
      slateDate: "2026-10-27",
      gameDate: "2026-10-28T00:00:00.000Z",
      homeTeamId: 2,
      awayTeamId: 1,
      homeAbbr: "NY",
      awayAbbr: "DET",
      homeName: "New York Knicks",
      awayName: "Detroit Pistons",
    }],
    rows: [{
      sport: "nba",
      providerEventId: "nba:Detroit Pistons@New York Knicks-20261028",
      providerNumericEventId: "123",
      scheduledStart: "2026-10-28T00:10:00.000Z",
      homeTeam: "New York Knicks",
      awayTeam: "Detroit Pistons",
      sportsbook: "circa",
      observedAt: "2026-10-27T22:17:16.758Z",
      market: "spread",
      side: "away",
      line: 4,
      americanPrice: -110,
      decimalPrice: 1.909090909,
      noVigProbability: 0.5,
    }],
  });
  check(
    "Owls sharp price maps full professional team names onto the canonical NBA event",
    mapped.rejected.length === 0 &&
      mapped.observations.length === 1 &&
      mapped.observations[0]?.canonical_event_id === "401909878" &&
      mapped.observations[0]?.sportsbook === "circa" &&
      mapped.observations[0]?.selection_key.endsWith(":away") === true &&
      mapped.observations[0]?.provider_timestamp === "2026-10-27T22:17:16.758Z",
  );
}

{
  const mapped = buildOwlsSharpPriceObservations({
    sport: "nhl",
    fetchedAt: new Date("2026-10-27T22:38:00.000Z"),
    games: [{
      id: 2,
      externalId: 2026020188,
      slateDate: "2026-10-27",
      gameDate: "2026-10-27T23:00:00.000Z",
      homeTeamId: 4,
      awayTeamId: 3,
      homeAbbr: "PHI",
      awayAbbr: "CBJ",
      homeName: "PHI",
      awayName: "CBJ",
    }],
    rows: [{
      sport: "nhl",
      providerEventId: "nhl:Columbus Blue Jackets@Philadelphia Flyers-20261027",
      providerNumericEventId: "456",
      scheduledStart: "2026-10-27T23:00:00.000Z",
      homeTeam: "Philadelphia Flyers",
      awayTeam: "Columbus Blue Jackets",
      sportsbook: "pinnacle",
      observedAt: "2026-10-27T22:37:33.553Z",
      market: "moneyline",
      side: "home",
      line: null,
      americanPrice: -125,
      decimalPrice: 1.8,
      noVigProbability: 0.54,
    }],
  });
  check(
    "Owls sharp price maps full NHL names onto abbreviation-only canonical teams",
    mapped.rejected.length === 0 &&
      mapped.observations.length === 1 &&
      mapped.observations[0]?.canonical_event_id === "2026020188" &&
      mapped.observations[0]?.sportsbook === "pinnacle" &&
      mapped.observations[0]?.provider_timestamp === "2026-10-27T22:37:33.553Z",
  );
}

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

{
  const coverage = assessAdvertisedSharpHistoryCoverage({
    advertisedCanonicalEventIds: [5060059, 5060060],
    historyResults: [
      { canonicalEventId: 5060059, rows: [{ book: "circa" }] },
      { canonicalEventId: 5060060, rows: [] },
    ],
  });
  check(
    "SharpAPI advertised history coverage identifies silent empty-game gaps",
    coverage.expectedGames === 2 &&
      coverage.coveredGames === 1 &&
      coverage.missingEventIds.join(",") === "5060060",
  );
}

{
  const coverage = assessAdvertisedSharpHistoryCoverage({
    advertisedCanonicalEventIds: [5060059],
    historyResults: [
      { canonicalEventId: 5060059, rows: [] },
      { canonicalEventId: "5060059", rows: [{ book: "draftkings" }] },
    ],
  });
  check(
    "SharpAPI advertised history coverage counts bucket and base identities once",
    coverage.expectedGames === 1 && coverage.coveredGames === 1 && coverage.missingEventIds.length === 0,
  );
}

check(
  "MLB key normalizes full team names",
  marketIntelligenceGameKey("mlb", "Houston Astros", "Detroit Tigers") === "HOU@DET",
);
check(
  "NHL key uses the canonical abbreviation registry for provider full names",
  marketIntelligenceGameKey("nhl", "Columbus Blue Jackets", "Philadelphia Flyers") === "CBJ@PHI",
);
check(
  "NHL key resolves the database abbreviation form through the same registry",
  marketIntelligenceGameKey("nhl", "CBJ", "PHI") === "CBJ@PHI",
);

{
  const rows = [
    { event_id: "mlb_marlins_mets_2026-08-14", league: "mlb", away_team: "Miami Marlins", home_team: "New York Mets" },
    { event_id: "mlb_red_sox_yankees_2026-08-14", league: "mlb", away_team: "Boston Red Sox", home_team: "New York Yankees" },
    { event_id: "mlb_brewers_dodgers_2026-08-14", league: "mlb", away_team: "Milwaukee Brewers", home_team: "Los Angeles Dodgers" },
  ];
  const stale = assessSharpApiSplitSlateAlignment(
    rows,
    [{ awayAbbr: "MIL", homeAbbr: "LAD" }],
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    "2026-08-14",
  );
  check(
    "Market Intelligence rejects date-advanced rows whose matchups fit the previous slate",
    !stale.aligned && stale.currentSlateMatches === 1 && stale.previousSlateMatches === 3,
  );
  const aligned = assessSharpApiSplitSlateAlignment(
    rows,
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    [{ awayAbbr: "MIL", homeAbbr: "LAD" }],
    "2026-08-14",
  );
  check(
    "Market Intelligence accepts broad current-slate coverage with a better current fit",
    aligned.aligned && aligned.currentSlateMatches === 3 && aligned.previousSlateMatches === 1,
  );

  const repeatedSeries = assessSharpApiSplitSlateAlignment(
    rows,
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    "2026-08-14",
  );
  check(
    "Market Intelligence accepts an explicitly dated current payload when consecutive-series matchups overlap",
    repeatedSeries.aligned &&
      repeatedSeries.currentSlateMatches === 3 &&
      repeatedSeries.previousSlateMatches === 3 &&
      repeatedSeries.eventDateMatches === 3 &&
      repeatedSeries.eventDateMismatches === 0,
  );

  const wrongDateRepeatedSeries = assessSharpApiSplitSlateAlignment(
    rows,
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    [
      { awayAbbr: "MIA", homeAbbr: "NYM" },
      { awayAbbr: "BOS", homeAbbr: "NYY" },
      { awayAbbr: "MIL", homeAbbr: "LAD" },
    ],
    "2026-08-15",
  );
  check(
    "Market Intelligence still rejects overlapping-series payloads dated for another slate",
    !wrongDateRepeatedSeries.aligned && wrongDateRepeatedSeries.eventDateMismatches === 3,
  );

  const contaminatedCurrentPayload = [
    { event_id: "mlb_orioles_rays_2026-08-17", league: "mlb", away_team: "Baltimore Orioles", home_team: "Tampa Bay Rays" },
    { event_id: "mlb_braves_diamondbacks_2026-08-17", league: "mlb", away_team: "Arizona Diamondbacks", home_team: "Atlanta Braves" },
  ];
  const verifiedRows = selectVerifiedSharpApiCurrentRows(
    contaminatedCurrentPayload,
    [{ awayAbbr: "BAL", homeAbbr: "TB" }],
    "2026-08-17",
  );
  check(
    "Market Intelligence isolates exact-date current matchups from a contaminated provider payload",
    verifiedRows.length === 1 && verifiedRows[0]?.event_id === "mlb_orioles_rays_2026-08-17",
  );
  check(
    "Market Intelligence never recovers a matching matchup stamped with the wrong date",
    selectVerifiedSharpApiCurrentRows(
      [{ ...contaminatedCurrentPayload[0], event_id: "mlb_orioles_rays_2026-08-16" }],
      [{ awayAbbr: "BAL", homeAbbr: "TB" }],
      "2026-08-17",
    ).length === 0,
  );
  check(
    "Market Intelligence recognizes SharpAPI doubleheader bucket ordering",
    selectVerifiedSharpApiCurrentRows(
      [{ event_id: "mlb_cardinals_reds_2026-08-17_b3_g2", league: "mlb", away_team: "St. Louis Cardinals", home_team: "Cincinnati Reds" }],
      [{ awayAbbr: "STL", homeAbbr: "CIN" }],
      "2026-08-17",
    ).length === 1,
  );
}
{
  const games = [
    { slateDate: "2026-10-15", awayAbbr: "DAL", homeAbbr: "LAL" },
    { slateDate: "2026-10-16", awayAbbr: "MIA", homeAbbr: "ORL" },
    { slateDate: "2026-10-20", awayAbbr: "BOS", homeAbbr: "DET" },
    { slateDate: "2026-10-21", awayAbbr: "GSW", homeAbbr: "LAL" },
  ];
  const selectedGames = selectNbaRollingMarketGames(games, "2026-10-15");
  check(
    "NBA rolling market window retains current rehearsal and only future tracking-eligible dates",
    selectedGames.length === 3 &&
      selectedGames.some((game) => game.slateDate === "2026-10-15") &&
      !selectedGames.some((game) => game.slateDate === "2026-10-16") &&
      selectedGames.some((game) => game.slateDate === "2026-10-20"),
  );

  const rows = [
    {
      event_id: "nba_boston_celtics_detroit_pistons_2026-10-20",
      league: "nba",
      away_team: "Boston Celtics",
      home_team: "Detroit Pistons",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_76ers_knicks_2026-10-20_b3",
      league: "nba",
      away_team: "Philadelphia 76ers",
      home_team: "New York Knicks",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_spurs_thunder_2026-10-20_b3",
      league: "nba",
      away_team: "Oklahoma City Thunder",
      home_team: "San Antonio Spurs",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_golden_state_warriors_los_angeles_lakers_2026-10-21",
      league: "nba",
      away_team: "Golden State Warriors",
      home_team: "Los Angeles Lakers",
      sportsbook: "betmgm",
    },
    {
      event_id: "nba_golden_state_warriors_los_angeles_lakers_2026-10-20",
      league: "nba",
      away_team: "Golden State Warriors",
      home_team: "Los Angeles Lakers",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_boston_celtics_detroit_pistons_2026-10-22",
      league: "nba",
      away_team: "Boston Celtics",
      home_team: "Detroit Pistons",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_boston_celtics_detroit_pistons_2026-10-20",
      league: "ncaab",
      away_team: "Boston Celtics",
      home_team: "Detroit Pistons",
      sportsbook: "draftkings",
    },
  ];
  const accepted = selectVerifiedSharpApiWindowRows(
    rows,
    [
      ...selectedGames,
      { slateDate: "2026-10-20", awayAbbr: "PHI", homeAbbr: "NY" },
      { slateDate: "2026-10-20", awayAbbr: "OKC", homeAbbr: "SA" },
    ],
    "2026-10-15",
    "2026-10-21",
    "nba",
  );
  check(
    "NBA rolling provider selection requires exact league, event date, and matchup inside the window",
    accepted.length === 4 &&
      accepted.filter((row) => String(row.event_id).includes("2026-10-20")).length === 3 &&
      accepted.some((row) => String(row.event_id).includes("2026-10-21")),
  );
}
check(
  "MLB key rejects unknown teams",
  marketIntelligenceGameKey("mlb", "Not A Team", "Detroit Tigers") === null,
);
{
  const doubleheader = [
    { gameDate: "2026-08-17T17:40:00Z", id: "g1" },
    { gameDate: "2026-08-17T22:40:00Z", id: "g2" },
  ];
  check(
    "SharpAPI unsuffixed doubleheader splits fail closed instead of copying to both games",
    findSharpApiSplitGameMatches(doubleheader, "mlb_cardinals_reds_2026-08-17").length === 0,
  );
  check(
    "SharpAPI exact Game 1 split identity maps only to the first game",
    findSharpApiSplitGameMatches(doubleheader, "mlb_cardinals_reds_2026-08-17_b2_g1")[0]?.id === "g1",
  );
  check(
    "SharpAPI exact Game 2 split identity maps only to the second game",
    findSharpApiSplitGameMatches(doubleheader, "mlb_cardinals_reds_2026-08-17_b3_g2")[0]?.id === "g2",
  );
}
check(
  "WNBA key normalizes known team names",
  marketIntelligenceGameKey("wnba", "Los Angeles Sparks", "Toronto Tempo") === "LA@TOR",
);
check(
  "NBA key normalizes full provider team names to canonical abbreviations",
  marketIntelligenceGameKey("nba", "New York Knicks", "Philadelphia 76ers") === "NYK@PHI",
);
check(
  "NBA key normalizes common Los Angeles provider aliases",
  marketIntelligenceGameKey("nba", "L.A. Lakers", "Los Angeles Clippers") === "LAL@LAC",
);
{
  const nbaRows = [
    {
      event_id: "nba_new_york_knicks_philadelphia_76ers_2026-10-20",
      league: "nba",
      away_team: "New York Knicks",
      home_team: "Philadelphia 76ers",
      sportsbook: "draftkings",
    },
    {
      event_id: "nba_golden_state_warriors_los_angeles_lakers_2026-10-20",
      league: "nba",
      away_team: "Golden State Warriors",
      home_team: "Los Angeles Lakers",
      sportsbook: "betmgm",
    },
  ];
  const nbaSlate = [
    { awayAbbr: "NYK", homeAbbr: "PHI" },
    { awayAbbr: "GSW", homeAbbr: "LAL" },
  ];
  const aligned = assessSharpApiSplitSlateAlignment(
    nbaRows,
    nbaSlate,
    [],
    "2026-10-20",
    "nba",
  );
  check(
    "NBA per-book SharpAPI rows clear exact-date slate identity without becoming consensus",
    aligned.aligned && aligned.currentSlateMatches === 2 && aligned.verifiedCurrentRows === 2,
  );
  check(
    "NBA SharpAPI verification rejects a matching team row stamped for another slate",
    selectVerifiedSharpApiCurrentRows(
      [{ ...nbaRows[0], event_id: "nba_new_york_knicks_philadelphia_76ers_2026-10-19" }],
      nbaSlate,
      "2026-10-20",
      "nba",
    ).length === 0,
  );
}
check(
  "Unregistered Playbook sports fall back to stable mascot keys",
  marketIntelligenceGameKey("nfl", "Buffalo Bills", "Houston Texans") === "bills@texans",
);

function split(overrides: Partial<MarketSplitObservationV2> = {}): MarketSplitObservationV2 {
  return {
    canonical_event_id: "8201",
    canonical_market_id: "8201:moneyline",
    league: "mlb",
    market_type: "moneyline",
    selection_key: "8201:moneyline:home",
    provider: "sharpapi",
    source_book: "draftkings",
    source_type: "retail_book",
    bets_pct: 0.52,
    money_pct: 0.55,
    market_line: null,
    market_price: -110,
    split_line_basis: "provider_explicit",
    books_used: null,
    provider_event_id: "mlb_red_sox_white_sox_2026-07-09",
    source_observed_at: "2026-07-09T15:05:00.000Z",
    fetched_at: "2026-07-09T15:06:00.000Z",
    source_timestamp_verified: true,
    minutes_to_start: 120,
    ingestion_run_id: "test",
    raw_payload_hash: "hash-a",
    ...overrides,
  };
}

{
  const first = split();
  const duplicateSameProviderObservation = split({
    fetched_at: "2026-07-09T15:08:00.000Z",
    raw_payload_hash: "hash-b",
  });
  const differentSide = split({
    selection_key: "8201:moneyline:away",
    raw_payload_hash: "hash-c",
  });
  const out = dedupeSharpApiHistorySplitObservations([
    first,
    duplicateSameProviderObservation,
    differentSide,
  ]);
  check("SharpAPI history dedupe removes repeated source timestamp identity", out.rows.length === 2 && out.skipped === 1);
  check("SharpAPI history dedupe keeps distinct selection side", out.rows.some((row) => row.selection_key.endsWith(":away")));
}

{
  const existing = new Set([
    [
      "sharpapi",
      "draftkings",
      "8201",
      "8201:moneyline",
      "8201:moneyline:home",
      "2026-07-09T15:05:00.000Z",
    ].join("|"),
  ]);
  const out = dedupeSharpApiHistorySplitObservations([split()], existing);
  check("SharpAPI history dedupe skips identities already in DB", out.rows.length === 0 && out.skipped === 1);
}

check(
  "SharpAPI history unique conflict is recognized",
  isSharpApiHistoryUniqueConflict('duplicate key value violates unique constraint "market_split_observations_v2_sharp_history_source_uidx"'),
);

async function runAsyncChecks(): Promise<void> {
  {
    const source = Array.from({ length: 2_305 }, (_, index) => index);
    const calls: Array<[number, number]> = [];
    const rows = await collectCompleteCountedPages<number>({
      label: "test rows",
      loadPage: async (from, to) => {
        calls.push([from, to]);
        return { rows: source.slice(from, to + 1), count: source.length, error: null };
      },
    });
    check(
      "Counted pagination reads the complete NBA line set beyond the Supabase 1,000-row ceiling",
      rows.length === 2_305 && calls.length === 3 && rows.at(-1) === 2_304,
    );
    let rejectedTruncation = false;
    try {
      await collectCompleteCountedPages<number>({
        label: "truncated test rows",
        loadPage: async () => ({ rows: [1], count: 2, error: null }),
      });
    } catch (error) {
      rejectedTruncation = /truncated/.test(error instanceof Error ? error.message : String(error));
    }
    check("Counted pagination fails closed on a short page", rejectedTruncation);
  }
  {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("rate limited", { status: 429 });
    };
    let caught: unknown = null;
    try {
      await new SharpApiClient("test-key").fetchAll({
        path: "/splits/history",
        query: { event_id: "mlb_test_2026-08-25" },
        retryRateLimitInternally: false,
      });
    } catch (error) {
      caught = error;
    } finally {
      globalThis.fetch = originalFetch;
    }
    check(
      "SharpAPI per-event history caller can own the 429 retry without a hidden client retry",
      caught instanceof SharpApiRateLimitError && calls === 1,
    );
  }

  {
    const transientServer = new SharpApiClientError("server unavailable", {
      endpoint: "/splits/history",
      status: 503,
    });
    const retryBudget = { remaining: 2 };
    let calls = 0;
    const result = await fetchSharpHistoryWithRetry({
      fetchRows: async () => {
        calls++;
        if (calls === 1) throw transientServer;
        return [{ id: "recovered" }];
      },
      retryBudget,
      backoffMs: 0,
    });
    check(
      "SharpAPI history retries one transient 5xx and recovers rows",
      result.outcome === "rows" && result.attempts === 2 && result.retries === 1 && calls === 2,
    );
    check("SharpAPI history transient retry consumes the shared budget", retryBudget.remaining === 1);
  }

  {
    const retryBudget = { remaining: 1 };
    let calls = 0;
    const result = await fetchSharpHistoryWithRetry({
      fetchRows: async () => {
        calls++;
        throw new SharpApiNotFoundError({ endpoint: "/splits/history" });
      },
      retryBudget,
      backoffMs: 0,
    });
    check(
      "SharpAPI history treats 404 as definitive absence without retry",
      result.outcome === "definitive_absence" && result.failureClass === "definitive_absence" &&
        result.error === null && calls === 1 && retryBudget.remaining === 1,
    );
  }

  {
    const retryBudget = { remaining: 1 };
    let calls = 0;
    const result = await fetchSharpHistoryWithRetry<never>({
      fetchRows: async () => {
        calls++;
        throw new SharpApiClientError("bad request", {
          endpoint: "/splits/history",
          status: 400,
        });
      },
      retryBudget,
      backoffMs: 0,
    });
    check(
      "SharpAPI history does not retry a non-retryable 4xx",
      result.outcome === "failed" && result.failureClass === "non_retryable_client" &&
        calls === 1 && retryBudget.remaining === 1,
    );
  }

  {
    const retryBudget = { remaining: 0 };
    let calls = 0;
    const result = await fetchSharpHistoryWithRetry<never>({
      fetchRows: async () => {
        calls++;
        throw new TypeError("fetch failed");
      },
      retryBudget,
      backoffMs: 0,
    });
    check(
      "SharpAPI history cannot exceed a depleted cycle retry budget",
      result.outcome === "failed" && result.failureClass === "transient_network" && calls === 1,
    );
  }

  {
    const retryBudget = { remaining: 10 };
    let calls = 0;
    const result = await fetchSharpHistoryWithRetry<never>({
      fetchRows: async () => {
        calls++;
        throw new SharpApiClientError("server unavailable", {
          endpoint: "/splits/history",
          status: 502,
        });
      },
      retryBudget,
      maxAttempts: 99,
      backoffMs: 0,
    });
    check(
      "SharpAPI history per-event retries remain capped at two attempts",
      result.outcome === "failed" && result.attempts === 2 && result.retries === 1 &&
        calls === 2 && retryBudget.remaining === 9,
    );
  }

  {
    const result = await fetchSharpHistoryWithRetry<{ id: string }>({
      fetchRows: async () => [],
      retryBudget: { remaining: 1 },
      backoffMs: 0,
    });
    check(
      "SharpAPI history records a successful empty response without retry",
      result.outcome === "definitive_empty" && result.attempts === 1 && result.retries === 0,
    );
  }

  check(
    "SharpAPI history classifies 429 as transient rate limiting",
    classifySharpHistoryFailure(new SharpApiRateLimitError({ endpoint: "/splits/history" })).failureClass ===
      "transient_rate_limit",
  );
  check(
    "SharpAPI history classifies timeout failures as transient",
    classifySharpHistoryFailure(new Error("request timed out")).failureClass === "transient_timeout",
  );
  check(
    "SharpAPI history classifies HTTP 408 as a transient timeout",
    classifySharpHistoryFailure(new SharpApiClientError("request timeout", {
      endpoint: "/splits/history",
      status: 408,
    })).failureClass === "transient_timeout",
  );

  const existingRow = {
    provider: "sharpapi",
    source_book: "draftkings",
    canonical_event_id: "8201",
    canonical_market_id: "8201:moneyline",
    selection_key: "8201:moneyline:home",
    source_observed_at: "2026-07-09T15:05:00.000Z",
  };
  const duplicate = split();
  const keeper = split({
    selection_key: "8201:moneyline:away",
    raw_payload_hash: "hash-keeper",
  });
  const upsertPayloads: unknown[][] = [];
  let selectCalls = 0;
  let upsertCalls = 0;
  const fakeSupabase = {
    from(table: string) {
      if (table !== "market_split_observations_v2") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq() { return this; },
            in() { return this; },
            not() { return this; },
            async range() {
              selectCalls++;
              return {
                data: selectCalls === 1 ? [] : [existingRow],
                error: null,
              };
            },
          };
        },
        async upsert(payload: unknown[]) {
          upsertCalls++;
          upsertPayloads.push(payload);
          if (upsertCalls === 1) {
            return {
              error: {
                message: 'duplicate key value violates unique constraint "market_split_observations_v2_sharp_history_source_uidx"',
              },
            };
          }
          return { error: null };
        },
      };
    },
  };

  const result = await writeRows({
    supabase: fakeSupabase as never,
    splitObservations: [duplicate, keeper],
    priceObservations: [],
  });
  const retryPayload = upsertPayloads[1] ?? [];
  check("SharpAPI history duplicate race retries without surfacing cron error", result.errors.length === 0);
  check("SharpAPI history duplicate race writes only non-duplicate retry row", result.splitWritten === 1);
  check("SharpAPI history duplicate race made two state reads", selectCalls === 2, String(selectCalls));
  check("SharpAPI history duplicate race retried split upsert", upsertCalls === 2, String(upsertCalls));
  check(
    "SharpAPI history duplicate race retry payload excludes duplicate identity",
    retryPayload.length === 1 && (retryPayload[0] as MarketSplitObservationV2).selection_key.endsWith(":away"),
  );

  const repeatedRacePayloads: unknown[][] = [];
  let repeatedRaceSelectCalls = 0;
  let repeatedRaceUpsertCalls = 0;
  const repeatedRaceSupabase = {
    from(table: string) {
      if (table !== "market_split_observations_v2") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq() { return this; },
            in() { return this; },
            not() { return this; },
            async range() {
              repeatedRaceSelectCalls++;
              return {
                data:
                  repeatedRaceSelectCalls === 1
                    ? []
                    : repeatedRaceSelectCalls === 2
                      ? [existingRow]
                      : [
                          existingRow,
                          {
                            ...existingRow,
                            selection_key: "8201:moneyline:away",
                          },
                        ],
                error: null,
              };
            },
          };
        },
        async upsert(payload: unknown[]) {
          repeatedRaceUpsertCalls++;
          repeatedRacePayloads.push(payload);
          return {
            error: {
              message: 'duplicate key value violates unique constraint "market_split_observations_v2_sharp_history_source_uidx"',
            },
          };
        },
      };
    },
  };

  const repeatedRaceResult = await writeRows({
    supabase: repeatedRaceSupabase as never,
    splitObservations: [duplicate, keeper],
    priceObservations: [],
  });
  check(
    "repeated SharpAPI history race reconciles without a false cron error",
    repeatedRaceResult.errors.length === 0,
  );
  check(
    "repeated SharpAPI history race stays bounded",
    repeatedRaceUpsertCalls === 2 && repeatedRaceSelectCalls === 3,
    `${repeatedRaceUpsertCalls}/${repeatedRaceSelectCalls}`,
  );
  check(
    "repeated race second payload retains only the not-yet-committed identity",
    repeatedRacePayloads[1]?.length === 1 &&
      (repeatedRacePayloads[1]?.[0] as MarketSplitObservationV2).selection_key.endsWith(":away"),
  );
}

runAsyncChecks()
  .then(() => {
    console.log(`\nmarket-intelligence-v2-shadow-sync: ${pass} passed, ${fail} failed`);
    if (fail > 0) {
      console.error("\nFailures:");
      for (const f of failures) console.error(`  x ${f}`);
      process.exit(1);
    }
    console.log("all assertions passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
