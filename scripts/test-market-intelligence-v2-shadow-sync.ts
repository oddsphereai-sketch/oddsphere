import {
  dedupeSharpApiHistorySplitObservations,
  assessSharpApiSplitSlateAlignment,
  classifySharpHistoryFailure,
  fetchSharpHistoryWithRetry,
  findSharpApiSplitGameMatches,
  isSharpApiHistoryUniqueConflict,
  marketIntelligenceGameKey,
  selectVerifiedSharpApiCurrentRows,
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

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

check(
  "MLB key normalizes full team names",
  marketIntelligenceGameKey("mlb", "Houston Astros", "Detroit Tigers") === "HOU@DET",
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
