/**
 * Phase 4.2.C.1.R-17 Step 2E.1 — multi-bucket /odds harvest unit tests.
 *
 * Pure tests. Uses a stub SharpApiClient that intercepts /opportunities/ev
 * and /odds calls and returns deterministic fixtures. No network, no
 * SHARPAPI_KEY gate. Always runs in CI.
 *
 * Run: npx tsx scripts/test-sharpapi-multibucket.ts
 */

import { SharpAPIOddsProvider } from "../lib/providers/real_api/SharpAPIOddsProvider";
import { SharpApiClient } from "../lib/providers/real_api/_sharpApiClient";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const SLATE = "2026-06-05";

// ─────────────────────────────────────────────────────────────
// Stub client — intercepts /opportunities/ev + /odds responses,
// records call sequence so tests can inspect what got fetched.
// ─────────────────────────────────────────────────────────────

class StubClient extends SharpApiClient {
  public readonly calls: Array<{ path: string; query: Record<string, unknown> }> = [];
  constructor(
    private readonly oppRows: Array<Record<string, unknown>>,
    private readonly oddsByEventId: Map<string, Array<Record<string, unknown>>>,
    private readonly targetedTotalsByEventId: Map<string, Array<Record<string, unknown>>> = new Map()
  ) {
    super("stub-key");
  }
  override async fetchAll<T>(opts: {
    path: string;
    query?: Record<string, unknown>;
    maxPages?: number;
  }): Promise<T[]> {
    this.calls.push({ path: opts.path, query: opts.query ?? {} });
    if (opts.path === "/opportunities/ev") {
      return this.oppRows as unknown as T[];
    }
    if (opts.path === "/odds") {
      const evId = String(opts.query?.event_id ?? "");
      if (opts.query?.market_type === "total_runs") {
        return (this.targetedTotalsByEventId.get(evId) ?? []) as unknown as T[];
      }
      const rows = this.oddsByEventId.get(evId) ?? [];
      return rows as unknown as T[];
    }
    if (opts.path === "/splits") {
      // R-16E fallback — return [] for these tests (no /splits enrichment).
      return [] as T[];
    }
    return [] as T[];
  }
}

function oppRow(opts: {
  eventId: string;
  away: string;
  home: string;
  isPlayerProp?: boolean;
  isAlternateLine?: boolean;
}): Record<string, unknown> {
  return {
    event_id: opts.eventId,
    league: "mlb",
    home_team: opts.home,
    away_team: opts.away,
    is_player_prop: opts.isPlayerProp ?? false,
    is_alternate_line: opts.isAlternateLine ?? false,
  };
}

function oddsRow(opts: {
  market_type: string;
  sportsbook: string;
  selection_type: string;
  line?: number | null;
  odds_american?: number | null;
  home_team?: string;
  away_team?: string;
}): Record<string, unknown> {
  return {
    league: "mlb",
    market_type: opts.market_type,
    sportsbook: opts.sportsbook,
    selection_type: opts.selection_type,
    line: opts.line ?? null,
    odds_american: opts.odds_american ?? -110,
    odds_decimal: 1.91,
    odds_probability: 0.524,
    is_alternate_line: false,
    home_team: opts.home_team ?? "Minnesota Twins",
    away_team: opts.away_team ?? "Kansas City Royals",
  };
}

// Mock game resolver — every team-pair resolves to a deterministic int.
const mockResolver = async (
  _sport: string,
  _date: string,
  home: string,
  away: string
): Promise<number | null> => {
  void _sport;
  void _date;
  // Synthesize a stable id from the abbrevs so tests can match it.
  const seed = `${home}|${away}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

async function main() {
  // ── [2E.1-A] Single-bucket event — behavior preserved ──────────
  section("Step 2E.1 — single-bucket event still harvests one call");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b3",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home", odds_american: -110 }),
          oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "away", odds_american: -110 }),
          oddsRow({ market_type: "total_runs", sportsbook: "fliff", selection_type: "over", line: 8.5 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const oddsCalls = stub.calls.filter((c) => c.path === "/odds");
    // R-17 Step 2F.1 — single advertised bucket also triggers a
    // speculative probe of the opposite common bucket (`_b3` advertised
    // here, so `_b0` is probed). Stub returns [] for `_b0` so the
    // speculative call is harmless. Test now asserts both calls fire
    // AND the speculative one contributes zero records.
    check("single-bucket — 4 /odds calls (1 advertised + 3 speculative)", oddsCalls.length === 4);
    check(
      "single-bucket — advertised call hit the canonical suffix",
      oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b3")
    );
    check(
      "single-bucket — speculative call hit `_b0`",
      oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b0")
    );
    check("single-bucket — 3 records harvested (only advertised contributes)", result.records.length === 3);
    check(
      "single-bucket — perGame bucketsObserved length 1 (advertised count only)",
      result.discovery.perGame[0]?.bucketsObserved.length === 1
    );
    check(
      "single-bucket — dedupedAcrossBuckets = 0",
      result.discovery.perGame[0]?.dedupedAcrossBuckets === 0
    );
    // Step 2F.1 expectation: speculative probe ran, found nothing,
    // recorded nothing.
    check(
      "single-bucket — speculativeBucketsAttempted = 3",
      result.discovery.perGame[0]?.speculativeBucketsAttempted.length === 3
    );
    check(
      "single-bucket — speculativeRowsRecovered = 0 (probe returned nothing)",
      result.discovery.perGame[0]?.speculativeRowsRecovered === 0
    );
  }

  // ── [2E.1-B] Multi-bucket event — books from both buckets included ─
  section("Step 2E.1 — multi-bucket event harvests both, distinct books preserved");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b3",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [
          // _b0 has fliff + kalshi rows
          oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home", odds_american: -115 }),
          oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home", odds_american: -110 }),
        ],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          // _b3 has caesars + circa rows (DIFFERENT books)
          oddsRow({ market_type: "moneyline", sportsbook: "caesars", selection_type: "home", odds_american: -118 }),
          oddsRow({ market_type: "moneyline", sportsbook: "circa", selection_type: "home", odds_american: -115 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const oddsCalls = stub.calls.filter((c) => c.path === "/odds");
    check("multi-bucket — 6 /odds calls (advertised + targeted totals + speculative)", oddsCalls.length === 6);
    check(
      "multi-bucket — _b0 fetched",
      oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b0")
    );
    check(
      "multi-bucket — _b3 fetched",
      oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b3")
    );
    check("multi-bucket — 4 records harvested (2 from each bucket)", result.records.length === 4);
    const books = new Set(result.records.map((r) => r.sportsbook));
    check(
      "multi-bucket — all 4 distinct books present (caesars + circa from _b3, fliff + kalshi from _b0)",
      books.has("caesars") && books.has("circa") && books.has("fliff") && books.has("kalshi")
    );
    check(
      "multi-bucket — perGame.bucketsObserved length 2",
      result.discovery.perGame[0]?.bucketsObserved.length === 2
    );
    check(
      "multi-bucket — dedupedAcrossBuckets = 0 (no duplicate keys)",
      result.discovery.perGame[0]?.dedupedAcrossBuckets === 0
    );
  }

  section("Props-heavy generic payload recovers full-game totals");
  {
    const eventId = "mlb_royals_twins_2026-06-05_b3";
    const oppRows = [oppRow({ eventId, away: "Kansas City Royals", home: "Minnesota Twins" })];
    const genericRows = new Map<string, Array<Record<string, unknown>>>([[eventId, [
      oddsRow({ market_type: "moneyline", sportsbook: "pinnacle", selection_type: "home", odds_american: -112 }),
    ]]]);
    const targetedTotals = new Map<string, Array<Record<string, unknown>>>([[eventId, [
      oddsRow({ market_type: "total_runs", sportsbook: "pinnacle", selection_type: "over", line: 9.5, odds_american: -104 }),
      oddsRow({ market_type: "total_runs", sportsbook: "pinnacle", selection_type: "under", line: 9.5, odds_american: -116 }),
    ]]]);
    const stub = new StubClient(oppRows, genericRows, targetedTotals);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");
    const totals = result.records.filter((r) => r.market_type === "total");

    check("targeted total query fired", stub.calls.some((c) => c.query.event_id === eventId && c.query.market_type === "total_runs"));
    check("both recovered total sides survive", totals.length === 2);
    check("generic moneyline remains present", result.records.some((r) => r.market_type === "moneyline"));
  }

  // ── [2E.1-C] Multi-bucket — duplicate (book, market, side, line) deduped
  section("Step 2E.1 — duplicate rows across buckets dedupe to one record");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b3",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [
          oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home", odds_american: -110 }),
          oddsRow({ market_type: "total_runs", sportsbook: "kalshi", selection_type: "over", line: 8.5 }),
        ],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          // Same kalshi total at 8.5 over — should DEDUPE
          oddsRow({ market_type: "total_runs", sportsbook: "kalshi", selection_type: "over", line: 8.5, odds_american: -108 }),
          // New caesars row — should land
          oddsRow({ market_type: "moneyline", sportsbook: "caesars", selection_type: "home", odds_american: -115 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    check(
      "dedupe — 3 records (fliff ML home + kalshi total over + caesars ML home), dup dropped",
      result.records.length === 3
    );
    check(
      "dedupe — dedupedAcrossBuckets = 1 (the second kalshi-total-over)",
      result.discovery.perGame[0]?.dedupedAcrossBuckets === 1
    );
    // First-wins: the earlier-fetched bucket's odds value is kept.
    const kalshiTotal = result.records.find(
      (r) => r.sportsbook === "kalshi" && r.market_type === "total"
    );
    check(
      "dedupe — first-wins: kalshi total over kept (odds from _b0, odds_american=-110 not -108)",
      kalshiTotal?.odds_american === -110
    );
  }

  // ── [2E.1-D] R-16G-A team guard still works on multi-bucket
  section("Step 2E.1 — R-16G-A team guard rejects mismatched rows from any bucket");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b3",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [
          // CLEAN row
          oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home", odds_american: -110 }),
        ],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          // INVERTED home/away — guard must reject
          oddsRow({
            market_type: "moneyline",
            sportsbook: "kalshi",
            selection_type: "home",
            odds_american: -110,
            home_team: "Kansas City Royals", // WRONG — should be MIN
            away_team: "Minnesota Twins",
          }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    // Silence the R-16G-A console.warn for test clarity
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await provider.getGameLinesV2(SLATE, "mlb");
      check(
        "team-guard — only 1 record kept (fliff); inverted kalshi rejected",
        result.records.length === 1 && result.records[0]?.sportsbook === "fliff"
      );
    } finally {
      console.warn = origWarn;
    }
  }

  // ── [2E.1-E] Discovery surfaces multi-bucket events
  section("Step 2E.1 — discovery report carries multi-bucket diagnostics");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b3",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
      // A single-bucket event in the same slate
      oppRow({
        eventId: "mlb_redsox_yankees_2026-06-05_b3",
        away: "Boston Red Sox",
        home: "New York Yankees",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home" })],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [oddsRow({ market_type: "moneyline", sportsbook: "caesars", selection_type: "home" })],
      ],
      [
        "mlb_redsox_yankees_2026-06-05_b3",
        [oddsRow({
          market_type: "moneyline",
          sportsbook: "kalshi",
          selection_type: "home",
          home_team: "New York Yankees",
          away_team: "Boston Red Sox",
        })],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const kc = result.discovery.perGame.find((g) => g.away === "KC" && g.home === "MIN");
    const bn = result.discovery.perGame.find((g) => g.away === "BOS" && g.home === "NYY");

    check("KC@MIN — bucketsObserved.length = 2", kc?.bucketsObserved.length === 2);
    check("KC@MIN — bucketsFetched.length = 2", kc?.bucketsFetched.length === 2);
    check("KC@MIN — bucketsCallCapped is empty", kc?.bucketsCallCapped.length === 0);
    check("BOS@NYY — bucketsObserved.length = 1", bn?.bucketsObserved.length === 1);
    check("BOS@NYY — bucketsFetched.length = 1", bn?.bucketsFetched.length === 1);

    // Discovery stats' multiBucketEvents should also fire for KC@MIN.
    check(
      "discoveryStats.multiBucketEvents includes KC@MIN",
      result.discovery.discoveryStats.multiBucketEvents.some(
        (e) => e.sharpEventId === "mlb_royals_twins_2026-06-05"
      )
    );
    check(
      "discoveryStats.multiBucketEvents does NOT include BOS@NYY (single-bucket)",
      !result.discovery.discoveryStats.multiBucketEvents.some(
        (e) => e.sharpEventId === "mlb_redsox_yankees_2026-06-05"
      )
    );
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All sharpapi-multibucket tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
