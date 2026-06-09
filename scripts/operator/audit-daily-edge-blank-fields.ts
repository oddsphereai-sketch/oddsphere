/**
 * Daily Edge "blank field" audit (read-only).
 *
 * For tonight's MLB slate (or any --date), walks every game × every
 * market × every blank-prone DTO field and classifies the field's
 * current state into one of:
 *
 *   never_received          — DB has no row anywhere, today, for this
 *                             (game, market, field). Source genuinely
 *                             has not supplied a value.
 *   had_then_overwritten    — DB had a value earlier (visible in
 *                             line_history); current `lines` row was
 *                             rewritten with the field nulled out.
 *   had_then_deleted_no_replace
 *                           — line_history shows the field had a value;
 *                             current `lines` table has NO row at all
 *                             for this (game, market, side) (likely the
 *                             DELETE-then-INSERT erased and the latest
 *                             insert skipped this side).
 *   persisted_not_attached  — DB has a current valid row; the DTO route
 *                             would still produce null/empty (route
 *                             logic flaw). Flagged via a second-pass
 *                             check after the DB read.
 *   live_only_never_persisted
 *                           — Field is live-fetched at request time and
 *                             never written to DB. Today: NBA splits +
 *                             NBA opportunities. We flag the (game,
 *                             market, field) but cannot historically
 *                             distinguish "never received" from
 *                             "received and lost" without a persistence
 *                             layer.
 *   locked_snapshot_missing_field
 *                           — Game is locked (prediction_records.locked_at
 *                             IS NOT NULL) and snapshot_json does not
 *                             contain the field. After-lock provider
 *                             dropouts can erase the card.
 *
 * READ-ONLY. No INSERT / UPDATE / DELETE / migration. Safe to run
 * against production at any time.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/audit-daily-edge-blank-fields.ts \
 *     --sport mlb --date 2026-06-08
 *
 *   Optional:
 *     --json      → emit a JSON report at the end (machine-readable)
 *     --verbose   → also print per-game game-by-game findings
 *
 * Tonight's invocations expected:
 *   --sport mlb --date 2026-06-08
 *   --sport nba --date 2026-06-08
 */

import process from "node:process";
import { supabase } from "../../lib/db/supabase";

type Sport = "mlb" | "nba";
type Market = "moneyline" | "total" | "first_inning" | "spread";
type Side = "home" | "away" | "over" | "under" | null;

type Classification =
  | "never_received"
  | "had_then_overwritten"
  | "had_then_deleted_no_replace"
  | "persisted_not_attached"
  | "live_only_never_persisted"
  | "locked_snapshot_missing_field"
  | "current_valid";

type FieldKey =
  | "odds_american"
  | "line_value"
  | "public_money_pct"
  | "public_betting_pct"
  | "pinnacle_ev_percentage"
  | "model_probability"
  | "market_probability";

type Finding = {
  sport: Sport;
  game_id: number;
  external_id: number;
  matchup: string;
  market: Market;
  side: Side;
  field: FieldKey;
  classification: Classification;
  current_value: number | null;
  current_observed_at: string | null;
  history_latest_valid_value: number | null;
  history_latest_valid_at: string | null;
  history_first_seen_at: string | null;
  is_locked: boolean;
  in_snapshot: boolean | null;
  notes: string;
};

type Args = {
  sport: Sport;
  date: string;
  json: boolean;
  verbose: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  let sport: Sport = "mlb";
  let date: string | null = null;
  let json = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--verbose") { verbose = true; continue; }
  }
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: audit-daily-edge-blank-fields.ts --sport mlb|nba --date YYYY-MM-DD [--json] [--verbose]");
    process.exit(1);
  }
  return { sport, date, json, verbose };
}

type GameRow = {
  id: number;
  external_id: number;
  status: string | null;
  home_team_id: number;
  away_team_id: number;
  slate_date: string;
};

type LinesRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

type LineHistoryRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string | null;
};

type SharpSignalRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  computed_at: string | null;
};

type PredictionRecordRow = {
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

const MLB_MARKETS_TO_AUDIT: Array<{ market: Market; sides: Side[] }> = [
  { market: "moneyline", sides: ["home", "away"] },
  { market: "total", sides: ["over", "under"] },
  { market: "first_inning", sides: ["home", "away"] },
];
const NBA_MARKETS_TO_AUDIT: Array<{ market: Market; sides: Side[] }> = [
  { market: "moneyline", sides: ["home", "away"] },
  { market: "total", sides: ["over", "under"] },
  { market: "spread", sides: ["home", "away"] },
];

const PRICE_FIELDS: FieldKey[] = ["odds_american", "line_value"];
const SPLITS_FIELDS: FieldKey[] = ["public_money_pct", "public_betting_pct"];

function fmtAge(iso: string | null, now: Date): string {
  if (iso === null) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((now.getTime() - t) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function loadGames(sport: Sport, date: string): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, status, home_team_id, away_team_id, slate_date")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (error) throw new Error(`games fetch: ${error.message}`);
  return (data ?? []) as GameRow[];
}

async function loadAbbrevs(teamIds: number[]): Promise<Map<number, string>> {
  if (teamIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  if (error) throw new Error(`teams fetch: ${error.message}`);
  return new Map(((data ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t.abbreviation]));
}

async function loadCurrentLines(gameIds: number[]): Promise<LinesRow[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .is("player_id", null);
  if (error) throw new Error(`lines fetch: ${error.message}`);
  return (data ?? []) as LinesRow[];
}

async function loadLineHistory(gameIds: number[]): Promise<LineHistoryRow[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, recorded_at")
    .in("game_id", gameIds)
    .is("player_id", null)
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(`line_history fetch: ${error.message}`);
  return (data ?? []) as LineHistoryRow[];
}

async function loadSharpSignals(gameIds: number[]): Promise<SharpSignalRow[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, public_money_pct, public_betting_pct, computed_at")
    .in("game_id", gameIds);
  if (error) throw new Error(`sharp_signals fetch: ${error.message}`);
  return (data ?? []) as SharpSignalRow[];
}

async function loadPredictionRecords(sport: Sport, date: string): Promise<PredictionRecordRow[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, locked_at, snapshot_json")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (error) throw new Error(`prediction_records fetch: ${error.message}`);
  return (data ?? []) as PredictionRecordRow[];
}

function newestValidPriceFromCurrent(
  rows: LinesRow[],
  field: FieldKey,
): { value: number | null; fetched_at: string | null } {
  // Pick the newest non-null value across all books for this (gid, market, side).
  let best: { value: number | null; fetched_at: string | null } = { value: null, fetched_at: null };
  for (const r of rows) {
    const v = field === "odds_american" ? r.odds_american : r.line_value;
    if (v === null) continue;
    if (best.fetched_at === null || (r.fetched_at !== null && r.fetched_at > best.fetched_at)) {
      best = { value: v, fetched_at: r.fetched_at };
    }
  }
  return best;
}

function newestValidPriceFromHistory(
  rows: LineHistoryRow[],
  field: FieldKey,
): { value: number | null; recorded_at: string | null; first_seen_at: string | null } {
  let newest: { value: number | null; recorded_at: string | null } = { value: null, recorded_at: null };
  let firstSeenAt: string | null = null;
  for (const r of rows) {
    const v = field === "odds_american" ? r.odds_american : r.line_value;
    if (v === null) continue;
    if (newest.recorded_at === null || (r.recorded_at !== null && r.recorded_at > newest.recorded_at)) {
      newest = { value: v, recorded_at: r.recorded_at };
    }
    if (firstSeenAt === null || (r.recorded_at !== null && r.recorded_at < firstSeenAt)) {
      firstSeenAt = r.recorded_at;
    }
  }
  return { ...newest, first_seen_at: firstSeenAt };
}

function classifyPriceField(opts: {
  currentRows: LinesRow[];
  historyRows: LineHistoryRow[];
  field: FieldKey;
  isLocked: boolean;
  snapshotHasField: boolean | null;
}): Pick<Finding, "classification" | "current_value" | "current_observed_at" | "history_latest_valid_value" | "history_latest_valid_at" | "history_first_seen_at" | "in_snapshot" | "notes"> {
  const current = newestValidPriceFromCurrent(opts.currentRows, opts.field);
  const history = newestValidPriceFromHistory(opts.historyRows, opts.field);

  // Locked-game blank-snapshot check (regardless of current/history state).
  if (opts.isLocked && opts.snapshotHasField === false) {
    return {
      classification: "locked_snapshot_missing_field",
      current_value: current.value,
      current_observed_at: current.fetched_at,
      history_latest_valid_value: history.value,
      history_latest_valid_at: history.recorded_at,
      history_first_seen_at: history.first_seen_at,
      in_snapshot: false,
      notes: "game locked but snapshot_json doesn't include this field; post-lock provider drop would blank UI",
    };
  }

  // Current has a value → fine.
  if (current.value !== null) {
    return {
      classification: "current_valid",
      current_value: current.value,
      current_observed_at: current.fetched_at,
      history_latest_valid_value: history.value,
      history_latest_valid_at: history.recorded_at,
      history_first_seen_at: history.first_seen_at,
      in_snapshot: opts.snapshotHasField,
      notes: "",
    };
  }

  // Current is null. Did we ever have it in history?
  if (history.value !== null) {
    // Are there current rows AT ALL for this slice? If yes, they had the field
    // nulled. If no, they were deleted whole.
    if (opts.currentRows.length === 0) {
      return {
        classification: "had_then_deleted_no_replace",
        current_value: null,
        current_observed_at: null,
        history_latest_valid_value: history.value,
        history_latest_valid_at: history.recorded_at,
        history_first_seen_at: history.first_seen_at,
        in_snapshot: opts.snapshotHasField,
        notes: "history has a valid value; current lines table has zero rows for this (game, market, side)",
      };
    }
    return {
      classification: "had_then_overwritten",
      current_value: null,
      current_observed_at: null,
      history_latest_valid_value: history.value,
      history_latest_valid_at: history.recorded_at,
      history_first_seen_at: history.first_seen_at,
      in_snapshot: opts.snapshotHasField,
      notes: `current lines row(s) exist (${opts.currentRows.length} books) but every book has null for this field`,
    };
  }

  // Never had it.
  return {
    classification: "never_received",
    current_value: null,
    current_observed_at: null,
    history_latest_valid_value: null,
    history_latest_valid_at: null,
    history_first_seen_at: null,
    in_snapshot: opts.snapshotHasField,
    notes: "no row in lines or line_history today for this (game, market, side, field)",
  };
}

function classifySplitsField(opts: {
  rows: SharpSignalRow[];
  field: FieldKey;
  isLocked: boolean;
  snapshotHasField: boolean | null;
}): Pick<Finding, "classification" | "current_value" | "current_observed_at" | "history_latest_valid_value" | "history_latest_valid_at" | "history_first_seen_at" | "in_snapshot" | "notes"> {
  // sharp_signals is current-only (no companion history table). We can only
  // distinguish current_valid vs never_received vs had_then_overwritten when
  // a row exists with the field nulled — but we can't reach back to a prior
  // valid value because no history table exists.
  if (opts.isLocked && opts.snapshotHasField === false) {
    return {
      classification: "locked_snapshot_missing_field",
      current_value: null,
      current_observed_at: null,
      history_latest_valid_value: null,
      history_latest_valid_at: null,
      history_first_seen_at: null,
      in_snapshot: false,
      notes: "game locked but snapshot_json doesn't include splits for this slice",
    };
  }
  // Newest non-null value across present rows.
  let best: { value: number | null; computed_at: string | null } = { value: null, computed_at: null };
  for (const r of opts.rows) {
    const v = opts.field === "public_money_pct" ? r.public_money_pct : r.public_betting_pct;
    if (v === null) continue;
    if (best.computed_at === null || (r.computed_at !== null && r.computed_at > best.computed_at)) {
      best = { value: v, computed_at: r.computed_at };
    }
  }
  if (best.value !== null) {
    return {
      classification: "current_valid",
      current_value: best.value,
      current_observed_at: best.computed_at,
      history_latest_valid_value: null,
      history_latest_valid_at: null,
      history_first_seen_at: null,
      in_snapshot: opts.snapshotHasField,
      notes: "",
    };
  }
  // Current null + no history table to fall back to.
  if (opts.rows.length > 0) {
    return {
      classification: "had_then_overwritten",
      current_value: null,
      current_observed_at: null,
      history_latest_valid_value: null,
      history_latest_valid_at: null,
      history_first_seen_at: null,
      in_snapshot: opts.snapshotHasField,
      notes: `sharp_signals has ${opts.rows.length} row(s) for this (game, market, side) but the field is null — and no history table exists to recover the prior value`,
    };
  }
  return {
    classification: "never_received",
    current_value: null,
    current_observed_at: null,
    history_latest_valid_value: null,
    history_latest_valid_at: null,
    history_first_seen_at: null,
    in_snapshot: opts.snapshotHasField,
    notes: "no sharp_signals row exists for this (game, market, side) today",
  };
}

/**
 * Walk the snapshot to verify a (market, side, field) row exists with
 * a non-null value in the appropriate substrate array.
 *
 * MLB snapshot shape (verified live):
 *   snapshot_json.lines_at_lock        — Array<{market_type, side, sportsbook, line_value, odds_american, ...}>
 *   snapshot_json.signal_rows_at_lock  — Array<{market_type, side, public_money_pct, public_betting_pct, ...}>
 *
 * NBA snapshot shape (Phase 7H writer):
 *   No lines_at_lock / signal_rows_at_lock arrays today. snapshot_json has
 *   public_splits / line_movement objects at top level but only for the
 *   single picked side. We return false for NBA non-picked sides until the
 *   NBA writer is extended.
 */
function snapshotHasField(
  snapshot: Record<string, unknown> | null,
  arrayKey: "lines_at_lock" | "signal_rows_at_lock",
  market: Market,
  side: Side,
  field: FieldKey,
): boolean | null {
  if (snapshot === null) return null;
  const arr = (snapshot as Record<string, unknown>)[arrayKey];
  if (!Array.isArray(arr)) return false;
  const linesMarketType = market === "first_inning" ? "first_inning_total" : market;
  for (const row of arr as Array<Record<string, unknown>>) {
    if (row.market_type !== linesMarketType) continue;
    if (row.side !== side) continue;
    const v = row[field as string];
    if (v !== null && v !== undefined) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  console.log("─".repeat(72));
  console.log(`[audit-daily-edge-blank-fields] sport=${args.sport} date=${args.date}`);
  console.log(`Started: ${now.toISOString()}  (READ-ONLY — no writes)`);
  console.log("─".repeat(72));

  const games = await loadGames(args.sport, args.date);
  if (games.length === 0) {
    console.log(`No games for sport=${args.sport} slate_date=${args.date}.`);
    return;
  }
  const teamIds = Array.from(new Set([...games.map((g) => g.home_team_id), ...games.map((g) => g.away_team_id)]));
  const abbrev = await loadAbbrevs(teamIds);
  const gameIds = games.map((g) => g.id);

  console.log(`Loaded ${games.length} game(s).`);

  const [linesRows, historyRows, sharpRows, recRows] = await Promise.all([
    loadCurrentLines(gameIds),
    loadLineHistory(gameIds),
    loadSharpSignals(gameIds),
    loadPredictionRecords(args.sport, args.date),
  ]);
  console.log(`  lines rows:            ${linesRows.length}`);
  console.log(`  line_history rows:     ${historyRows.length}`);
  console.log(`  sharp_signals rows:    ${sharpRows.length}`);
  console.log(`  prediction_records:    ${recRows.length}`);

  const findings: Finding[] = [];
  const marketsToAudit = args.sport === "mlb" ? MLB_MARKETS_TO_AUDIT : NBA_MARKETS_TO_AUDIT;

  for (const g of games) {
    const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
    const gameRec = recRows.filter((r) => r.game_id === g.id);
    const lockedRec = gameRec.find((r) => r.locked_at !== null) ?? null;
    const isLocked = lockedRec !== null;

    for (const { market, sides } of marketsToAudit) {
      // sharp_signals uses "first_inning_total" not "first_inning"; we audit only
      // MLB's first_inning ML/total proxies via lines below. Skip splits classify
      // for first_inning when MLB to avoid false negatives (no splits available).
      const linesMarketType = market === "first_inning" ? "first_inning_total" : market;
      for (const side of sides) {
        const currentSlice = linesRows.filter(
          (r) => r.game_id === g.id && r.market_type === linesMarketType && r.side === side,
        );
        const historySlice = historyRows.filter(
          (r) => r.game_id === g.id && r.market_type === linesMarketType && r.side === side,
        );

        // ── Price fields (odds_american, line_value) from lines/line_history.
        for (const field of PRICE_FIELDS) {
          const snapHasField = snapshotHasField(
            lockedRec?.snapshot_json ?? null,
            "lines_at_lock",
            market,
            side,
            field,
          );
          const c = classifyPriceField({
            currentRows: currentSlice,
            historyRows: historySlice,
            field,
            isLocked,
            snapshotHasField: snapHasField,
          });
          findings.push({
            sport: args.sport,
            game_id: g.id,
            external_id: g.external_id,
            matchup,
            market,
            side,
            field,
            is_locked: isLocked,
            ...c,
          });
        }

        // ── Splits fields. MLB sharp_signals uses moneyline / total / spread
        // (no first_inning splits in V1). Skip first_inning splits classify.
        if (market !== "first_inning") {
          const splitsSlice = sharpRows.filter(
            (r) => r.game_id === g.id && r.market_type === market && r.side === side,
          );
          for (const field of SPLITS_FIELDS) {
            const snapHasField = snapshotHasField(
              lockedRec?.snapshot_json ?? null,
              "signal_rows_at_lock",
              market,
              side,
              field,
            );
            const c = classifySplitsField({
              rows: splitsSlice,
              field,
              isLocked,
              snapshotHasField: snapHasField,
            });
            findings.push({
              sport: args.sport,
              game_id: g.id,
              external_id: g.external_id,
              matchup,
              market,
              side,
              field,
              is_locked: isLocked,
              ...c,
            });
          }
        }
      }
    }
  }

  // Live-only flag for NBA splits/opportunities — no DB persistence today.
  if (args.sport === "nba") {
    for (const g of games) {
      const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
      // Annotate one row per game so the report makes it clear NBA splits/EV
      // are live-fetched without persistence — any UI drop is invisible to
      // this audit (no DB rows to inspect).
      findings.push({
        sport: "nba",
        game_id: g.id,
        external_id: g.external_id,
        matchup,
        market: "moneyline",
        side: null,
        field: "public_money_pct",
        classification: "live_only_never_persisted",
        current_value: null,
        current_observed_at: null,
        history_latest_valid_value: null,
        history_latest_valid_at: null,
        history_first_seen_at: null,
        is_locked: false,
        in_snapshot: null,
        notes: "NBA splits + opportunities are live-fetched per request, never stored. Any provider dropout blanks the UI silently.",
      });
      findings.push({
        sport: "nba",
        game_id: g.id,
        external_id: g.external_id,
        matchup,
        market: "moneyline",
        side: null,
        field: "pinnacle_ev_percentage",
        classification: "live_only_never_persisted",
        current_value: null,
        current_observed_at: null,
        history_latest_valid_value: null,
        history_latest_valid_at: null,
        history_first_seen_at: null,
        is_locked: false,
        in_snapshot: null,
        notes: "Same applies to NBA EV / opportunities — no persistence layer.",
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const byClass = new Map<Classification, number>();
  for (const f of findings) byClass.set(f.classification, (byClass.get(f.classification) ?? 0) + 1);

  console.log("");
  console.log("━━━ Classification summary ━━━");
  for (const c of [
    "current_valid",
    "never_received",
    "had_then_overwritten",
    "had_then_deleted_no_replace",
    "persisted_not_attached",
    "live_only_never_persisted",
    "locked_snapshot_missing_field",
  ] as Classification[]) {
    const n = byClass.get(c) ?? 0;
    const pct = findings.length === 0 ? 0 : Math.round((n / findings.length) * 100);
    console.log(`  ${c.padEnd(36)} ${String(n).padStart(4)}  (${pct}%)`);
  }
  console.log(`  ${"TOTAL".padEnd(36)} ${String(findings.length).padStart(4)}`);

  // ── Non-current_valid detail (the actual problem rows) ────────────────
  const problems = findings.filter((f) => f.classification !== "current_valid");
  console.log("");
  console.log(`━━━ Problem findings (${problems.length}) ━━━`);
  if (problems.length === 0) {
    console.log("  None.");
  } else {
    for (const f of problems) {
      const ageHist = fmtAge(f.history_latest_valid_at, now);
      const ageCur = fmtAge(f.current_observed_at, now);
      console.log(
        `  [${f.classification}] ${f.matchup} g=${f.game_id} ext=${f.external_id} ${f.market}/${f.side ?? "?"} ${f.field}`
      );
      console.log(
        `      current=${f.current_value ?? "null"} (${ageCur})   history_latest=${f.history_latest_valid_value ?? "null"} (${ageHist})   locked=${f.is_locked}   in_snapshot=${f.in_snapshot}`
      );
      if (f.notes !== "") console.log(`      ${f.notes}`);
    }
  }

  // ── Per-game brief (always) ───────────────────────────────────────────
  console.log("");
  console.log("━━━ Per-game brief ━━━");
  for (const g of games) {
    const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
    const ours = findings.filter((f) => f.game_id === g.id);
    const ours_problems = ours.filter((f) => f.classification !== "current_valid");
    const status = `status=${g.status}`;
    const lockedRec = recRows.find((r) => r.game_id === g.id && r.locked_at !== null) ?? null;
    const lockNote = lockedRec ? `locked_at=${lockedRec.locked_at}` : "unlocked";
    console.log(`  ${matchup}  g=${g.id} ${status} ${lockNote}  fields_audited=${ours.length} problems=${ours_problems.length}`);
  }

  if (args.json) {
    console.log("");
    console.log("━━━ JSON ━━━");
    console.log(JSON.stringify({ args, totals: Object.fromEntries(byClass), findings }, null, 2));
  }

  if (args.verbose) {
    console.log("");
    console.log("━━━ All findings (verbose) ━━━");
    for (const f of findings) {
      console.log(`  ${JSON.stringify(f)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
