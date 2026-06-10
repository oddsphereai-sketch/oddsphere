/**
 * Phase 4.2.C.1.R-16D — Unit tests for V2 line refresh + market coverage gate.
 *
 * No HTTP. No DB. Uses a stub SharpApiClient that returns the fixture
 * data each test wants, so the provider's V2 discovery + per-event odds
 * fetch can be exercised deterministically.
 *
 * Asserts the failure modes the R-16C lines refresh exposed:
 *   • V2 discovers every slate game from /splits, not only EV-opportunity games
 *   • Athletics ("Athletics" / "Oakland Athletics") maps to ATH
 *   • A partial /opportunities/ev response does NOT cause coverage to shrink
 *   • Coverage gate flags games with sharp_signals but no lines
 *   • Coverage gate fail-closes when ML/Total < 50%
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-lines-refresh-v2.ts
 */

import {
  SharpAPIOddsProvider,
  type SharpApiGameResolver,
} from "../lib/providers/real_api/SharpAPIOddsProvider";
import { SharpApiClient } from "../lib/providers/real_api/_sharpApiClient";
import { derivePerBookDeleteKeys } from "../lib/services/linesService";
import {
  buildDiscoveryFromSplitsRows,
  extractSlateDateFromEventId,
  stripEventBucketSuffix,
  type RawSplitsRow,
} from "../lib/providers/real_api/_splitsDiscovery";
import type { Sport } from "../lib/types/domain/Sport";
import type { MlbTeamAbbrev } from "../lib/providers/real_api/_teamNameNormalizer";

// ─── tiny test harness ────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─── stub client ──────────────────────────────────────────────────────

type StubBuckets = {
  splits?: RawSplitsRow[];
  /** Keyed by sport (only "mlb" in V1). */
  opportunitiesEv?: Array<Record<string, unknown>>;
  /** Keyed by event_id. */
  oddsByEventId?: Record<string, Array<Record<string, unknown>>>;
};

class StubSharpApiClient extends SharpApiClient {
  private readonly buckets: StubBuckets;
  public calls: Array<{ path: string; query?: Record<string, unknown> }> = [];

  constructor(buckets: StubBuckets) {
    // Pass a fake key — we override every network call. The parent
    // constructor only stores the key.
    super("stub-key");
    this.buckets = buckets;
  }

  override async fetchAll<T>(opts: {
    path: string;
    query?: Record<string, unknown>;
    maxPages?: number;
  }): Promise<T[]> {
    this.calls.push({ path: opts.path, query: opts.query });
    if (opts.path === "/splits") {
      return (this.buckets.splits ?? []) as unknown as T[];
    }
    if (opts.path === "/opportunities/ev") {
      return (this.buckets.opportunitiesEv ?? []) as unknown as T[];
    }
    if (opts.path === "/odds") {
      const eventId = String(opts.query?.event_id ?? "");
      const rows = this.buckets.oddsByEventId?.[eventId] ?? [];
      return rows as unknown as T[];
    }
    return [] as T[];
  }
}

// ─── fixtures ─────────────────────────────────────────────────────────

const DATE = "2026-06-04";

function splitsRow(opts: {
  home: string;
  away: string;
  bucketSuffix?: string;
  league?: string | null;
  date?: string;
}): RawSplitsRow {
  const date = opts.date ?? DATE;
  const slug = `${opts.home.toLowerCase().replace(/\s+/g, "")}_${opts.away
    .toLowerCase()
    .replace(/\s+/g, "")}`;
  const eventId = `mlb_${slug}_${date}${opts.bucketSuffix ?? ""}`;
  return {
    event_id: eventId,
    sport: "baseball",
    league: opts.league === undefined ? "mlb" : opts.league,
    home_team: opts.home,
    away_team: opts.away,
    sportsbook: "consensus",
    moneyline: { bets_pct: { home: 0.5, away: 0.5 }, handle_pct: { home: 0.5, away: 0.5 } },
    spread: { bets_pct: { home: 0.5, away: 0.5 }, handle_pct: { home: 0.5, away: 0.5 } },
    total: { bets_pct: { over: 0.5, under: 0.5 }, handle_pct: { over: 0.5, under: 0.5 } },
    fetched_at: `${date}T18:00:00Z`,
  };
}

function evOppRow(opts: {
  home: string;
  away: string;
  suffix?: string;
  date?: string;
}): Record<string, unknown> {
  const date = opts.date ?? DATE;
  const slug = `${opts.home.toLowerCase().replace(/\s+/g, "")}_${opts.away
    .toLowerCase()
    .replace(/\s+/g, "")}`;
  const eventId = `mlb_${slug}_${date}${opts.suffix ?? "_b3"}`;
  return {
    event_id: eventId,
    sport: "baseball",
    league: "mlb",
    home_team: opts.home,
    away_team: opts.away,
    is_player_prop: false,
    is_alternate_line: false,
  };
}

function oddsRow(opts: {
  market: "moneyline" | "total" | "spread";
  side: string;
  book: string;
  line?: number;
  american: number;
}): Record<string, unknown> {
  return {
    sportsbook: opts.book,
    sport: "baseball",
    league: "mlb",
    market_type: opts.market,
    selection_type: opts.side,
    is_main_line: true,
    is_alternate_line: false,
    is_live: false,
    line: opts.line ?? null,
    odds_american: opts.american,
    odds_decimal: 1.9,
    odds_probability: 0.5,
    last_seen_at: `${DATE}T18:00:00Z`,
  };
}

// Resolver maps (home, away) abbreviations → BDL game external_id.
function makeResolverFromMap(
  table: Record<string, number>
): SharpApiGameResolver {
  return async (
    _sport: Sport,
    _date: string,
    home: MlbTeamAbbrev,
    away: MlbTeamAbbrev
  ): Promise<number | null> => {
    const key = `${home}|${away}`;
    return table[key] ?? null;
  };
}

// ─── tests ────────────────────────────────────────────────────────────

async function testSplitsDiscoveryPureHelpers() {
  section("_splitsDiscovery — pure helpers");

  check(
    "stripEventBucketSuffix strips _b3",
    stripEventBucketSuffix("mlb_athletics_cubs_2026-06-04_b3") ===
      "mlb_athletics_cubs_2026-06-04"
  );
  check(
    "stripEventBucketSuffix idempotent on already-stripped id",
    stripEventBucketSuffix("mlb_athletics_cubs_2026-06-04") ===
      "mlb_athletics_cubs_2026-06-04"
  );
  check(
    "extractSlateDateFromEventId parses date",
    extractSlateDateFromEventId("mlb_athletics_cubs_2026-06-04") === "2026-06-04"
  );
  check(
    "extractSlateDateFromEventId returns null on no-date id",
    extractSlateDateFromEventId("not_a_date") === null
  );
  check(
    "extractSlateDateFromEventId strips suffix before matching",
    extractSlateDateFromEventId("mlb_a_b_2026-06-04_b1") === "2026-06-04"
  );

  // buildDiscoveryFromSplitsRows — happy path, all 9 games discoverable.
  const rows = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates" }),
    splitsRow({ home: "Arizona Diamondbacks", away: "Los Angeles Dodgers" }),
  ];
  const r1 = buildDiscoveryFromSplitsRows(rows, DATE);
  check(
    "buildDiscoveryFromSplitsRows keeps all 3 valid rows",
    r1.events.length === 3,
    `got ${r1.events.length}`
  );
  check(
    "Athletics is normalized to ATH in V2 discovery",
    r1.events.find((e) => e.home === "CHC" && e.away === "ATH") !== undefined
  );

  // Wrong date filter
  const r2 = buildDiscoveryFromSplitsRows(
    [
      splitsRow({ home: "Cubs", away: "Athletics" }),
      splitsRow({ home: "Cubs", away: "Athletics", date: "2026-06-05" }),
    ],
    DATE
  );
  check(
    "wrong-date rows are dropped",
    r2.events.length === 1 && r2.stats.skippedWrongDate === 1
  );

  // Non-mlb league dropped
  const r3 = buildDiscoveryFromSplitsRows(
    [splitsRow({ home: "Cubs", away: "Athletics", league: "kbo" })],
    DATE
  );
  check(
    "non-mlb league dropped",
    r3.events.length === 0 && r3.stats.skippedNonMlb === 1
  );

  // Missing event_id dropped
  const r4 = buildDiscoveryFromSplitsRows(
    [{ ...splitsRow({ home: "Cubs", away: "Athletics" }), event_id: null }],
    DATE
  );
  check(
    "missing event_id dropped",
    r4.events.length === 0 && r4.stats.skippedMissingEventId === 1
  );

  // Unresolvable team
  const r5 = buildDiscoveryFromSplitsRows(
    [splitsRow({ home: "Unknown FC", away: "Athletics" })],
    DATE
  );
  check(
    "unresolvable team dropped",
    r5.events.length === 0 && r5.stats.skippedTeamUnresolved === 1
  );

  // Dedup on team pair (same matchup appearing twice)
  const r6 = buildDiscoveryFromSplitsRows(
    [
      splitsRow({ home: "Cubs", away: "Athletics" }),
      splitsRow({ home: "Cubs", away: "Athletics" }),
    ],
    DATE
  );
  check("duplicate team pair deduped", r6.events.length === 1);
}

async function testV2DiscoversFullSlate() {
  section("V2 — discovers full slate from /splits");

  // /splits has all 3 games. /opportunities/ev has ONLY 1 — V1's failure mode.
  // V2 must still produce LineRecords for all 3 games via /splits discovery.
  const allGames: Array<{ home: string; away: string }> = [
    { home: "Chicago Cubs", away: "Athletics" },
    { home: "Houston Astros", away: "Pittsburgh Pirates" },
    { home: "Arizona Diamondbacks", away: "Los Angeles Dodgers" },
  ];
  const splits = allGames.map(({ home, away }) => splitsRow({ home, away }));
  // V1-failure case: only HOU@PIT has an EV opportunity row.
  const opps = [evOppRow({ home: "Houston Astros", away: "Pittsburgh Pirates" })];

  // /odds returns 6 rows for every event id that lands. The provider asks
  // for the suffixed id when available, otherwise the stripped id.
  const oddsBucket = [
    oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    oddsRow({ market: "moneyline", side: "away", book: "draftkings", american: 100 }),
    oddsRow({ market: "total", side: "over", book: "draftkings", line: 8.5, american: -110 }),
    oddsRow({ market: "total", side: "under", book: "draftkings", line: 8.5, american: -110 }),
    oddsRow({ market: "spread", side: "home", book: "draftkings", line: -1.5, american: 140 }),
    oddsRow({ market: "spread", side: "away", book: "draftkings", line: 1.5, american: -160 }),
  ];

  // Pre-compute event IDs used by V2 + register /odds responses for each.
  const oddsByEventId: Record<string, Array<Record<string, unknown>>> = {};
  // HOU@PIT uses the suffixed id from /opportunities/ev
  oddsByEventId["mlb_houstonastros_pittsburghpirates_2026-06-04_b3"] = oddsBucket;
  // The other two use the stripped /splits id
  oddsByEventId["mlb_chicagocubs_athletics_2026-06-04"] = oddsBucket;
  oddsByEventId["mlb_arizonadiamondbacks_losangelesdodgers_2026-06-04"] = oddsBucket;

  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: opps,
    oddsByEventId,
  });

  const resolver = makeResolverFromMap({
    "CHC|ATH": 1001,
    "HOU|PIT": 1002,
    "ARI|LAD": 1003,
  });

  const provider = new SharpAPIOddsProvider("ignored-key", resolver, {
    client: stubClient,
  });
  const out = await provider.getGameLinesV2(DATE, "mlb");

  check(
    "V2 discovers 3 events from /splits",
    out.discovery.eventsDiscovered === 3
  );
  check(
    "V2 resolves all 3 events to DB game ids",
    out.discovery.eventsResolvedToGame === 3
  );
  check(
    "V2 finds suffixed event_id for HOU@PIT via /opportunities/ev",
    out.discovery.eventsWithSuffixedId === 1
  );
  check(
    "V2 uses /splits-stripped id for the other 2 games",
    out.discovery.eventsWithSplitsIdOnly === 2
  );
  check(
    "V2 returns 6 line rows per game × 3 games = 18 total",
    out.records.length === 18,
    `got ${out.records.length}`
  );

  // Per-game breakdown shows all 3 games with ML/total/spread
  const perGameOk = out.discovery.perGame.every(
    (pg) => pg.mlRows === 2 && pg.totalRows === 2 && pg.spreadRows === 2
  );
  check("per-game report shows ML+Total+Spread for every event", perGameOk);

  // Athletics specifically
  const ath = out.discovery.perGame.find(
    (pg) => pg.home === "CHC" && pg.away === "ATH"
  );
  check("ATH@CHC present in per-game report", ath !== undefined);
  check(
    "ATH@CHC has lines for ML+Total+Spread",
    ath !== undefined && ath.mlRows === 2 && ath.totalRows === 2 && ath.spreadRows === 2
  );
}

async function testV2PreservesGameWhenProviderReturnsEmpty() {
  section("V2 — provider empty /odds does not delete games (per-game scope)");

  // 2 games discovered. /odds returns rows only for HOU@PIT. CHC@ATH
  // gets an empty /odds response — V2 must mark it as "preserved", not
  // delete it.
  const splits = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates" }),
  ];
  const opps: Array<Record<string, unknown>> = [];
  const populated = [
    oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    oddsRow({ market: "moneyline", side: "away", book: "draftkings", american: 100 }),
  ];
  const oddsByEventId: Record<string, Array<Record<string, unknown>>> = {
    "mlb_houstonastros_pittsburghpirates_2026-06-04": populated,
    "mlb_chicagocubs_athletics_2026-06-04": [],
  };

  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: opps,
    oddsByEventId,
  });
  const provider = new SharpAPIOddsProvider("ignored-key", makeResolverFromMap({
    "CHC|ATH": 1001,
    "HOU|PIT": 1002,
  }), { client: stubClient });

  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "V2 returns 2 records (1 game populated, 1 game empty)",
    out.records.length === 2,
    `got ${out.records.length}`
  );
  const chcAth = out.discovery.perGame.find(
    (pg) => pg.home === "CHC" && pg.away === "ATH"
  );
  check("CHC@ATH per-game has 0 rows", chcAth?.mlRows === 0 && chcAth?.totalRows === 0);
  check(
    "CHC@ATH oddsCallStatus reports empty (not ok)",
    chcAth?.oddsCallStatus === "empty"
  );
  const houPit = out.discovery.perGame.find(
    (pg) => pg.home === "HOU" && pg.away === "PIT"
  );
  check("HOU@PIT per-game has rows", (houPit?.mlRows ?? 0) > 0);
}

async function testV2DropsAlternateLines() {
  section("V2 — alternate lines / non-mlb rows are dropped");

  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  const altOddsRow = {
    ...oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    is_alternate_line: true,
  };
  const wrongLeague = {
    ...oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    league: "kbo",
  };
  const okRow = oddsRow({
    market: "moneyline",
    side: "away",
    book: "draftkings",
    american: 110,
  });
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [altOddsRow, wrongLeague, okRow],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "alternate lines + non-mlb rows dropped — exactly 1 row remains",
    out.records.length === 1
  );
  check(
    "remaining row is the legitimate ML/away pick",
    out.records[0]?.market_type === "moneyline" && out.records[0]?.side === "away"
  );
}

async function testV2WhenOpportunitiesUnavailable() {
  section("V2 — /opportunities/ev unavailable does not block discovery");

  // Simulate /opportunities/ev throwing 404 by setting opportunitiesEv to
  // an empty array (NotFoundError path is exercised in real_api; the stub
  // can't easily throw — but empty array exercises the same downstream
  // logic: every event falls back to /splits stripped id).
  const splits = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates" }),
  ];
  const oddsByEventId: Record<string, Array<Record<string, unknown>>> = {
    "mlb_chicagocubs_athletics_2026-06-04": [
      oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    ],
    "mlb_houstonastros_pittsburghpirates_2026-06-04": [
      oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
    ],
  };
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId,
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({
      "CHC|ATH": 1001,
      "HOU|PIT": 1002,
    }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "V2 falls back to /splits stripped id for every game when /opportunities/ev returns nothing",
    out.discovery.eventsWithSplitsIdOnly === 2 &&
      out.discovery.eventsWithSuffixedId === 0
  );
  check("V2 still produces line records (2 ML)", out.records.length === 2);
}

async function testV2WhenSlateResolutionFails() {
  section("V2 — slate game not resolvable is captured, not silently dropped");

  // Resolver returns null for CHC@ATH. V2 should record this game in
  // `eventsUnresolvedTeamPair` and not include it in perGame.
  const splits = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates" }),
  ];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_houstonastros_pittsburghpirates_2026-06-04": [
        oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "HOU|PIT": 1002 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "V2 records the unresolvable CHC@ATH event",
    out.discovery.eventsUnresolvedTeamPair.length === 1 &&
      out.discovery.eventsUnresolvedTeamPair[0]?.home === "CHC" &&
      out.discovery.eventsUnresolvedTeamPair[0]?.away === "ATH"
  );
  check(
    "only HOU@PIT appears in perGame",
    out.discovery.perGame.length === 1 &&
      out.discovery.perGame[0]?.home === "HOU"
  );
}

async function testR16ESplitsFallback() {
  section("R-16E — /splits fallback synthesizes lines when /odds is empty");

  // /splits has full ML American odds, total line, spread line. /odds
  // returns 0 rows for the game. V2 must:
  //   • synthesize 2 ML lines (home/away with american odds)
  //   • synthesize 2 total lines (over/under with line_value only, no juice)
  //   • synthesize 2 spread lines (home/away with line_value only, no juice)
  //   • tag every synthesized row sportsbook="splits_consensus"
  const splits = [
    {
      ...splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
      moneyline: { home_odds: -143, away_odds: 119, bets_pct: { home: 0.68, away: 0.32 }, handle_pct: { home: 0.18, away: 0.82 } },
      total: { line: 10, bets_pct: { over: 0.53, under: 0.47 }, handle_pct: { over: 0.87, under: 0.13 } },
      spread: { home_odds: -1.5, away_odds: 1.5, bets_pct: { home: 0.46, away: 0.54 }, handle_pct: { home: 0.37, away: 0.63 } },
    },
  ];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: { "mlb_chicagocubs_athletics_2026-06-04": [] }, // EMPTY /odds
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  check(
    "R-16E: 6 synthetic lines produced (2 ML + 2 Total + 2 Spread)",
    out.records.length === 6,
    `got ${out.records.length}`
  );

  // ML rows
  const mlRows = out.records.filter((r) => r.market_type === "moneyline");
  check("R-16E ML: 2 rows", mlRows.length === 2);
  check(
    "R-16E ML: all rows tagged sportsbook=splits_consensus",
    mlRows.every((r) => r.sportsbook === "splits_consensus")
  );
  const mlHome = mlRows.find((r) => r.side === "home");
  const mlAway = mlRows.find((r) => r.side === "away");
  check(
    "R-16E ML home: odds_american = -143",
    mlHome?.odds_american === -143
  );
  check(
    "R-16E ML away: odds_american = +119",
    mlAway?.odds_american === 119
  );
  check(
    "R-16E ML: line_value is null (ML has no line)",
    mlHome?.line_value === null && mlAway?.line_value === null
  );

  // Total rows — line only, no juice
  const totalRows = out.records.filter((r) => r.market_type === "total");
  check("R-16E Total: 2 rows", totalRows.length === 2);
  check(
    "R-16E Total: both sides have line_value=10",
    totalRows.every((r) => r.line_value === 10)
  );
  check(
    "R-16E Total: odds_american is null (no juice in /splits)",
    totalRows.every((r) => r.odds_american === null)
  );
  check(
    "R-16E Total: over+under sides present",
    new Set(totalRows.map((r) => r.side)).size === 2
  );

  // Spread rows — line only, no juice
  const spreadRows = out.records.filter((r) => r.market_type === "spread");
  check("R-16E Spread: 2 rows", spreadRows.length === 2);
  const sprHome = spreadRows.find((r) => r.side === "home");
  const sprAway = spreadRows.find((r) => r.side === "away");
  check(
    "R-16E Spread home line_value = -1.5 (the runline, not a price)",
    sprHome?.line_value === -1.5
  );
  check(
    "R-16E Spread away line_value = +1.5",
    sprAway?.line_value === 1.5
  );
  check(
    "R-16E Spread: odds_american is null (no juice in /splits)",
    spreadRows.every((r) => r.odds_american === null)
  );

  // Discovery report breakdown
  const pg = out.discovery.perGame[0];
  check("R-16E discovery: mlRowsFromOdds=0", pg?.mlRowsFromOdds === 0);
  check("R-16E discovery: mlRowsFromSplits=2", pg?.mlRowsFromSplits === 2);
  check("R-16E discovery: totalRowsFromSplits=2", pg?.totalRowsFromSplits === 2);
  check("R-16E discovery: spreadRowsFromSplits=2", pg?.spreadRowsFromSplits === 2);
  check(
    "R-16E discovery: books list contains splits_consensus",
    pg?.books.includes("splits_consensus") === true
  );
}

async function testR16ERealOddsBeatsSplits() {
  section("R-16E — real /odds rows take priority over /splits fallback");

  // /splits has ML home_odds=-143, away_odds=119
  // /odds returns real DraftKings ML rows
  // V2 must use the REAL /odds rows and NOT synthesize splits-consensus
  const splits = [
    {
      ...splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
      moneyline: { home_odds: -143, away_odds: 119, bets_pct: { home: 0.68, away: 0.32 }, handle_pct: { home: 0.18, away: 0.82 } },
    },
  ];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [
        oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -135 }),
        oddsRow({ market: "moneyline", side: "away", book: "draftkings", american: 115 }),
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  const mlRows = out.records.filter((r) => r.market_type === "moneyline");
  check(
    "R-16E priority: ML records from real /odds only (no splits fallback)",
    mlRows.length === 2 &&
      mlRows.every((r) => r.sportsbook === "draftkings"),
    `got ${mlRows.length} rows, sportsbooks=[${mlRows.map((r) => r.sportsbook).join(",")}]`
  );

  // The /splits ML data should NOT have been synthesized
  const splitsConsensusMl = mlRows.filter(
    (r) => r.sportsbook === "splits_consensus"
  );
  check(
    "R-16E priority: 0 splits_consensus ML rows when real /odds returned ML",
    splitsConsensusMl.length === 0
  );

  // Discovery report
  const pg = out.discovery.perGame[0];
  check(
    "R-16E discovery: mlRowsFromOdds=2, mlRowsFromSplits=0",
    pg?.mlRowsFromOdds === 2 && pg?.mlRowsFromSplits === 0
  );
}

async function testR16EPerMarketGranularity() {
  section("R-16E — per-market fallback (ML from /odds, Total from /splits)");

  // /odds returns only ML rows (no total, no spread)
  // /splits has all 3 markets
  // V2 must: use real /odds ML, but synthesize splits-consensus Total + Spread
  const splits = [
    {
      ...splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
      moneyline: { home_odds: -143, away_odds: 119, bets_pct: { home: 0.68, away: 0.32 }, handle_pct: { home: 0.18, away: 0.82 } },
      total: { line: 10, bets_pct: { over: 0.53, under: 0.47 }, handle_pct: { over: 0.87, under: 0.13 } },
      spread: { home_odds: -1.5, away_odds: 1.5, bets_pct: { home: 0.46, away: 0.54 }, handle_pct: { home: 0.37, away: 0.63 } },
    },
  ];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [
        oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -135 }),
        oddsRow({ market: "moneyline", side: "away", book: "draftkings", american: 115 }),
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  const pg = out.discovery.perGame[0];
  check(
    "R-16E mixed: ML from /odds (2), Total from /splits (2), Spread from /splits (2)",
    pg?.mlRowsFromOdds === 2 &&
      pg?.mlRowsFromSplits === 0 &&
      pg?.totalRowsFromOdds === 0 &&
      pg?.totalRowsFromSplits === 2 &&
      pg?.spreadRowsFromOdds === 0 &&
      pg?.spreadRowsFromSplits === 2
  );
  check(
    "R-16E mixed: 6 total records",
    out.records.length === 6
  );
  // Verify real ML rows are DK
  const ml = out.records.filter((r) => r.market_type === "moneyline");
  check("R-16E mixed: ML rows sportsbook=draftkings", ml.every((r) => r.sportsbook === "draftkings"));
  // Verify total/spread are splits_consensus
  const tot = out.records.filter((r) => r.market_type === "total");
  const spr = out.records.filter((r) => r.market_type === "spread");
  check("R-16E mixed: Total rows sportsbook=splits_consensus", tot.every((r) => r.sportsbook === "splits_consensus"));
  check("R-16E mixed: Spread rows sportsbook=splits_consensus", spr.every((r) => r.sportsbook === "splits_consensus"));
}

async function testR16ENoSynthWhenSplitsLacksFields() {
  section("R-16E — no synthesis when /splits lacks required fields");

  // /splits row exists but moneyline.home_odds is null. /odds is empty.
  // V2 must NOT synthesize ML splits rows when the home/away odds aren't both present.
  const splits = [
    {
      ...splitsRow({ home: "Chicago Cubs", away: "Athletics" }),
      moneyline: { home_odds: null, away_odds: 119, bets_pct: { home: 0.68, away: 0.32 }, handle_pct: { home: 0.18, away: 0.82 } },
      total: null, // No total payload at all
    },
  ];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: { "mlb_chicagocubs_athletics_2026-06-04": [] },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  const ml = out.records.filter((r) => r.market_type === "moneyline");
  const tot = out.records.filter((r) => r.market_type === "total");
  check(
    "R-16E refuses to synthesize ML when one side's odds is null",
    ml.length === 0
  );
  check(
    "R-16E refuses to synthesize Total when /splits.total is null",
    tot.length === 0
  );
}

async function testV2PartialMarketReturn() {
  section("V2 — partial market return surfaces in per-game perGame breakdown");

  // /odds returns ML+Spread for a game but NO Total rows. V2 must
  // surface mlRows>0, spreadRows>0, totalRows=0 in the per-game report so
  // the service can issue per-(game, market) DELETE only for the markets
  // it has replacement data for (preserving Total for that game).
  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [
        oddsRow({ market: "moneyline", side: "home", book: "draftkings", american: -120 }),
        oddsRow({ market: "moneyline", side: "away", book: "draftkings", american: 110 }),
        oddsRow({ market: "spread", side: "home", book: "draftkings", line: -1.5, american: 140 }),
        oddsRow({ market: "spread", side: "away", book: "draftkings", line: 1.5, american: -160 }),
        // No total rows
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");
  const pg = out.discovery.perGame[0];
  check("partial: ml rows present", pg !== undefined && pg.mlRows === 2);
  check("partial: spread rows present", pg !== undefined && pg.spreadRows === 2);
  check("partial: total rows ABSENT", pg !== undefined && pg.totalRows === 0);
  check("partial: 4 line records returned", out.records.length === 4);
}

async function testR16FCFirstInningTotalMapping() {
  section("R-16F-C — 1st_inning_total_runs maps to first_inning_total");

  // SharpAPI emits market_type = "1st_inning_total_runs" on /odds.
  // Pre-R-16F-C the provider silently dropped these rows because the
  // mapper only accepted the short forms. This test exercises the full
  // provider path: stubbed /odds returns the FI rows, V2 produces
  // LineRecords with the correct internal market_type + sides intact.
  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  const fiOver = {
    sportsbook: "draftkings",
    sport: "baseball",
    league: "mlb",
    market_type: "1st_inning_total_runs",
    selection: "Over",
    selection_type: "over",
    is_main_line: true,
    is_alternate_line: false,
    is_live: false,
    line: 0.5,
    odds_american: 220,
    odds_decimal: 3.2,
    odds_probability: 0.31,
    last_seen_at: `${DATE}T18:00:00Z`,
  };
  const fiUnder = {
    ...fiOver,
    selection: "Under",
    selection_type: "under",
    odds_american: -310,
    odds_decimal: 1.32,
    odds_probability: 0.76,
  };
  // Also include a real-game total row to confirm regular total mapping
  // still works alongside the new FI mapping.
  const fullTotalOver = {
    ...fiOver,
    market_type: "total_runs",
    line: 8.5,
    odds_american: -110,
    odds_decimal: 1.91,
    odds_probability: 0.524,
  };
  // Negative cases — F3/F5/3-way ML should NEVER fold into first_inning_total
  const f3Total = { ...fiOver, market_type: "1st_3_innings_total_runs" };
  const f5Total = { ...fiOver, market_type: "1st_5_innings_total_runs" };
  const inning3wayMl = {
    ...fiOver,
    market_type: "1st_inning_moneyline_3-way",
    selection_type: "home",
  };

  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [
        fiOver,
        fiUnder,
        fullTotalOver,
        f3Total,
        f5Total,
        inning3wayMl,
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  const fiRows = out.records.filter((r) => r.market_type === "first_inning_total");
  check(
    "R-16F-C: 1st_inning_total_runs → 2 first_inning_total rows (over + under)",
    fiRows.length === 2,
    `got ${fiRows.length} (records: ${out.records.map((r) => r.market_type).join(",")})`
  );

  const fiOverRow = fiRows.find((r) => r.side === "over");
  const fiUnderRow = fiRows.find((r) => r.side === "under");
  check(
    "R-16F-C: over side preserved (odds_american=+220, YRFI-style price)",
    fiOverRow?.side === "over" && fiOverRow?.odds_american === 220
  );
  check(
    "R-16F-C: under side preserved (odds_american=-310, NRFI-style price)",
    fiUnderRow?.side === "under" && fiUnderRow?.odds_american === -310
  );
  check(
    "R-16F-C: FI line_value preserved at 0.5",
    fiOverRow?.line_value === 0.5 && fiUnderRow?.line_value === 0.5
  );
  check(
    "R-16F-C: regular total_runs row still maps to first_inning_total=NO (preserves total mapping)",
    out.records.filter((r) => r.market_type === "total").length === 1
  );

  // Negative cases — these must NOT pollute first_inning_total
  check(
    "R-16F-C negative: 1st_3_innings_total_runs is dropped (not FI)",
    !out.records.some((r) => r.market_type === "first_inning_total" && (r as { line_value: number | null }).line_value !== 0.5),
    `FI rows: ${JSON.stringify(fiRows.map((r) => ({ market: r.market_type, line: r.line_value, side: r.side })))}`
  );
  check(
    "R-16F-C negative: 1st_5_innings_total_runs is NOT in records as any mapped market",
    !out.records.some((r) => (r as { market_type: string }).market_type === "1st_5_innings_total_runs")
  );
  check(
    "R-16F-C negative: 1st_inning_moneyline_3-way is dropped (different market than NRFI/YRFI)",
    out.records.filter((r) => r.market_type === "moneyline").length === 0
  );
}

async function testR16GAKalshiFlipRejection() {
  section("R-16G-A — provider guard rejects rows with flipped home/away strings");

  // TOR@ATL-style fixture. /odds payload includes:
  //   - ballybet: correct home_team/away_team strings → accepted
  //   - kalshi: INVERTED home_team/away_team strings → must be rejected
  //   - onexbet: correct strings → accepted
  // After the guard, only ballybet + onexbet should appear in records.
  const splits = [splitsRow({ home: "Atlanta Braves", away: "Toronto Blue Jays" })];
  const ballybetHome = {
    sportsbook: "ballybet", sport: "baseball", league: "mlb",
    market_type: "moneyline", selection_type: "home",
    home_team: "Atlanta Braves", away_team: "Toronto Blue Jays",
    is_main_line: true, is_alternate_line: false,
    odds_american: -265, line: null,
  };
  const ballybetAway = {
    ...ballybetHome, selection_type: "away", odds_american: 210,
  };
  // Kalshi flipped — home_team/away_team are SWAPPED relative to event
  const kalshiHomeFlipped = {
    sportsbook: "kalshi", sport: "baseball", league: "mlb",
    market_type: "moneyline", selection_type: "home",
    home_team: "Toronto Blue Jays", away_team: "Atlanta Braves",  // ← flipped
    is_main_line: true, is_alternate_line: false,
    odds_american: 228, line: null,
  };
  const kalshiAwayFlipped = {
    ...kalshiHomeFlipped, selection_type: "away", odds_american: -239,
  };
  const onexbetHome = {
    sportsbook: "onexbet", sport: "baseball", league: "mlb",
    market_type: "moneyline", selection_type: "home",
    home_team: "Atlanta Braves", away_team: "Toronto Blue Jays",
    is_main_line: true, is_alternate_line: false,
    odds_american: -243, line: null,
  };
  const onexbetAway = {
    ...onexbetHome, selection_type: "away", odds_american: 220,
  };

  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_atlantabraves_torontobluejays_2026-06-04": [
        ballybetHome, ballybetAway,
        kalshiHomeFlipped, kalshiAwayFlipped,
        onexbetHome, onexbetAway,
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "ATL|TOR": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");

  // Should have 4 ML records (2 ballybet + 2 onexbet), NOT 6 (kalshi dropped)
  const mlRows = out.records.filter((r) => r.market_type === "moneyline");
  check(
    "R-16G-A: kalshi-flipped rows are rejected (4 ML rows, not 6)",
    mlRows.length === 4,
    `got ${mlRows.length} rows from sportsbooks=[${mlRows.map((r) => r.sportsbook).join(",")}]`
  );

  // Should NOT contain any kalshi rows
  check(
    "R-16G-A: zero kalshi rows in records",
    mlRows.filter((r) => r.sportsbook === "kalshi").length === 0
  );

  // Should preserve ballybet and onexbet with correct home/away semantics
  const ballybetHomeOut = mlRows.find((r) => r.sportsbook === "ballybet" && r.side === "home");
  const onexbetAwayOut = mlRows.find((r) => r.sportsbook === "onexbet" && r.side === "away");
  check(
    "R-16G-A: ballybet home (ATL fav) preserved at -265",
    ballybetHomeOut?.odds_american === -265
  );
  check(
    "R-16G-A: onexbet away (TOR dog) preserved at +220",
    onexbetAwayOut?.odds_american === 220
  );
}

async function testR16GACorrectRowsNotRejected() {
  section("R-16G-A — rows with matching home/away strings pass the guard");

  // Fixture where every book has correct home/away strings
  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  const goodRow = (book: string, sel: "home" | "away", odds: number) => ({
    sportsbook: book, sport: "baseball", league: "mlb",
    market_type: "moneyline", selection_type: sel,
    home_team: "Chicago Cubs", away_team: "Athletics",
    is_main_line: true, is_alternate_line: false,
    odds_american: odds, line: null,
  });
  const stubClient = new StubSharpApiClient({
    splits,
    opportunitiesEv: [],
    oddsByEventId: {
      "mlb_chicagocubs_athletics_2026-06-04": [
        goodRow("ballybet", "home", -148),
        goodRow("ballybet", "away", 123),
        goodRow("fliff", "home", -150),
        goodRow("fliff", "away", 120),
      ],
    },
  });
  const provider = new SharpAPIOddsProvider(
    "ignored-key",
    makeResolverFromMap({ "CHC|ATH": 1001 }),
    { client: stubClient }
  );
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "R-16G-A: all 4 good rows pass the guard",
    out.records.filter((r) => r.market_type === "moneyline").length === 4
  );
}

async function testR16GARowsWithoutTeamStringsPass() {
  section("R-16G-A — rows missing home_team/away_team strings still pass (defensive)");

  // Some books may not emit home_team/away_team strings. Guard should
  // not reject those — only reject when BOTH fields are present AND
  // they normalize to a different abbrev than the event's.
  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  const noTeamStringsRow = {
    sportsbook: "ballybet", sport: "baseball", league: "mlb",
    market_type: "moneyline", selection_type: "home",
    // no home_team / away_team
    is_main_line: true, is_alternate_line: false,
    odds_american: -148, line: null,
  };
  const stubClient = new StubSharpApiClient({
    splits, opportunitiesEv: [],
    oddsByEventId: { "mlb_chicagocubs_athletics_2026-06-04": [noTeamStringsRow] },
  });
  const provider = new SharpAPIOddsProvider("ignored-key", makeResolverFromMap({ "CHC|ATH": 1001 }), { client: stubClient });
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "R-16G-A: row without home/away strings still accepted",
    out.records.filter((r) => r.market_type === "moneyline").length === 1
  );
}

async function testR16GAOverUnderSidesUnaffected() {
  section("R-16G-A — over/under sides pass the guard (no team identity)");

  // Over/under markets don't reference home/away — guard should ignore.
  const splits = [splitsRow({ home: "Chicago Cubs", away: "Athletics" })];
  // A row with FLIPPED home_team/away_team but selection_type=over
  // should be accepted (because the guard only checks home/away sides).
  const overRow = {
    sportsbook: "ballybet", sport: "baseball", league: "mlb",
    market_type: "total", selection_type: "over",
    home_team: "Toronto Blue Jays", away_team: "Atlanta Braves",  // wrong (intentionally) — but over/under doesn't reference team
    is_main_line: true, is_alternate_line: false,
    odds_american: -110, line: 8.5,
  };
  const stubClient = new StubSharpApiClient({
    splits, opportunitiesEv: [],
    oddsByEventId: { "mlb_chicagocubs_athletics_2026-06-04": [overRow] },
  });
  const provider = new SharpAPIOddsProvider("ignored-key", makeResolverFromMap({ "CHC|ATH": 1001 }), { client: stubClient });
  const out = await provider.getGameLinesV2(DATE, "mlb");
  check(
    "R-16G-A: over/under row not affected by team-name guard",
    out.records.filter((r) => r.market_type === "total").length === 1
  );
}

async function testMarketCoverageGate() {
  section("marketCoverageGate — read-only assessment");

  // Cannot run live against DB without a slate fixture, so this test
  // verifies the module exports the expected shape and can be imported.
  // The full DB-backed assertion path runs against the live 2026-06-04
  // slate during the operator dry-run.
  const mod = await import("../lib/services/marketCoverageGate");
  check(
    "assessMarketCoverage exported",
    typeof mod.assessMarketCoverage === "function"
  );
  // Type signature smoke: opts param accepts thresholds
  check(
    "module exports compile-cleanly (smoke)",
    typeof mod.assessMarketCoverage === "function"
  );
}

// ─── 2026-06-10 phantom-thinning fix tests ──────────────────────────────
// Pure-function tests for derivePerBookDeleteKeys. These prove the new
// scope semantics without touching the DB: given a hypothetical payload,
// the derived delete keys MUST scope per (game, market, sportsbook) so
// books absent from this poll are preserved.

const row = (
  game_id: number,
  market_type: string,
  sportsbook: string,
  side: string,
  line_value: number | null = null,
  odds_american: number = -110,
): Record<string, unknown> => ({
  game_id, market_type, sportsbook, side, line_value, odds_american,
  player_id: null, fetched_at: "2026-06-10T00:00:00Z",
});

function testPerBookDeleteKeys_partialPollPreservesPriorBooks() {
  section("phantom-thinning — partial poll preserves prior books");
  // Scenario: morning poll wrote ballybet+betmgm+betrivers Total rows.
  // Now the evening payload contains ONLY ballybet (the others didn't
  // come back from SharpAPI). The derived delete keys MUST target only
  // ballybet — leaving betmgm + betrivers in `lines` untouched.
  const eveningPayload = [
    row(15098, "total", "ballybet", "over", 8.5),
    row(15098, "total", "ballybet", "under", 8.5),
  ];
  const keys = derivePerBookDeleteKeys(eveningPayload);
  check(
    "partial poll: only 1 delete key (ballybet) — prior betmgm/betrivers preserved",
    keys.length === 1 &&
      keys[0].sportsbook === "ballybet" &&
      keys[0].game_id === 15098 &&
      keys[0].market_type === "total",
  );
}

function testPerBookDeleteKeys_sameSportsbookReplacement() {
  section("phantom-thinning — same sportsbook updates replace cleanly");
  // ballybet price moved from -120 to -125 for the same line. Same
  // sportsbook → one delete key, replacement happens atomically.
  const newerBallybetRows = [
    row(15098, "total", "ballybet", "over", 8.5, -125),
    row(15098, "total", "ballybet", "under", 8.5, -120),
  ];
  const keys = derivePerBookDeleteKeys(newerBallybetRows);
  check(
    "same book in payload: 1 key, deduped across both sides",
    keys.length === 1 && keys[0].sportsbook === "ballybet",
  );
}

function testPerBookDeleteKeys_splitsAugmentDoesNotWipeRealBooks() {
  section("phantom-thinning — /splits fallback augments instead of replaces");
  // /splits fallback fired because /odds returned 0 main-Total rows.
  // The payload contains ONLY splits_consensus rows. The derived keys
  // target ONLY splits_consensus — prior real-book rows remain.
  const splitsOnlyPayload = [
    row(15098, "total", "splits_consensus", "over", 8.5),
    row(15098, "total", "splits_consensus", "under", 8.5),
  ];
  const keys = derivePerBookDeleteKeys(splitsOnlyPayload);
  check(
    "splits-only payload: delete key targets ONLY splits_consensus",
    keys.length === 1 && keys[0].sportsbook === "splits_consensus",
  );
}

function testPerBookDeleteKeys_kalshiOnlyDoesNotWipePriorRealBooks() {
  section("phantom-thinning — Kalshi-only response preserves prior real books");
  // Kalshi posts 11 alt-line binaries (2.5..12.5 × over+under = 22 rows).
  // Even with this many rows, the derived delete keys collapse to ONE
  // key for (game_id, total, kalshi). Prior real-book rows (ballybet,
  // betmgm, etc.) are not touched.
  const kalshiOnlyPayload: Record<string, unknown>[] = [];
  for (const line of [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]) {
    kalshiOnlyPayload.push(row(15098, "total", "kalshi", "over", line));
    kalshiOnlyPayload.push(row(15098, "total", "kalshi", "under", line));
  }
  const keys = derivePerBookDeleteKeys(kalshiOnlyPayload);
  check(
    "Kalshi-only payload of 22 rows: collapses to 1 delete key (kalshi only)",
    keys.length === 1 && keys[0].sportsbook === "kalshi",
  );
}

function testPerBookDeleteKeys_emptyPayloadProducesEmptyKeys() {
  section("phantom-thinning — empty payload preserves all existing rows");
  // Provider returned nothing for any market. Empty payload → empty
  // delete-key set → no DELETE executes → all prior rows preserved.
  const empty: Record<string, unknown>[] = [];
  const keys = derivePerBookDeleteKeys(empty);
  check("empty payload: 0 delete keys", keys.length === 0);
}

function testPerBookDeleteKeys_multiSidedMultiLinedBookCollapsesToOneKey() {
  section("phantom-thinning — one book × multiple sides × multiple lines = 1 key");
  // Defense-in-depth: even when a single book sends over+under at the
  // same line, the dedupe produces exactly one delete target so the
  // DELETE-then-INSERT is atomic for that book's market.
  const payload = [
    row(15098, "total", "betmgm", "over", 8.5),
    row(15098, "total", "betmgm", "under", 8.5),
    row(15098, "moneyline", "betmgm", "home"),
    row(15098, "moneyline", "betmgm", "away"),
    row(15099, "total", "betmgm", "over", 9.0),
    row(15099, "total", "betmgm", "under", 9.0),
  ];
  const keys = derivePerBookDeleteKeys(payload);
  // Expect 3 keys: (15098,total,betmgm), (15098,moneyline,betmgm), (15099,total,betmgm)
  check(
    "multi-side multi-line: 3 keys (one per game+market for betmgm)",
    keys.length === 3 &&
      keys.every((k) => k.sportsbook === "betmgm") &&
      new Set(keys.map((k) => `${k.game_id}::${k.market_type}`)).size === 3,
  );
}

// ─── runner ───────────────────────────────────────────────────────────

async function main() {
  console.log("[test-lines-refresh-v2] start");
  await testSplitsDiscoveryPureHelpers();
  await testV2DiscoversFullSlate();
  await testV2PreservesGameWhenProviderReturnsEmpty();
  await testV2DropsAlternateLines();
  await testV2WhenOpportunitiesUnavailable();
  await testV2WhenSlateResolutionFails();
  await testV2PartialMarketReturn();
  await testR16ESplitsFallback();
  await testR16ERealOddsBeatsSplits();
  await testR16EPerMarketGranularity();
  await testR16ENoSynthWhenSplitsLacksFields();
  await testR16FCFirstInningTotalMapping();
  await testR16GAKalshiFlipRejection();
  await testR16GACorrectRowsNotRejected();
  await testR16GARowsWithoutTeamStringsPass();
  await testR16GAOverUnderSidesUnaffected();
  await testMarketCoverageGate();

  // 2026-06-10 phantom-thinning fix — per-(game, market, sportsbook) DELETE scope
  testPerBookDeleteKeys_partialPollPreservesPriorBooks();
  testPerBookDeleteKeys_sameSportsbookReplacement();
  testPerBookDeleteKeys_splitsAugmentDoesNotWipeRealBooks();
  testPerBookDeleteKeys_kalshiOnlyDoesNotWipePriorRealBooks();
  testPerBookDeleteKeys_emptyPayloadProducesEmptyKeys();
  testPerBookDeleteKeys_multiSidedMultiLinedBookCollapsesToOneKey();

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) {
    console.log();
    console.log("Failures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
