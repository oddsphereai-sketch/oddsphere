/**
 * Phase 7I — fixture tests for lastKnownGoodReader.
 *
 * Stub Supabase client so the tests are fully deterministic — no
 * network, no DB. Covers the product rule:
 *
 *   1. current valid value present → use it (source="current")
 *   2. current null but history has valid → use history (source="history")
 *   3. nothing ever received → null
 *   4. observed_at older than STALE_AGE_MINUTES → is_stale=true
 *
 * Run with:
 *   npx tsx scripts/test-last-known-good.ts
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCurrentOrLastKnownLine,
  getCurrentOrLastKnownSplit,
  isStale,
  STALE_AGE_MINUTES,
} from "../lib/services/lastKnownGoodReader";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${hint ? ` — ${hint}` : ""}`);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

type Fixture = {
  lines?: Array<Record<string, unknown>>;
  line_history?: Array<Record<string, unknown>>;
  sharp_signals?: Array<Record<string, unknown>>;
  sharp_signals_history?: Array<Record<string, unknown>>;
};

function makeStubSupabase(fixture: Fixture): SupabaseClient {
  function filterRows(rows: Array<Record<string, unknown>>, filters: Array<[string, unknown]>) {
    return rows.filter((r) => filters.every(([k, v]) => r[k] === v));
  }
  function buildBuilder(table: string) {
    const data = (fixture[table as keyof Fixture] ?? []) as Array<Record<string, unknown>>;
    const filters: Array<[string, unknown]> = [];
    let isNullField: string | null = null;
    let limit: number | null = null;
    const builder: Record<string, unknown> = {};
    const finish = () => {
      let rows = filterRows(data, filters);
      if (isNullField !== null) rows = rows.filter((r) => r[isNullField as string] === null);
      if (limit !== null) rows = rows.slice(0, limit);
      return Promise.resolve({ data: rows, error: null });
    };
    builder.select = (_cols: string) => builder;
    builder.eq = (col: string, val: unknown) => { filters.push([col, val]); return builder; };
    builder.is = (col: string, val: unknown) => { if (val === null) isNullField = col; return builder; };
    builder.order = (_col: string, _opts: { ascending?: boolean }) => builder;
    builder.limit = (n: number) => { limit = n; return builder; };
    builder.then = (resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => void, reject?: (e: Error) => void) =>
      finish().then(resolve, reject);
    return builder;
  }
  return {
    from: (table: string) => buildBuilder(table),
  } as unknown as SupabaseClient;
}

// Anchor on real wall-clock so the LKG helpers' default Date.now()
// references the same point in time the test fixtures encode.
const NOW = Date.now();

function iso(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60_000).toISOString();
}

async function main(): Promise<void> {
  // ─── Lines: current valid ───────────────────────────────────────────
  section("getCurrentOrLastKnownLine: current valid value present");
  {
    const sb = makeStubSupabase({
      lines: [
        {
          game_id: 1, market_type: "moneyline", side: "home", sportsbook: "fanduel",
          odds_american: -120, line_value: null, fetched_at: iso(5), player_id: null,
        },
      ],
    });
    const r = await getCurrentOrLastKnownLine({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "odds_american",
    });
    check("returns -120 from current", r.value === -120);
    check("source=current", r.source === "current");
    check("not stale (5min old)", r.is_stale === false);
    check("observed_at populated", r.observed_at !== null);
  }

  // ─── Lines: current null, history has valid ────────────────────────
  section("getCurrentOrLastKnownLine: current null → fallback to line_history");
  {
    const sb = makeStubSupabase({
      lines: [
        // current row exists but odds_american is null (provider dropped it)
        {
          game_id: 1, market_type: "moneyline", side: "home", sportsbook: "fanduel",
          odds_american: null, line_value: null, fetched_at: iso(2), player_id: null,
        },
      ],
      line_history: [
        // earlier valid observation in history
        {
          game_id: 1, market_type: "moneyline", side: "home", sportsbook: "fanduel",
          odds_american: -118, line_value: null, recorded_at: iso(45), player_id: null,
        },
      ],
    });
    const r = await getCurrentOrLastKnownLine({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "odds_american",
    });
    check("returns -118 from history", r.value === -118);
    check("source=history", r.source === "history");
    check("is_stale=true (45min old > 15min)", r.is_stale === true);
    check("observed_at = history row's recorded_at", r.observed_at?.startsWith(iso(45).slice(0, 16)) ?? false);
  }

  // ─── Lines: never received ─────────────────────────────────────────
  section("getCurrentOrLastKnownLine: never received");
  {
    const sb = makeStubSupabase({ lines: [], line_history: [] });
    const r = await getCurrentOrLastKnownLine({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "odds_american",
    });
    check("value is null", r.value === null);
    check("source is null", r.source === null);
    check("is_stale=false (no value)", r.is_stale === false);
  }

  // ─── Splits: current valid ──────────────────────────────────────────
  section("getCurrentOrLastKnownSplit: current valid value present");
  {
    const sb = makeStubSupabase({
      sharp_signals: [
        {
          game_id: 1, market_type: "moneyline", side: "home",
          public_money_pct: 70, public_betting_pct: 65, computed_at: iso(8),
        },
      ],
    });
    const r = await getCurrentOrLastKnownSplit({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "public_money_pct",
    });
    check("returns 70 from current", r.value === 70);
    check("source=current", r.source === "current");
    check("not stale (8min old)", r.is_stale === false);
  }

  // ─── Splits: current null → history fallback (smoking-gun case) ────
  section("getCurrentOrLastKnownSplit: current null → fallback to sharp_signals_history");
  {
    const sb = makeStubSupabase({
      sharp_signals: [
        // current row exists, both pcts null — the MIL@ATH scenario
        {
          game_id: 1, market_type: "moneyline", side: "home",
          public_money_pct: null, public_betting_pct: null, computed_at: iso(3),
        },
      ],
      sharp_signals_history: [
        // valid observation 30 min ago
        {
          game_id: 1, market_type: "moneyline", side: "home",
          public_money_pct: 62, public_betting_pct: 55, recorded_at: iso(30),
        },
        // older still — should NOT win
        {
          game_id: 1, market_type: "moneyline", side: "home",
          public_money_pct: 58, public_betting_pct: 50, recorded_at: iso(120),
        },
      ],
    });
    const r = await getCurrentOrLastKnownSplit({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "public_money_pct",
    });
    check("returns 62 (newest valid history)", r.value === 62);
    check("source=history", r.source === "history");
    check("is_stale=true (30min old > 15min)", r.is_stale === true);
  }

  // ─── Splits: never received ────────────────────────────────────────
  section("getCurrentOrLastKnownSplit: never received");
  {
    const sb = makeStubSupabase({ sharp_signals: [], sharp_signals_history: [] });
    const r = await getCurrentOrLastKnownSplit({
      supabase: sb, gameId: 1, marketType: "moneyline", side: "home", field: "public_money_pct",
    });
    check("value is null", r.value === null);
    check("source is null", r.source === null);
  }

  // ─── isStale unit ─────────────────────────────────────────────────
  section("isStale threshold helper");
  check("null is not stale", isStale(null) === false);
  check(`${STALE_AGE_MINUTES} min boundary: 10min not stale`, isStale(iso(10), NOW) === false);
  check(`${STALE_AGE_MINUTES} min boundary: 20min stale`, isStale(iso(20), NOW) === true);
  check("invalid input not stale", isStale("not-a-date", NOW) === false);

  // ─── Newest-wins across multiple sportsbooks ──────────────────────
  section("getCurrentOrLastKnownLine: newest-wins across books");
  {
    const sb = makeStubSupabase({
      lines: [
        {
          game_id: 1, market_type: "total", side: "over", sportsbook: "draftkings",
          odds_american: -110, line_value: 8.5, fetched_at: iso(10), player_id: null,
        },
        {
          game_id: 1, market_type: "total", side: "over", sportsbook: "fanduel",
          odds_american: -115, line_value: 8.5, fetched_at: iso(3), player_id: null,
        },
      ],
    });
    const r = await getCurrentOrLastKnownLine({
      supabase: sb, gameId: 1, marketType: "total", side: "over", field: "odds_american",
    });
    check("picks fanduel (-115, 3min ago) over draftkings (10min)", r.value === -115);
  }

  console.log("");
  console.log("━━━ Summary ━━━");
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
