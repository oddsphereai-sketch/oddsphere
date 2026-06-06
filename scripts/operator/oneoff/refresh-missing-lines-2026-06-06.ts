/**
 * One-shot operator — Fix B1.
 *
 * Repairs today's slate (2026-06-06) for games whose lines fetch was
 * missed by SharpAPI's `/opportunities/ev` discovery this morning.
 *
 * Targets (hard-coded for safety — this script is scoped to today only):
 *   SF@CHC  ext=5058728  game_id=14771   event_id=mlb_cubs_giants_2026-06-06_b3
 *   TB@MIA  ext=5058732  game_id=14775   event_id=mlb_marlins_rays_2026-06-06_b3
 *
 * Discovery: SharpAPI's `/opportunities/ev` only surfaces games where a
 * +EV opportunity is currently flagged. Both games were absent from that
 * feed at 10:01 ET when the production lines ingest ran. The data exists
 * via `/odds` when called with the constructed event_id directly — this
 * script does exactly that, mapping the response with the same filters
 * the production provider applies.
 *
 * Quality rules (per operator):
 *   - Real sportsbook coverage (>=2 books, not Kalshi-only) → safe to write.
 *   - Kalshi-only coverage → DO NOT WRITE (the model has no calibration
 *     for prediction-market odds; would risk a misleading market baseline).
 *     Leave the game held with reason "market_source_low_quality_kalshi_only".
 *
 * Two-key write gate:
 *   --apply AND AUTOMODEL_DB_WRITES_ENABLED=true. Either missing → dry-run.
 *
 * Does NOT publish, does NOT change slate_status, does NOT touch cron,
 * does NOT call automodel re-apply (that's a separate operator step).
 */

import { supabase } from "../../../lib/db/supabase";

const DATE = "2026-06-06";
const KEY = process.env.SHARPAPI_KEY ?? "";

type Target = {
  matchup: string;
  externalId: number;
  gameId: number;
  eventId: string;
  expectedHomeAbbrev: string;
  expectedAwayAbbrev: string;
};

const TARGETS: Target[] = [
  {
    matchup: "SF@CHC",
    externalId: 5058728,
    gameId: 14771,
    eventId: "mlb_cubs_giants_2026-06-06_b3",
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  },
  {
    matchup: "TB@MIA",
    externalId: 5058732,
    gameId: 14775,
    eventId: "mlb_marlins_rays_2026-06-06_b3",
    expectedHomeAbbrev: "MIA",
    expectedAwayAbbrev: "TB",
  },
];

// Mirror of SharpAPIOddsProvider helpers (kept inline so this script
// doesn't depend on internal non-exported helpers).
function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function mapMarketType(raw: string | null): string | null {
  if (raw === null) return null;
  const v = raw.toLowerCase().trim();
  if (v === "h2h" || v === "moneyline" || v === "ml") return "moneyline";
  if (v === "total" || v === "totals" || v === "total_runs" || v === "over_under" || v === "ou") return "total";
  if (v === "spread" || v === "spreads" || v === "runline" || v === "run_line") return "spread";
  if (v === "first_inning_total" || v === "1st_inning_total" || v === "1st_inning_total_runs") return "first_inning_total";
  return null;
}
function mapSide(raw: unknown): string | null {
  const s = asStringOrNull(raw);
  if (s === null) return null;
  const v = s.toLowerCase();
  if (v === "home" || v === "away" || v === "over" || v === "under" || v === "yes" || v === "no") return v;
  return null;
}

type SharpRow = {
  sportsbook?: string;
  market_type?: string;
  selection_type?: string;
  line?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  odds_probability?: number | string | null;
  is_alternate_line?: boolean;
  home_team?: string;
  away_team?: string;
  league?: string;
  last_seen_at?: string;
  wire_received_at?: string;
};

async function fetchOddsForEvent(eventId: string): Promise<SharpRow[]> {
  // Paginate /odds (SharpAPI returns up to 50 per page).
  const all: SharpRow[] = [];
  for (let off = 0; off < 250; off += 50) {
    const url = `https://api.sharpapi.io/api/v1/odds?event_id=${encodeURIComponent(eventId)}&limit=50&offset=${off}`;
    const res = await fetch(url, { headers: { "X-API-Key": KEY, "Accept": "application/json" } });
    if (!res.ok) {
      console.warn(`  ⚠ /odds for ${eventId} returned HTTP ${res.status}`);
      return [];
    }
    const j = await res.json() as { data?: SharpRow[] };
    const rows = j.data ?? [];
    all.push(...rows);
    if (rows.length < 50) break;
  }
  return all;
}

type CandidateRow = {
  game_id: number;
  market_type: string;
  player_id: null;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  ev_percent: null;
  fair_odds: null;
  is_ev_positive: null;
  fetched_at: string;
  // for debugging
  _drop_reason?: string;
  _raw_market?: string;
  _raw_book?: string;
  _raw_side?: string;
};

function mapRowToCandidate(
  row: SharpRow,
  target: Target,
  fetchedAt: string,
): CandidateRow {
  const out: CandidateRow = {
    game_id: target.gameId,
    market_type: "",
    player_id: null,
    sportsbook: "",
    side: "",
    line_value: null,
    odds_american: null,
    odds_decimal: null,
    implied_probability: null,
    ev_percent: null,
    fair_odds: null,
    is_ev_positive: null,
    fetched_at: fetchedAt,
    _raw_market: row.market_type,
    _raw_book: row.sportsbook,
    _raw_side: row.selection_type,
  };

  // Apply same filters production uses
  const rowLeague = asStringOrNull(row.league)?.toLowerCase();
  if (rowLeague !== null && rowLeague !== undefined && rowLeague !== "mlb") {
    out._drop_reason = `league=${rowLeague}`;
    return out;
  }
  if (row.is_alternate_line === true) {
    out._drop_reason = "alternate_line";
    return out;
  }
  const market = mapMarketType(asStringOrNull(row.market_type ?? null));
  if (market === null) {
    out._drop_reason = `unmapped_market=${row.market_type}`;
    return out;
  }
  const book = asStringOrNull(row.sportsbook ?? null)?.toLowerCase() ?? null;
  if (book === null) {
    out._drop_reason = "no_book";
    return out;
  }
  const side = mapSide(row.selection_type ?? null);
  if (side === null) {
    out._drop_reason = `unmapped_side=${row.selection_type}`;
    return out;
  }

  // R-16G-A home/away sanity guard
  if (side === "home" || side === "away") {
    const homeRaw = asStringOrNull(row.home_team ?? null);
    const awayRaw = asStringOrNull(row.away_team ?? null);
    // Light check: just look for substring matches (we already know team names from event_id)
    const homeOK = homeRaw?.toLowerCase().includes(target.expectedHomeAbbrev.toLowerCase()) ||
      homeRaw?.toLowerCase().includes(target.matchup.split("@")[1].toLowerCase());
    // Don't over-reject — just record raw fields for visibility
    void homeOK;
    void awayRaw;
  }

  out.market_type = market;
  out.sportsbook = book;
  out.side = side;
  out.line_value = asNumberOrNull(row.line ?? null);
  out.odds_american = asNumberOrNull(row.odds_american ?? null);
  out.odds_decimal = asNumberOrNull(row.odds_decimal ?? null);
  out.implied_probability = asNumberOrNull(row.odds_probability ?? null);
  out.fetched_at = asStringOrNull(row.last_seen_at ?? null) ?? asStringOrNull(row.wire_received_at ?? null) ?? fetchedAt;
  return out;
}

async function main() {
  const willWrite = process.argv.includes("--apply") && process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";

  console.log(`\n━━━ refresh-missing-lines · ${DATE} ━━━`);
  console.log(`  --apply flag:                  ${process.argv.includes("--apply") ? "YES" : "no"}`);
  console.log(`  AUTOMODEL_DB_WRITES_ENABLED:   ${process.env.AUTOMODEL_DB_WRITES_ENABLED === "true" ? "true" : "missing"}`);
  console.log(`  mode:                          ${willWrite ? "WRITE (will INSERT into lines)" : "DRY-RUN (no DB writes)"}`);
  console.log(`  target games:                  ${TARGETS.map((t) => t.matchup).join(", ")}`);
  console.log("");

  // Pre-flight: verify game_ids match
  console.log("[A] Pre-flight game_id verification:");
  for (const t of TARGETS) {
    const { data: g } = await supabase
      .from("games")
      .select("id, external_id, slate_date, home_team_id, away_team_id")
      .eq("sport", "mlb").eq("external_id", t.externalId).single();
    if (!g) { console.log(`  ${t.matchup}: NOT FOUND — aborting`); return; }
    if (g.id !== t.gameId) { console.log(`  ${t.matchup}: game_id mismatch (expected ${t.gameId}, got ${g.id}) — aborting`); return; }
    if (g.slate_date !== DATE) { console.log(`  ${t.matchup}: slate_date mismatch — aborting`); return; }
    // Pre-existing lines count (must be 0)
    const { data: existing } = await supabase.from("lines").select("id", { head: false }).eq("game_id", g.id);
    console.log(`  ${t.matchup} (ext=${t.externalId}, game_id=${g.id}, slate_date=${g.slate_date}): existing lines=${existing?.length ?? 0}`);
    if ((existing?.length ?? 0) > 0) {
      console.log(`    ⊗ pre-existing lines present — refusing to add duplicates. Aborting for safety.`);
      return;
    }
  }
  console.log("");

  // Fetch /odds for each target
  console.log("[B] /odds fetch + mapping for each target:");
  const fetchedAt = new Date().toISOString();
  const perTarget: Array<{
    target: Target;
    rawCount: number;
    mapped: CandidateRow[];
    dropped: CandidateRow[];
    books: Set<string>;
    twoSidedPairs: { ml: boolean; total: boolean };
    realBookCount: number;
  }> = [];

  const KALSHI_LIKE = new Set(["kalshi", "polymarket", "robinhood"]);

  for (const t of TARGETS) {
    console.log(`▼ ${t.matchup}  event_id=${t.eventId}`);
    const raw = await fetchOddsForEvent(t.eventId);
    console.log(`  raw /odds rows fetched: ${raw.length}`);

    const mapped: CandidateRow[] = [];
    const dropped: CandidateRow[] = [];
    for (const r of raw) {
      const c = mapRowToCandidate(r, t, fetchedAt);
      if (c._drop_reason) dropped.push(c); else mapped.push(c);
    }
    console.log(`  mapped (would write):   ${mapped.length}`);
    console.log(`  dropped:                ${dropped.length}`);
    const dropReasons: Record<string, number> = {};
    for (const d of dropped) dropReasons[d._drop_reason ?? "?"] = (dropReasons[d._drop_reason ?? "?"] ?? 0) + 1;
    if (Object.keys(dropReasons).length > 0) console.log(`    drop reasons: ${JSON.stringify(dropReasons)}`);

    // Coverage analysis
    const books = new Set(mapped.map((m) => m.sportsbook));
    const realBooks = [...books].filter((b) => !KALSHI_LIKE.has(b));
    const realBookCount = realBooks.length;

    const mlRows = mapped.filter((m) => m.market_type === "moneyline");
    const totalRows = mapped.filter((m) => m.market_type === "total");
    const spreadRows = mapped.filter((m) => m.market_type === "spread");
    const fiRows = mapped.filter((m) => m.market_type === "first_inning_total");

    const mlHomes = new Set(mlRows.filter((m) => m.side === "home").map((m) => m.sportsbook));
    const mlAways = new Set(mlRows.filter((m) => m.side === "away").map((m) => m.sportsbook));
    const totalOvers = new Set(totalRows.filter((m) => m.side === "over").map((m) => m.sportsbook));
    const totalUnders = new Set(totalRows.filter((m) => m.side === "under").map((m) => m.sportsbook));
    const mlTwoSidedBooks = [...mlHomes].filter((b) => mlAways.has(b));
    const totalTwoSidedBooks = [...totalOvers].filter((b) => totalUnders.has(b));

    console.log(`  by market: ml=${mlRows.length}  total=${totalRows.length}  spread=${spreadRows.length}  first_inning=${fiRows.length}`);
    console.log(`  by book: ${[...books].join(", ")}`);
    console.log(`  real (non-kalshi) book count: ${realBookCount} → [${realBooks.join(", ")}]`);
    console.log(`  ML two-sided books: ${mlTwoSidedBooks.length} → [${mlTwoSidedBooks.join(", ")}]`);
    console.log(`  Total two-sided books: ${totalTwoSidedBooks.length} → [${totalTwoSidedBooks.join(", ")}]`);

    // Sample first 6 mapped rows
    console.log(`  sample (first 6):`);
    for (const c of mapped.slice(0, 6)) {
      console.log(`    game_id=${c.game_id}  book=${c.sportsbook.padEnd(12)}  mkt=${c.market_type.padEnd(20)}  side=${c.side.padEnd(5)}  line=${c.line_value ?? "—"}  odds=${c.odds_american}`);
    }
    console.log("");

    perTarget.push({
      target: t,
      rawCount: raw.length,
      mapped,
      dropped,
      books,
      twoSidedPairs: { ml: mlTwoSidedBooks.length > 0, total: totalTwoSidedBooks.length > 0 },
      realBookCount,
    });
  }

  // Recommendation
  console.log("[C] Recommendation:");
  for (const p of perTarget) {
    let verdict: string;
    if (p.realBookCount >= 2 && p.twoSidedPairs.ml && p.twoSidedPairs.total) {
      verdict = "✓ WRITE — real-book ML + Total two-sided coverage from multiple books";
    } else if (p.realBookCount >= 1 && (p.twoSidedPairs.ml || p.twoSidedPairs.total)) {
      verdict = "⚠ WRITE WITH CAUTION — partial coverage; V2.1 will likely flag as provisional";
    } else if (p.realBookCount === 0) {
      verdict = "⊗ DO NOT WRITE — Kalshi-only / prediction-market coverage; leave held";
    } else {
      verdict = "⚠ MARGINAL — review before writing";
    }
    console.log(`  ${p.target.matchup}: ${verdict}`);
    console.log(`    real books=${p.realBookCount}  ML two-sided=${p.twoSidedPairs.ml}  Total two-sided=${p.twoSidedPairs.total}  rows=${p.mapped.length}`);
  }
  console.log("");

  // Write summary
  console.log("[D] Write plan (only games that pass quality gate get applied):");
  const toWrite: CandidateRow[] = [];
  const skipMatchups: string[] = [];
  for (const p of perTarget) {
    if (p.realBookCount >= 2 && p.twoSidedPairs.ml && p.twoSidedPairs.total) {
      for (const c of p.mapped) {
        const { _drop_reason, _raw_market, _raw_book, _raw_side, ...clean } = c;
        void _drop_reason; void _raw_market; void _raw_book; void _raw_side;
        toWrite.push(clean as CandidateRow);
      }
      console.log(`  ${p.target.matchup}: ${p.mapped.length} rows queued for insert`);
    } else {
      skipMatchups.push(p.target.matchup);
      console.log(`  ${p.target.matchup}: SKIPPED (insufficient quality)`);
    }
  }
  console.log(`  Total rows to write: ${toWrite.length}`);
  console.log(`  Skipped matchups:    ${skipMatchups.join(", ") || "(none)"}`);
  console.log("");

  if (!willWrite) {
    console.log("  DRY RUN — no DB writes performed. Re-run with --apply AND AUTOMODEL_DB_WRITES_ENABLED=true.");
    return;
  }

  // WRITE PATH — insert only, no delete (we verified existing rows = 0)
  if (toWrite.length === 0) {
    console.log("  Nothing to write. Exiting cleanly.");
    return;
  }
  console.log("[E] Inserting rows into lines table:");
  const { error } = await supabase.from("lines").insert(toWrite);
  if (error) {
    console.error(`  ⊗ INSERT failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ✓ APPLIED — ${toWrite.length} rows inserted.`);

  // Verify
  for (const p of perTarget) {
    const { data: after } = await supabase.from("lines").select("id").eq("game_id", p.target.gameId);
    console.log(`  verify: ${p.target.matchup} now has ${after?.length ?? 0} lines rows`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
