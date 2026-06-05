/**
 * Phase 4.2.C.1.R-17 Step 2F.1 — targeted speculative bucket probe unit tests.
 *
 * The Step 2F audit (2026-06-05) found SharpAPI's /opportunities/ev silently
 * carries a small payload (prophetx on 3 of 14 events) on `_b3` for events
 * advertised at `_b0`. Step 2F.1 added a targeted probe: for each event,
 * if only `_b0` was advertised also call /odds on `_b3` (and the symmetric
 * `_b3` → `_b0` case). `_b1` / `_b2` are intentionally NOT probed — the
 * audit found zero yield.
 *
 * These tests pin:
 *   [2F.1-A] advertised `_b0` only + speculative `_b3` returns distinct book → preserved
 *   [2F.1-B] advertised `_b3` only + speculative `_b0` returns distinct book → preserved
 *   [2F.1-C] speculative probe empty/not-found → no failure, no recovery
 *   [2F.1-D] speculative row whose key collides with advertised row → deduped
 *   [2F.1-E] both `_b0` AND `_b3` advertised → speculative probe SKIPPED entirely
 *   [2F.1-F] R-16G-A team guard still rejects mismatched rows on speculative path
 *   [2F.1-G] call cap consumed by advertised phase → speculative cap-skipped, no crash
 *
 * Pure stub tests — no network, no SHARPAPI_KEY.
 *
 * Run: npx tsx scripts/test-sharpapi-speculative-bucket.ts
 */

import { SharpAPIOddsProvider } from "../lib/providers/real_api/SharpAPIOddsProvider";
import { SharpApiClient, SharpApiNotFoundError } from "../lib/providers/real_api/_sharpApiClient";

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
// Stub client — same pattern as test-sharpapi-multibucket.ts.
// Supports an optional `notFoundEventIds` set so we can simulate
// SharpAPI's 404 response for the speculative bucket.
// ─────────────────────────────────────────────────────────────

class StubClient extends SharpApiClient {
  public readonly calls: Array<{ path: string; query: Record<string, unknown> }> = [];
  constructor(
    private readonly oppRows: Array<Record<string, unknown>>,
    private readonly oddsByEventId: Map<string, Array<Record<string, unknown>>>,
    private readonly notFoundEventIds: Set<string> = new Set()
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
      if (this.notFoundEventIds.has(evId)) {
        throw new SharpApiNotFoundError({ endpoint: `/odds?event_id=${evId}` });
      }
      const rows = this.oddsByEventId.get(evId) ?? [];
      return rows as unknown as T[];
    }
    if (opts.path === "/splits") {
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

const mockResolver = async (
  _sport: string,
  _date: string,
  home: string,
  away: string
): Promise<number | null> => {
  void _sport;
  void _date;
  const seed = `${home}|${away}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

async function main() {
  // ── [2F.1-A] advertised _b0 + speculative _b3 recovers a new book ──
  section("Step 2F.1 — advertised _b0 only + speculative _b3 returns distinct book");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [
          oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home", odds_american: -110 }),
          oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home", odds_american: -108 }),
        ],
      ],
      [
        // Speculative _b3 — should be queried because not advertised.
        "mlb_royals_twins_2026-06-05_b3",
        [
          // prophetx — the audit signature: a book that ONLY appears
          // on speculative _b3 for _b0-advertised events.
          oddsRow({ market_type: "moneyline", sportsbook: "prophetx", selection_type: "home", odds_american: -112 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const oddsCalls = stub.calls.filter((c) => c.path === "/odds");
    check("speculative — advertised _b0 fetched", oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b0"));
    check("speculative — _b3 also fetched (speculative)", oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b3"));
    check("speculative — total /odds calls = 2 (advertised + 1 speculative)", oddsCalls.length === 2);

    const books = new Set(result.records.map((r) => r.sportsbook));
    check("speculative — prophetx record made it through (advertised+speculative merge)", books.has("prophetx"));
    check("speculative — 3 records total (2 advertised + 1 speculative)", result.records.length === 3);

    const pg = result.discovery.perGame[0];
    check(
      "speculative — speculativeBucketsAttempted contains the _b3 full id",
      pg?.speculativeBucketsAttempted.includes("mlb_royals_twins_2026-06-05_b3") === true
    );
    check(
      "speculative — speculativeBucketsWithRows contains the _b3 id",
      pg?.speculativeBucketsWithRows.includes("mlb_royals_twins_2026-06-05_b3") === true
    );
    check("speculative — speculativeBooksRecovered = ['prophetx']", JSON.stringify(pg?.speculativeBooksRecovered) === JSON.stringify(["prophetx"]));
    check("speculative — speculativeRowsRecovered = 1", pg?.speculativeRowsRecovered === 1);
    check("speculative — speculativeBucketsCallCapped is empty", pg?.speculativeBucketsCallCapped.length === 0);
  }

  // ── [2F.1-B] symmetric: advertised _b3 + speculative _b0 recovers a book ──
  section("Step 2F.1 — advertised _b3 only + speculative _b0 returns distinct book");
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
        ],
      ],
      [
        "mlb_royals_twins_2026-06-05_b0",
        [
          // A book ONLY observable on speculative _b0.
          oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home", odds_american: -108 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const oddsCalls = stub.calls.filter((c) => c.path === "/odds");
    check("speculative — both _b3 and _b0 fetched", oddsCalls.length === 2);
    check("speculative — _b0 fetched as speculative", oddsCalls.some((c) => c.query.event_id === "mlb_royals_twins_2026-06-05_b0"));

    const books = new Set(result.records.map((r) => r.sportsbook));
    check("speculative — fliff recovered via _b0", books.has("fliff"));

    const pg = result.discovery.perGame[0];
    check(
      "speculative — speculativeBucketsAttempted = [_b0 full id]",
      JSON.stringify(pg?.speculativeBucketsAttempted) === JSON.stringify(["mlb_royals_twins_2026-06-05_b0"])
    );
    check("speculative — speculativeBooksRecovered = ['fliff']", JSON.stringify(pg?.speculativeBooksRecovered) === JSON.stringify(["fliff"]));
    check("speculative — speculativeRowsRecovered = 1", pg?.speculativeRowsRecovered === 1);
  }

  // ── [2F.1-C] empty / 404 speculative bucket — no failure, no recovery ──
  section("Step 2F.1 — speculative bucket empty / 404 does not crash");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home" })],
      ],
      // No entry for _b3 → stub returns [] (empty 200).
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const pg = result.discovery.perGame[0];
    check("empty speculative — _b3 attempted", pg?.speculativeBucketsAttempted.length === 1);
    check("empty speculative — _b3 NOT in BucketsWithRows (empty response)", pg?.speculativeBucketsWithRows.length === 0);
    check("empty speculative — 0 books recovered", pg?.speculativeBooksRecovered.length === 0);
    check("empty speculative — 0 rows recovered", pg?.speculativeRowsRecovered === 0);
    check("empty speculative — advertised record still present", result.records.length === 1);
  }
  {
    // Same scenario but the speculative endpoint throws 404.
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
        [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home" })],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap, new Set(["mlb_royals_twins_2026-06-05_b0"]));
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const pg = result.discovery.perGame[0];
    check("404 speculative — _b0 attempted", pg?.speculativeBucketsAttempted.length === 1);
    check("404 speculative — _b0 NOT in BucketsWithRows", pg?.speculativeBucketsWithRows.length === 0);
    check("404 speculative — 0 rows recovered", pg?.speculativeRowsRecovered === 0);
    check("404 speculative — advertised record still present", result.records.length === 1);
  }

  // ── [2F.1-D] dedupe across advertised vs speculative ──
  section("Step 2F.1 — speculative row that collides with advertised is deduped");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home", odds_american: -110 })],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          // SAME (kalshi, ML, home, null line) as advertised — should be deduped.
          oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home", odds_american: -115 }),
          // NEW (prophetx, ML, home, null line) — should be recovered.
          oddsRow({ market_type: "moneyline", sportsbook: "prophetx", selection_type: "home", odds_american: -112 }),
        ],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    check("dedupe — 2 final records (advertised kalshi + speculative prophetx)", result.records.length === 2);
    const kalshi = result.records.find((r) => r.sportsbook === "kalshi");
    check(
      "dedupe — first-wins: advertised kalshi kept (odds_american = -110, not the -115 from _b3)",
      kalshi?.odds_american === -110
    );

    const pg = result.discovery.perGame[0];
    check("dedupe — dedupedAcrossBuckets = 1 (the colliding kalshi)", pg?.dedupedAcrossBuckets === 1);
    check("dedupe — speculativeRowsRecovered = 1 (the new prophetx)", pg?.speculativeRowsRecovered === 1);
    check("dedupe — speculativeBooksRecovered = ['prophetx']", JSON.stringify(pg?.speculativeBooksRecovered) === JSON.stringify(["prophetx"]));
  }

  // ── [2F.1-E] both buckets already advertised → no speculative probe at all ──
  section("Step 2F.1 — both buckets advertised → speculative probe SKIPPED");
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
        [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home" })],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [oddsRow({ market_type: "moneyline", sportsbook: "fliff", selection_type: "home" })],
      ],
    ]);
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", mockResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const oddsCalls = stub.calls.filter((c) => c.path === "/odds");
    check("both-advertised — exactly 2 /odds calls (no speculative)", oddsCalls.length === 2);

    const pg = result.discovery.perGame[0];
    check("both-advertised — speculativeBucketsAttempted is empty", pg?.speculativeBucketsAttempted.length === 0);
    check("both-advertised — speculativeBucketsWithRows is empty", pg?.speculativeBucketsWithRows.length === 0);
    check("both-advertised — speculativeBucketsCallCapped is empty", pg?.speculativeBucketsCallCapped.length === 0);
    check("both-advertised — speculativeRowsRecovered = 0", pg?.speculativeRowsRecovered === 0);
  }

  // ── [2F.1-F] R-16G-A team guard rejects mismatched rows on speculative path ──
  section("Step 2F.1 — R-16G-A team guard applies to speculative rows too");
  {
    const oppRows = [
      oppRow({
        eventId: "mlb_royals_twins_2026-06-05_b0",
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }),
    ];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>([
      [
        "mlb_royals_twins_2026-06-05_b0",
        [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home" })],
      ],
      [
        "mlb_royals_twins_2026-06-05_b3",
        [
          // INVERTED home/away — speculative-path guard should reject.
          oddsRow({
            market_type: "moneyline",
            sportsbook: "prophetx",
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
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await provider.getGameLinesV2(SLATE, "mlb");
      check("team-guard speculative — kalshi kept; inverted prophetx rejected", result.records.length === 1 && result.records[0]?.sportsbook === "kalshi");
      const pg = result.discovery.perGame[0];
      check("team-guard speculative — speculativeBucketsAttempted still includes _b3", pg?.speculativeBucketsAttempted.length === 1);
      check("team-guard speculative — speculativeRowsRecovered = 0 (rejected)", pg?.speculativeRowsRecovered === 0);
      check("team-guard speculative — speculativeBooksRecovered is empty", pg?.speculativeBooksRecovered.length === 0);
    } finally {
      console.warn = origWarn;
    }
  }

  // ── [2F.1-G] call cap behavior on speculative buckets ──
  section("Step 2F.1 — speculative buckets call-capped when cap exhausted");
  {
    // 48 events all advertised at _b0 only — advertised loop uses
    // 48 calls + 1 ev + 1 splits = 50, hitting the cap before any
    // speculative probe can run. The cap-skipped speculative buckets
    // should be reflected in the diagnostics, not crash.
    const oppRows: Array<Record<string, unknown>> = [];
    const oddsMap = new Map<string, Array<Record<string, unknown>>>();
    for (let i = 0; i < 48; i++) {
      const evId = `mlb_team${i}a_team${i}b_2026-06-05_b0`;
      oppRows.push(oppRow({
        eventId: evId,
        away: "Kansas City Royals",
        home: "Minnesota Twins",
      }));
      oddsMap.set(evId, [oddsRow({ market_type: "moneyline", sportsbook: "kalshi", selection_type: "home" })]);
    }
    // Distinct resolver to give each event a different gameExternalId.
    const variantResolver = async (
      _sport: string,
      _date: string,
      _home: string,
      _away: string
    ): Promise<number | null> => {
      // Use a counter via the closure of this fixture
      counter += 1;
      return counter;
    };
    let counter = 0;
    const stub = new StubClient(oppRows, oddsMap);
    const provider = new SharpAPIOddsProvider("stub-key", variantResolver, { client: stub });
    const result = await provider.getGameLinesV2(SLATE, "mlb");

    const apiCalls = result.discovery.apiCallsMade;
    check("call-cap — apiCallsMade respects MAX_CALLS_PER_INVOCATION=50", apiCalls <= 50);
    // At least one game should have a non-empty speculativeBucketsCallCapped.
    const anyCapped = result.discovery.perGame.some(
      (g) => g.speculativeBucketsCallCapped.length > 0
    );
    check("call-cap — at least one game has speculativeBucketsCallCapped non-empty", anyCapped);
    // No crash, advertised records still landed.
    check("call-cap — advertised records still landed (count > 0)", result.records.length > 0);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All sharpapi-speculative-bucket tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
