/**
 * WNBA public-splits Last-Known-Good merge — offline regression test.
 *
 * Proves buildWnbaPublicSplits gives MLB no-blank parity: a split bar never
 * blanks when a valid value exists in the current row OR in sharp_signals_history,
 * the current non-null value always wins per field, and a cell with no source
 * (current or historical) is omitted (not faked). No DB — pure function.
 *
 * Run: npx tsx scripts/test-wnba-splits-lkg.ts
 */
import { buildWnbaPublicSplits } from "@/lib/services/wnba/buildWnbaDailyEdgeAdapted";
import type { SplitsHistoryHit } from "@/lib/services/lastKnownGoodReader";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NOW = Date.parse("2026-06-24T20:00:00Z");
const recent = new Date(NOW - 30 * 60 * 1000).toISOString(); // 30m ago (fresh)
const old = new Date(NOW - 8 * 60 * 60 * 1000).toISOString(); // 8h ago (stale > 6h)
type Cur = { market_type: string; side: string; public_betting_pct: number | null; public_money_pct: number | null; computed_at: string | null };
const hh = (side: "home" | "away", bet: number | null, money: number | null, at: string): SplitsHistoryHit => ({
  game_id: 1, market_type: "moneyline", side,
  public_betting_pct: bet, public_betting_pct_observed_at: bet === null ? null : at,
  public_money_pct: money, public_money_pct_observed_at: money === null ? null : at,
});

// 1. Current present → current value wins, history ignored.
{
  const cur: Cur[] = [{ market_type: "moneyline", side: "home", public_betting_pct: 60, public_money_pct: 55, computed_at: recent }];
  const hist = [hh("home", 99, 99, recent)];
  const r = buildWnbaPublicSplits(cur, hist, [], "IND", "PHX", NOW);
  check("current present: value is current, not history", r.ml[0]?.betsPct === 60 && r.ml[0]?.moneyPct === 55, r.ml[0]);
  check("current present: not stale (30m)", r.ml[0]?.isStale === false);
}

// 2. Current row exists but BOTH pcts null + history present → recovered from history.
{
  const cur: Cur[] = [{ market_type: "moneyline", side: "home", public_betting_pct: null, public_money_pct: null, computed_at: recent }];
  const hist = [hh("home", 62, 58, recent)];
  const r = buildWnbaPublicSplits(cur, hist, [], "IND", "PHX", NOW);
  check("blank current + history → bar filled (no blank)", r.ml.length === 1 && r.ml[0]?.betsPct === 62 && r.ml[0]?.moneyPct === 58, r.ml);
  check("recovered observedAt comes from history", r.ml[0]?.observedAt === recent, r.ml[0]?.observedAt);
}

// 3. Current MISSING entirely (no row) + history present → bar still appears.
{
  const r = buildWnbaPublicSplits([], [hh("away", 70, 65, recent)], [], "IND", "PHX", NOW);
  check("missing current + history → bar appears", r.ml.length === 1 && r.ml[0]?.side === "away" && r.ml[0]?.betsPct === 70, r.ml);
}

// 4. Neither current nor history → omitted (never faked).
{
  const r = buildWnbaPublicSplits([], [], [], "IND", "PHX", NOW);
  check("no source at all → omitted, not faked", r.ml.length === 0 && r.total.length === 0 && r.spread.length === 0);
}

// 5. Partial: current has betting, null money; history supplies money → merged per field.
{
  const cur: Cur[] = [{ market_type: "moneyline", side: "home", public_betting_pct: 61, public_money_pct: null, computed_at: recent }];
  const hist = [hh("home", 99, 57, old)];
  const r = buildWnbaPublicSplits(cur, hist, [], "IND", "PHX", NOW);
  check("partial merge: betting from current, money from history", r.ml[0]?.betsPct === 61 && r.ml[0]?.moneyPct === 57, r.ml[0]);
}

// 6. Recovered-but-old history value flags stale (truthful freshness).
{
  const cur: Cur[] = [{ market_type: "moneyline", side: "home", public_betting_pct: null, public_money_pct: null, computed_at: recent }];
  const hist = [hh("home", 62, 58, old)];
  const r = buildWnbaPublicSplits(cur, hist, [], "IND", "PHX", NOW);
  check("recovered 8h-old value flagged stale", r.ml[0]?.isStale === true, r.ml[0]);
}

// ── Spread split labels carry the actual line (IND -8.5 / PHX +8.5) ──
type Line = { market_type: string; side: string; line_value: number | null; odds_american: number | null };
const sl = (side: "home" | "away", lv: number): Line => ({ market_type: "spread", side, line_value: lv, odds_american: -110 });
const spreadCur: Cur[] = [
  { market_type: "spread", side: "home", public_betting_pct: 64, public_money_pct: 60, computed_at: recent },
  { market_type: "spread", side: "away", public_betting_pct: 36, public_money_pct: 40, computed_at: recent },
];

// 7. Both sides have a stored line → label = "ABBR ±line" with explicit sign.
{
  const r = buildWnbaPublicSplits(spreadCur, [], [sl("home", -8.5), sl("away", 8.5)], "IND", "PHX", NOW);
  const home = r.spread.find((s) => s.side === "home");
  const away = r.spread.find((s) => s.side === "away");
  check("spread home label = 'IND -8.5'", home?.label === "IND -8.5", home?.label);
  check("spread away label = 'PHX +8.5'", away?.label === "PHX +8.5", away?.label);
}

// 8. One side's line missing → infer mirror sign from the opposite side.
{
  const r = buildWnbaPublicSplits(spreadCur, [], [sl("home", -3.5)], "IND", "PHX", NOW);
  const away = r.spread.find((s) => s.side === "away");
  check("missing away line inferred as +3.5", away?.label === "PHX +3.5", away?.label);
}

// 9. No spread line source at all → fall back to team abbreviation only.
{
  const r = buildWnbaPublicSplits(spreadCur, [], [], "IND", "PHX", NOW);
  check("no line source → abbr only", r.spread.find((s) => s.side === "home")?.label === "IND", r.spread);
}

// 10. Pick'em (0) renders as PK.
{
  const r = buildWnbaPublicSplits(spreadCur, [], [sl("home", 0), sl("away", 0)], "IND", "PHX", NOW);
  check("0 line → 'IND PK'", r.spread.find((s) => s.side === "home")?.label === "IND PK", r.spread);
}

// 11. Spread split still recovers from history (LKG) AND keeps the line label.
{
  const blank: Cur[] = [{ market_type: "spread", side: "home", public_betting_pct: null, public_money_pct: null, computed_at: recent }];
  const spreadHist: SplitsHistoryHit[] = [{ game_id: 1, market_type: "spread", side: "home", public_money_pct: 59, public_money_pct_observed_at: recent, public_betting_pct: 63, public_betting_pct_observed_at: recent }];
  const r = buildWnbaPublicSplits(blank, spreadHist, [sl("home", -8.5), sl("away", 8.5)], "IND", "PHX", NOW);
  const home = r.spread.find((s) => s.side === "home");
  check("spread LKG fill + line label", home?.betsPct === 63 && home?.moneyPct === 59 && home?.label === "IND -8.5", home);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
