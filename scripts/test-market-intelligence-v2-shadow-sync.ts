import {
  dedupeSharpApiHistorySplitObservations,
  isSharpApiHistoryUniqueConflict,
  marketIntelligenceGameKey,
  writeRows,
} from "../lib/services/marketIntelligenceV2/shadowSync";
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
check(
  "MLB key rejects unknown teams",
  marketIntelligenceGameKey("mlb", "Not A Team", "Detroit Tigers") === null,
);
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
