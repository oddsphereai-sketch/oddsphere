/**
 * Unit tests for lib/services/streamOverlay.ts pickFresherCurrent (pure).
 * Proves the overlay uses the stream price ONLY when it is fresher than cron.
 * Run: npx tsx scripts/test-stream-overlay.ts
 */
import { pickFresherCurrent, streamKey, loadStreamCurrentForSlate, loadLastMovesForSlate } from "../lib/services/streamOverlay";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}
function ok(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); } else console.log(`✓ ${name}`);
}

/** Minimal Supabase mock: .from(t).select(c).in(col, vals) resolves to {data}. */
function mockSupabase(rows: unknown[]) {
  return {
    from: (_t: string) => ({
      select: (_c: string) => ({
        in: (_col: string, _vals: unknown[]) => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  };
}

const NOW = Date.parse("2026-06-16T18:00:00Z");
const OLD = "2026-06-16T17:00:00Z"; // 1h before now
const NEW = "2026-06-16T17:59:00Z"; // 1m before now (fresher than OLD)

// No stream → cron unchanged.
eq("no stream → cron",
  pickFresherCurrent({ american: -150, observedAt: OLD }, null, NOW),
  { american: -150, observedAt: OLD });

// Stream with null price → cron unchanged.
eq("stream null price → cron",
  pickFresherCurrent({ american: -150, observedAt: OLD }, { american: null, line: null, observedAt: NEW }, NOW),
  { american: -150, observedAt: OLD });

// Cron stale (OLD), stream newer (NEW) → stream wins.
eq("stream fresher than stale cron → stream",
  pickFresherCurrent({ american: -150, observedAt: OLD }, { american: -135, line: null, observedAt: NEW }, NOW),
  { american: -135, observedAt: NEW });

// Cron from LIVE lines (null stamp = now) beats an older stream tick.
eq("live cron (null stamp) beats older stream",
  pickFresherCurrent({ american: -150, observedAt: null }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -150, observedAt: null });

// Cron price null → stream fills in (any timestamp).
eq("cron null price → stream fills",
  pickFresherCurrent({ american: null, observedAt: null }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -135, observedAt: OLD });

// Stream older than cron stamp → cron wins.
eq("stream older than cron → cron",
  pickFresherCurrent({ american: -150, observedAt: NEW }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -150, observedAt: NEW });

// Equal timestamps → cron wins (stream must be strictly newer).
eq("equal timestamps → cron",
  pickFresherCurrent({ american: -150, observedAt: NEW }, { american: -135, line: null, observedAt: NEW }, NOW),
  { american: -150, observedAt: NEW });

// streamKey shape.
eq("streamKey", streamKey(777, "moneyline", "home"), "777::moneyline::home");

// ─── loadStreamCurrentForSlate: sharpest-trusted-book selection ──────────
(async () => {
  const G = 17636, M = "total", S = "over";
  const key = streamKey(G, M, S);
  const row = (sportsbook: string, line: number, odds: number, obs: string) =>
    ({ game_id: G, market_type: M, side: S, sportsbook, line_value: line, odds_american: odds, observed_at: obs });

  // 1. Sharpest book wins even when an outlier book ticked LATER.
  {
    const m = await loadStreamCurrentForSlate(
      mockSupabase([
        row("bovada", 11.5, 155, "2026-06-17T13:30:00Z"),   // outlier, freshest, NOT in priority
        row("draftkings", 9.5, 103, "2026-06-17T13:00:00Z"),
        row("pinnacle", 9.5, 111, "2026-06-17T13:16:00Z"),  // sharpest
      ]),
      [G],
    );
    eq("picks sharpest (pinnacle) over fresher outlier (bovada)",
      m.get(key), { american: 111, line: 9.5, observedAt: "2026-06-17T13:16:00Z" });
  }

  // 2. Untrusted-only key → fail closed (not in map → reader falls back to cron).
  {
    const m = await loadStreamCurrentForSlate(
      mockSupabase([
        row("bovada", 11.5, 155, "2026-06-17T13:30:00Z"),
        row("polymarket", 9.5, 120, "2026-06-17T13:20:00Z"),
      ]),
      [G],
    );
    ok("untrusted-only key is omitted (fail closed)", m.get(key) === undefined);
  }

  // 3. Blocked book (kalshi) never selected even if it is the only trusted-looking row.
  {
    const m = await loadStreamCurrentForSlate(
      mockSupabase([
        row("kalshi", 9.5, 120, "2026-06-17T13:30:00Z"),    // blocked (#39)
        row("fanduel", 9.5, 105, "2026-06-17T13:00:00Z"),
      ]),
      [G],
    );
    eq("blocked book ignored; falls to fanduel",
      m.get(key), { american: 105, line: 9.5, observedAt: "2026-06-17T13:00:00Z" });
  }

  // 4. Null-odds rows skipped.
  {
    const m = await loadStreamCurrentForSlate(
      mockSupabase([
        { game_id: G, market_type: M, side: S, sportsbook: "pinnacle", line_value: 9.5, odds_american: null, observed_at: "2026-06-17T13:30:00Z" },
        row("draftkings", 9.5, 103, "2026-06-17T13:00:00Z"),
      ]),
      [G],
    );
    eq("null-odds pinnacle skipped; draftkings used",
      m.get(key), { american: 103, line: 9.5, observedAt: "2026-06-17T13:00:00Z" });
  }

  // 4b. Implausible stream prices are skipped before they can become Current.
  {
    const m = await loadStreamCurrentForSlate(
      mockSupabase([
        row("pinnacle", 9.5, -4900, "2026-06-17T13:30:00Z"),
        row("draftkings", 9.5, 1329, "2026-06-17T13:29:00Z"),
        row("fanduel", 9.5, -108, "2026-06-17T13:00:00Z"),
      ]),
      [G],
    );
    eq("implausible stream prices skipped; next trusted sane price used",
      m.get(key), { american: -108, line: 9.5, observedAt: "2026-06-17T13:00:00Z" });
  }

  // 5. Empty input + error degrade to empty map.
  {
    const m = await loadStreamCurrentForSlate(mockSupabase([]), [G]);
    ok("no rows → empty map", m.size === 0);
    const mErr = await loadStreamCurrentForSlate({ from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }, [G]);
    ok("query error → empty map (degrade)", mErr.size === 0);
  }
})().then(() => {
  // ─── loadLastMovesForSlate: trusted-book-only line move ──────────────────
  const G2 = 17636, key2 = streamKey(G2, "total", "over");
  const mvRow = (sportsbook: string, prevLine: number, nextLine: number, movedAt: string) =>
    ({ game_id: G2, market_type: "total", side: "over", sportsbook, prev_odds_american: -110, next_odds_american: -108, prev_line_value: prevLine, next_line_value: nextLine, moved_at: movedAt });
  const mockLM = (rows: unknown[]) => ({
    from: () => ({ select: () => ({ in: () => ({ range: () => Promise.resolve({ data: rows, error: null }) }) }) }),
  });
  const NOW2 = Date.parse("2026-06-17T17:00:00Z");

  return (async () => {
    // bovada (untrusted, freshest) must NOT win over a trusted book's move.
    {
      const m = await loadLastMovesForSlate(mockLM([
        mvRow("bovada", 10.5, 11.5, "2026-06-17T16:55:00Z"),
        mvRow("betmgm", 8.5, 9, "2026-06-17T16:30:00Z"),
      ]), [G2], NOW2);
      ok("line move ignores untrusted bovada, uses trusted betmgm", m.get(key2)?.nextLineValue === 9);
    }
    // only untrusted books moved → fail closed (no entry, no outlier shown).
    {
      const m = await loadLastMovesForSlate(mockLM([
        mvRow("bovada", 10.5, 11.5, "2026-06-17T16:55:00Z"),
      ]), [G2], NOW2);
      ok("untrusted-only line move → omitted (fail closed)", m.get(key2) === undefined);
    }
    // among trusted, the SHARPER book wins (pinnacle over draftkings).
    {
      const m = await loadLastMovesForSlate(mockLM([
        mvRow("draftkings", 9, 9.5, "2026-06-17T16:55:00Z"),
        mvRow("pinnacle", 8.5, 9, "2026-06-17T16:20:00Z"),
      ]), [G2], NOW2);
      ok("line move prefers sharper trusted book (pinnacle)", m.get(key2)?.nextLineValue === 9);
    }
    // implausible one-tick odds moves are omitted, even from trusted books.
    {
      const badMove = {
        game_id: G2,
        market_type: "moneyline",
        side: "home",
        sportsbook: "bookmaker",
        prev_odds_american: -112,
        next_odds_american: -4900,
        prev_line_value: null,
        next_line_value: null,
        moved_at: "2026-06-17T16:56:00Z",
      };
      const goodMove = {
        game_id: G2,
        market_type: "moneyline",
        side: "home",
        sportsbook: "betmgm",
        prev_odds_american: -120,
        next_odds_american: -118,
        prev_line_value: null,
        next_line_value: null,
        moved_at: "2026-06-17T16:30:00Z",
      };
      const m = await loadLastMovesForSlate(mockLM([badMove, goodMove]), [G2], NOW2);
      eq("implausible line move skipped before Odds Move display",
        m.get(streamKey(G2, "moneyline", "home"))?.prevAmerican, -120);
    }
  })().then(() => {
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
});
