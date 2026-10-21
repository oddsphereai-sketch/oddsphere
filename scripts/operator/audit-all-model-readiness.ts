/**
 * All-model source + locking readiness audit (READ-ONLY).
 *
 * Gives operators one slate-level view of whether each sport has the minimum
 * plumbing needed for a trustworthy betting card:
 *   - scheduled/final games
 *   - current line rows by market
 *   - public split rows by market
 *   - prediction_records by market
 *   - locked records
 *   - records missing odds/line values
 *
 * No writes. No provider calls. DB snapshot only.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-all-model-readiness.ts
 *   npx tsx --env-file=.env.local scripts/operator/audit-all-model-readiness.ts --date 2026-06-24 --json
 */

import { supabase } from "../../lib/db/supabase";
import { isPublicallyTracked } from "../../lib/config/officialTrackingStart";
import { readBoolFlag, readStringFlag, todayUTC } from "./_cliCommon";
import {
  DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS,
  type DailyEdgeHealthSport,
} from "../../lib/services/dailyEdge/dailyEdgeCompleteHealthContract";
import { readCfbForwardMemberSnapshot } from "../../lib/services/football/cfbForwardMemberSnapshotStore";
import { readNflForwardMemberSnapshot } from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

type Sport = DailyEdgeHealthSport;

const SPORTS = Object.keys(DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS) as Sport[];

const EXPECTED_MARKETS = Object.fromEntries(SPORTS.map((sport) => [sport, DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS[sport].expectedMarkets])) as Record<Sport, readonly string[]>;
const LINE_MARKETS = Object.fromEntries(SPORTS.map((sport) => [sport, DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS[sport].lineMarkets])) as Record<Sport, readonly string[]>;
const LINE_VALUE_REQUIRED_MARKETS = Object.fromEntries(SPORTS.map((sport) => [sport, DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS[sport].lineValueRequiredMarkets])) as Record<Sport, ReadonlySet<string>>;

type CountByMarket = Record<string, number>;

type SportReport = {
  sport: Sport;
  date: string;
  games: {
    total: number;
    scheduled: number;
    final: number;
    other: number;
  };
  linesByMarket: CountByMarket;
  publicSplitsByMarket: CountByMarket;
  predictionRecordsByMarket: CountByMarket;
  expectedMarketsMissingRecords: string[];
  records: {
    total: number;
    locked: number;
    missingOdds: number;
    missingLineValue: number;
    held: number;
    noBet: number;
  };
  freshness: {
    newestLineAt: string | null;
    oldestLineAt: string | null;
    maximumLineAgeMinutes: number | null;
    gamesWithoutAnyLine: number;
    newestSplitAt: string | null;
    oldestSplitAt: string | null;
    maximumSplitAgeMinutes: number | null;
  };
  notes: string[];
};

type DbGame = {
  id: number;
  status: string | null;
};

type DbMarketRow = {
  game_id?: number | null;
  market_type?: string | null;
  market?: string | null;
  fetched_at?: string | null;
};

type DbSignalRow = {
  game_id: number | null;
  market_type: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  computed_at: string | null;
};

type DbSplitObservationRow = DbSignalRow & { provider: string | null; observed_at: string | null };

type DbRecordRow = {
  game_id: number | null;
  market: string | null;
  side: string | null;
  locked_at: string | null;
  odds_american: number | null;
  line_value: number | null;
  held: boolean | null;
  no_bet: boolean | null;
};

function inc(map: CountByMarket, key: string | null | undefined): void {
  const k = key ?? "unknown";
  map[k] = (map[k] ?? 0) + 1;
}

function countMarkets(rows: readonly DbMarketRow[], key: "market_type" | "market"): CountByMarket {
  const out: CountByMarket = {};
  for (const r of rows) inc(out, r[key]);
  return out;
}

function formatCounts(counts: CountByMarket): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(", ") : "-";
}

function requiresLineValue(sport: Sport, market: string | null): boolean {
  return market !== null && LINE_VALUE_REQUIRED_MARKETS[sport].has(market);
}

function freshness(values: Array<string | null | undefined>): {
  newest: string | null; oldest: string | null; maximumAgeMinutes: number | null;
} {
  const valid = values
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (valid.length === 0) return { newest: null, oldest: null, maximumAgeMinutes: null };
  return {
    newest: new Date(valid.at(-1)!).toISOString(),
    oldest: new Date(valid[0]!).toISOString(),
    maximumAgeMinutes: Math.max(0, Math.round((Date.now() - valid[0]!) / 60_000)),
  };
}

function maximumLatestAgeByGame(rows: Array<{ game_id?: number | null; observedAt?: string | null }>): number | null {
  const latestByGame = new Map<number, number>();
  for (const row of rows) {
    if (typeof row.game_id !== "number" || !row.observedAt) continue;
    const time = Date.parse(row.observedAt);
    if (!Number.isFinite(time)) continue;
    latestByGame.set(row.game_id, Math.max(latestByGame.get(row.game_id) ?? 0, time));
  }
  if (latestByGame.size === 0) return null;
  return Math.max(...[...latestByGame.values()].map((time) => Math.max(0, Math.round((Date.now() - time) / 60_000))));
}

async function auditSport(sport: Sport, date: string): Promise<SportReport> {
  if (sport === "nfl" || sport === "cfb") return auditFootballSnapshot(sport, date);
  const { data: gamesRaw, error: gamesErr } = await supabase
    .from("games")
    .select("id,status")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (gamesErr) throw new Error(`${sport} games query failed: ${gamesErr.message}`);
  const games = (gamesRaw ?? []) as DbGame[];
  const gameIds = games.map((g) => g.id);

  const notes: string[] = [];
  const predictionWindowOpen = sport !== "nba" || isPublicallyTracked("nba", date);
  if (gameIds.length === 0) {
    return {
      sport,
      date,
      games: { total: 0, scheduled: 0, final: 0, other: 0 },
      linesByMarket: {},
      publicSplitsByMarket: {},
      predictionRecordsByMarket: {},
      // An inactive/offseason slate is not missing model output. The product
      // should show "No games today," and the audit should not manufacture
      // missing-market findings for games that do not exist.
      expectedMarketsMissingRecords: [],
      records: { total: 0, locked: 0, missingOdds: 0, missingLineValue: 0, held: 0, noBet: 0 },
      freshness: { newestLineAt: null, oldestLineAt: null, maximumLineAgeMinutes: null, gamesWithoutAnyLine: 0, newestSplitAt: null, oldestSplitAt: null, maximumSplitAgeMinutes: null },
      notes: ["no games on slate"],
    };
  }

  const { data: linesRaw, error: linesErr } = await supabase
    .from("lines")
    .select("game_id,market_type,fetched_at")
    .in("game_id", gameIds)
    .in("market_type", [...LINE_MARKETS[sport]]);
  if (linesErr) notes.push(`lines query failed: ${linesErr.message}`);

  const { data: sigRaw, error: sigErr } = await supabase
    .from("sharp_signals")
    .select("game_id,market_type,public_betting_pct,public_money_pct,computed_at")
    .in("game_id", gameIds);
  if (sigErr) notes.push(`sharp_signals query failed: ${sigErr.message}`);

  const { data: splitObservationsRaw, error: splitObservationsErr } = await supabase
    .from("public_splits_observations")
    .select("provider,game_id,market_type,public_betting_pct,public_money_pct,observed_at")
    .in("game_id", gameIds);
  if (splitObservationsErr) notes.push(`public_splits_observations query failed: ${splitObservationsErr.message}`);

  const { data: prRaw, error: prErr } = await supabase
    .from("prediction_records")
    .select("game_id,market,side,locked_at,odds_american,line_value,held,no_bet")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (prErr) notes.push(`prediction_records query failed: ${prErr.message}`);

  const records = (prRaw ?? []) as DbRecordRow[];
  const predictionRecordsByMarket = countMarkets(records, "market");
  const expectedMarketsMissingRecords = predictionWindowOpen
    ? EXPECTED_MARKETS[sport].filter((market) => (predictionRecordsByMarket[market] ?? 0) === 0)
    : [];

  const publicSplitsByMarket: CountByMarket = {};
  for (const s of (sigRaw ?? []) as DbSignalRow[]) {
    if (s.public_betting_pct !== null || s.public_money_pct !== null) inc(publicSplitsByMarket, s.market_type);
  }
  for (const s of (splitObservationsRaw ?? []) as DbSplitObservationRow[]) {
    if (s.public_betting_pct !== null || s.public_money_pct !== null) {
      inc(publicSplitsByMarket, `${s.provider ?? "unknown"}:${s.market_type ?? "unknown"}`);
    }
  }
  const lineRows = (linesRaw ?? []) as DbMarketRow[];
  const splitRows = (sigRaw ?? []) as DbSignalRow[];
  const observedSplitRows = (splitObservationsRaw ?? []) as DbSplitObservationRow[];
  const lineFreshness = freshness(lineRows.map((row) => row.fetched_at));
  const qualifyingSplitRows = splitRows
    .filter((row) => row.public_betting_pct !== null || row.public_money_pct !== null);
  const qualifyingObservedSplitRows = observedSplitRows
    .filter((row) => row.public_betting_pct !== null || row.public_money_pct !== null);
  const splitObservedRows = qualifyingObservedSplitRows.length > 0
    ? qualifyingObservedSplitRows.map((row) => ({ game_id: row.game_id, observedAt: row.observed_at }))
    : qualifyingSplitRows.map((row) => ({ game_id: row.game_id, observedAt: row.computed_at }));
  const splitFreshness = freshness(splitObservedRows.map((row) => row.observedAt));
  // A versioned prediction record with an exact evaluated price is also real
  // market coverage. Some current writers publish that authoritative tuple
  // without copying every provider row into the legacy `lines` table.
  const gamesWithLine = new Set([
    ...lineRows.map((row) => row.game_id),
    ...records.filter((row) => row.odds_american !== null).map((row) => row.game_id),
  ].filter((id): id is number => typeof id === "number"));

  const normalizedStatus = (value: string | null) =>
    String(value ?? "").trim().toLowerCase().replace(/^status_/, "");
  const scheduled = games.filter((g) => normalizedStatus(g.status) === "scheduled").length;
  const final = games.filter((g) => ["final", "completed"].includes(normalizedStatus(g.status))).length;

  if (sport === "soccer") notes.push("EPL/UCL exact current prices are authoritative in prediction/member snapshots; legacy lines-table rows are optional. Public splits are not expected unless provider coverage is verified.");
  if (sport === "wnba") notes.push("WNBA total/spread fallback may have line values without odds when Playbook fills a SharpAPI market gap.");
  if (sport === "mlb") notes.push("MLB public splits are model-impacting; dual-source promotion must stay gated by outcome validation.");
  if (!predictionWindowOpen) notes.push("official prediction/tracking window is closed; seeded fixtures are ingestion rehearsal, not missing model output");

  return {
    sport,
    date,
    games: {
      total: games.length,
      scheduled,
      final,
      other: games.length - scheduled - final,
    },
    linesByMarket: countMarkets((linesRaw ?? []) as DbMarketRow[], "market_type"),
    publicSplitsByMarket,
    predictionRecordsByMarket,
    expectedMarketsMissingRecords,
    records: {
      total: records.length,
      locked: records.filter((r) => r.locked_at !== null).length,
      // Only real-sided, non-held records need a bet price. Toss-Up/no-side
      // records are intentionally non-actionable and should not masquerade as
      // missing odds defects in the operator readiness report.
      missingOdds: records.filter((r) => r.held !== true && r.side !== null && r.odds_american === null).length,
      missingLineValue: records.filter((r) => requiresLineValue(sport, r.market) && r.line_value === null).length,
      held: records.filter((r) => r.held === true).length,
      noBet: records.filter((r) => r.no_bet === true).length,
    },
    freshness: {
      newestLineAt: lineFreshness.newest,
      oldestLineAt: lineFreshness.oldest,
      maximumLineAgeMinutes: maximumLatestAgeByGame(lineRows.map((row) => ({ game_id: row.game_id, observedAt: row.fetched_at }))),
      gamesWithoutAnyLine: gameIds.filter((id) => !gamesWithLine.has(id)).length,
      newestSplitAt: splitFreshness.newest,
      oldestSplitAt: splitFreshness.oldest,
      maximumSplitAgeMinutes: maximumLatestAgeByGame(splitObservedRows),
    },
    notes,
  };
}

type FootballMarket = {
  held: boolean;
  line: number | null;
  currentPriceAmerican: number | null;
  currentPriceObservedAt?: string | null;
  marketPrediction?: { status?: string; label?: string | null } | null;
  publicSplits?: unknown;
  sportsbookSplits?: unknown;
};

type FootballGame = {
  id: string;
  lockState: string;
  gameStartAt: string;
  markets: { moneyline: FootballMarket; first_inning: FootballMarket; total: FootballMarket };
};

async function auditFootballSnapshot(sport: "nfl" | "cfb", date: string): Promise<SportReport> {
  const now = new Date().toISOString();
  const season = Number(process.env[`${sport.toUpperCase()}_FORWARD_SEASON`] ?? "2026");
  const snapshot = sport === "nfl"
    ? await readNflForwardMemberSnapshot({
        client: supabase,
        season,
        week: resolveNflForwardWeek({ season, configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? "1"), now: new Date(now) }),
        now,
      })
    : await readCfbForwardMemberSnapshot({ client: supabase, season, now });
  if (!snapshot) throw new Error(`${sport} current weekly member snapshot is unavailable.`);
  const games = snapshot.fixture.snapshot.games as unknown as FootballGame[];
  const markets = ["moneyline", "spread", "total"] as const;
  const rows = games.flatMap((game) => markets.map((market) => ({
    game,
    market,
    value: market === "spread" ? game.markets.first_inning : game.markets[market],
  })));
  const linesByMarket: CountByMarket = {};
  const predictionRecordsByMarket: CountByMarket = {};
  const publicSplitsByMarket: CountByMarket = {};
  for (const row of rows) {
    if (row.value.currentPriceAmerican !== null) inc(linesByMarket, row.market);
    if (row.value.marketPrediction?.status === "available" || row.value.marketPrediction?.label) inc(predictionRecordsByMarket, row.market);
    if (row.value.publicSplits !== undefined && row.value.publicSplits !== null) inc(publicSplitsByMarket, `public:${row.market}`);
    if (row.value.sportsbookSplits !== undefined && row.value.sportsbookSplits !== null) inc(publicSplitsByMarket, `sharp:${row.market}`);
  }
  const observedTimes = rows.map((row) => row.value.currentPriceObservedAt);
  const observedFreshness = freshness(observedTimes);
  const gameIdsWithPrice = new Set(rows.filter((row) => row.value.currentPriceAmerican !== null).map((row) => row.game.id));
  const normalizedStatus = (game: FootballGame) => Date.parse(game.gameStartAt) <= Date.now() ? "other" : "scheduled";
  return {
    sport,
    date,
    games: {
      total: games.length,
      scheduled: games.filter((game) => normalizedStatus(game) === "scheduled").length,
      final: 0,
      other: games.filter((game) => normalizedStatus(game) === "other").length,
    },
    linesByMarket,
    publicSplitsByMarket,
    predictionRecordsByMarket,
    expectedMarketsMissingRecords: EXPECTED_MARKETS[sport].filter((market) => (predictionRecordsByMarket[market] ?? 0) === 0),
    records: {
      total: rows.length,
      locked: rows.filter((row) => row.game.lockState === "locked").length,
      missingOdds: rows.filter((row) => !row.value.held && row.value.currentPriceAmerican === null).length,
      missingLineValue: rows.filter((row) => LINE_VALUE_REQUIRED_MARKETS[sport].has(row.market) && row.value.line === null).length,
      held: rows.filter((row) => row.value.held).length,
      noBet: rows.filter((row) => row.value.held || !row.value.marketPrediction?.label).length,
    },
    freshness: {
      newestLineAt: observedFreshness.newest,
      oldestLineAt: observedFreshness.oldest,
      maximumLineAgeMinutes: observedFreshness.maximumAgeMinutes,
      gamesWithoutAnyLine: games.filter((game) => !gameIdsWithPrice.has(game.id)).length,
      newestSplitAt: null,
      oldestSplitAt: null,
      maximumSplitAgeMinutes: null,
    },
    notes: [`weekly member snapshot source captured at ${snapshot.sourceCapturedAt}`],
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("READ-ONLY. --write is not supported.");
    process.exit(1);
  }
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid --date "${date}". Expected YYYY-MM-DD.`);

  const reports = await Promise.all(SPORTS.map((sport) => auditSport(sport, date)));
  const out = { generatedAt: new Date().toISOString(), readOnly: true, date, reports };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`[audit-all-model-readiness] date=${date} mode=READ-ONLY`);
  for (const r of reports) {
    console.log(`\n${r.sport.toUpperCase()}`);
    console.log(`  games: total=${r.games.total} scheduled=${r.games.scheduled} final=${r.games.final} other=${r.games.other}`);
    console.log(`  lines: ${formatCounts(r.linesByMarket)}`);
    console.log(`  public splits: ${formatCounts(r.publicSplitsByMarket)}`);
    console.log(`  prediction_records: ${formatCounts(r.predictionRecordsByMarket)}`);
    console.log(
      `  records: total=${r.records.total} locked=${r.records.locked} ` +
      `missingOdds=${r.records.missingOdds} missingLine=${r.records.missingLineValue} held=${r.records.held} noBet=${r.records.noBet}`
    );
    console.log(`  freshness: lineMaxAge=${r.freshness.maximumLineAgeMinutes ?? "-"}m gamesWithoutLine=${r.freshness.gamesWithoutAnyLine} splitMaxAge=${r.freshness.maximumSplitAgeMinutes ?? "-"}m`);
    console.log(`  expected markets missing records: ${r.expectedMarketsMissingRecords.join(", ") || "-"}`);
    for (const note of r.notes) console.log(`  note: ${note}`);
  }
  console.log("\n✓ Read-only audit complete. No writes.");
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(2);
});
