/**
 * Daily Edge Integrity Auditor v1 — required validation gate.
 *
 * READ-ONLY end-to-end cross-source check that surfaces any divergence
 * between locked prediction_records, the live Daily Edge DTO, the
 * underlying sharp_signals / sharp_signals_history / lines /
 * line_history tables, and the tracking + grading layers.
 *
 * Born from the 2026-06-10 MIL@ATH late-lock investigation. The system
 * must catch obvious Daily Edge issues before the operator (or a user)
 * sees them. This script is the gate.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/operator/audit-daily-edge-integrity.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--game-id N] [--market moneyline|total|first_inning] \
 *     [--strict] [--json] [--base-url http://localhost:3000]
 *
 *   or via package script:
 *     npm run audit:daily-edge -- --sport mlb --date YYYY-MM-DD --strict
 *
 * EXIT CODES
 *   0  clean (no issues, OR --strict not set and only INFO/WARN issues)
 *   1  HIGH issues found (always non-zero), or any issues in --strict mode
 *   2  fatal: could not fetch DTO / DB read failed
 *
 * WHEN TO RUN
 *   • after morning_slate / evening_refresh cron
 *   • after pregame_sweep (lock)
 *   • after tracking_refresh (grading)
 *   • before trusting the slate for member display
 *
 * AUDIT CATEGORIES
 *   A. Lock contract — DTO renders match locked prediction_records
 *   B. Public splits — locked snapshot has splits when history had them
 *   C. Lines/odds — locked price + line present when valid pre-lock existed
 *   D. Tracking/grading — grades use locked pick/line; no dup/missing
 *   E. Current-vs-history thinning — current tables vs append-only history
 */
import { supabase } from "../../lib/db/supabase";

// ─── CLI args ───────────────────────────────────────────────────────────

type Args = {
  sport: string;
  date: string;
  gameId: number | null;
  market: string | null;
  strict: boolean;
  json: boolean;
  baseUrl: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const opt = (name: string, def: string | null = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
  };
  const flag = (name: string) => argv.indexOf(`--${name}`) >= 0;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const gameIdStr = opt("game-id");
  return {
    sport: opt("sport", "mlb")!,
    date: opt("date", todayUtc)!,
    gameId: gameIdStr !== null ? Number(gameIdStr) : null,
    market: opt("market"),
    strict: flag("strict"),
    json: flag("json"),
    baseUrl: opt("base-url", "http://localhost:3000")!,
  };
}

// ─── Issue model ────────────────────────────────────────────────────────

type Severity = "HIGH" | "WARN" | "INFO";
type Category = "A_lock_contract" | "B_public_splits" | "C_lines_odds" | "D_tracking_grading" | "E_thinning";
type Issue = {
  severity: Severity;
  category: Category;
  game: string;
  market: string | null;
  prediction_record_id: number | null;
  expected: string;
  actual: string;
  cause: string;
  fix: string;
};

const issues: Issue[] = [];
const push = (i: Issue) => issues.push(i);

// ─── Audit categories ───────────────────────────────────────────────────

const REAL_BOOKS = new Set(["pinnacle","draftkings","fanduel","betmgm","caesars","bet365 us","bookmaker","ballybet","betrivers","bovada","circa","kalshi","onexbet","saba","fliff"]);

const playGradeVerdictMap: Record<string, string> = {
  best_angle: "Best Angle", lean: "Lean",
  market_watch: "Watchlist", model_only: "Watchlist", provisional: "Watchlist",
};

async function runAudit(args: Args) {
  // Build game map
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const tm = new Map((teams ?? []).map((t) => [t.id, t.abbreviation]));
  const { data: games } = await supabase
    .from("games").select("id, external_id, home_team_id, away_team_id, game_date, status, first_inning_runs, home_score, away_score")
    .eq("sport", args.sport).eq("slate_date", args.date);
  const label = new Map<number, string>();
  for (const g of games ?? []) label.set(g.id, `${tm.get(g.away_team_id)}@${tm.get(g.home_team_id)}`);

  // Pull locked records (optionally filtered by --game-id / --market)
  let q = supabase
    .from("prediction_records")
    .select("id, game_id, external_id, market, pick, side, line_value, odds_american, confidence, model_probability, play_grade, no_bet, locked_at, snapshot_json, game_prediction_id")
    .eq("sport", args.sport).eq("slate_date", args.date)
    .not("locked_at", "is", null);
  if (args.gameId !== null) q = q.eq("game_id", args.gameId);
  if (args.market !== null) q = q.eq("market", args.market);
  const { data: pr } = await q.order("game_id").order("market");
  if (!pr || pr.length === 0) {
    if (!args.json) console.log(`No locked records for sport=${args.sport} date=${args.date}${args.gameId ? ` game_id=${args.gameId}` : ""}${args.market ? ` market=${args.market}` : ""}`);
    return { pr: [], issues: [] };
  }

  // Fetch DTO
  const dtoRes = await fetch(`${args.baseUrl}/api/lab/daily-edge?sport=${args.sport}&date=${args.date}`);
  if (!dtoRes.ok) {
    console.error(`✗ FATAL: DTO fetch failed (HTTP ${dtoRes.status})`);
    process.exit(2);
  }
  const dto = await dtoRes.json();
  const dtoByExt = new Map<number, any>();
  for (const g of (dto.games as any[]) ?? []) dtoByExt.set(g.external_id, g);

  // Per-row audit
  for (const row of pr) {
    const gameLabel = label.get(row.game_id) ?? `g${row.game_id}`;
    const sp = (row.snapshot_json as any) ?? {};
    const dtoGame = dtoByExt.get(row.external_id);
    const dtoMarket = dtoGame?.markets?.[row.market];
    const game = (games ?? []).find((g) => g.id === row.game_id);
    const teamCtx = {
      home: dtoGame?.homeTeam ?? (game ? tm.get(game.home_team_id) : null) ?? "?",
      away: dtoGame?.awayTeam ?? (game ? tm.get(game.away_team_id) : null) ?? "?",
    };

    await auditA_lockContract(row, sp, dtoMarket, gameLabel, teamCtx);
    await auditB_publicSplits(row, sp, dtoMarket, gameLabel);
    await auditC_linesOdds(row, sp, dtoMarket, gameLabel);
    await auditD_trackingGrading(row, game, gameLabel);
    await auditE_thinning(row, gameLabel);
  }

  return { pr, issues };
}

// A. Lock contract — DTO matches locked prediction_records
async function auditA_lockContract(row: any, sp: any, dtoMarket: any, gameLabel: string, teamCtx: { home: string; away: string }) {
  if (!dtoMarket) {
    push({ severity: "HIGH", category: "A_lock_contract", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "DTO market present", actual: "missing", cause: "DTO did not render this market for the game", fix: "investigate route's buildGameDto for this game" });
    return;
  }
  // Pick match. Locked `pick` uses canonical identifiers (home/away/over/under
  // for ML/Total, "NRFI"/"YRFI"/"Toss-Up" for FI). DTO `pick` is a display
  // string — team abbreviation for ML ("ATH" for home), capitalized side
  // for Total ("Over"), and FI labels match exactly. Convert locked → DTO
  // shape before comparing so we don't false-positive on lexical drift.
  const expectedDtoPick: string | null = (() => {
    if (row.pick === null) return null;
    if (row.market === "moneyline") {
      if (row.pick === "home") return teamCtx.home;
      if (row.pick === "away") return teamCtx.away;
      return row.pick;
    }
    if (row.market === "total") {
      if (row.pick === "over") return "Over";
      if (row.pick === "under") return "Under";
      return row.pick;
    }
    return row.pick; // FI: "NRFI" | "YRFI" | "Toss-Up" — DTO renders same
  })();
  const dtoPick = dtoMarket.pick;
  if (expectedDtoPick !== null && dtoPick !== expectedDtoPick) {
    push({ severity: "HIGH", category: "A_lock_contract", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: `DTO pick=${expectedDtoPick} (locked pick=${row.pick})`, actual: `DTO pick=${dtoPick}`,
      cause: "DTO pick differs from locked pick — live game_predictions leakage",
      fix: "extend Phase 6B.18 lock mutation for this market" });
  }
  // Verdict tier match (skip FI — uses NRFI/YRFI/Toss-Up ladder, not play_grade)
  if (row.market !== "first_inning") {
    const expectedVerdict = row.no_bet === true ? "No Play" : (row.play_grade ? playGradeVerdictMap[row.play_grade] ?? null : null);
    const dtoVerdict = dtoMarket?.verdict?.label;
    if (expectedVerdict && dtoVerdict !== expectedVerdict) {
      push({ severity: "HIGH", category: "A_lock_contract", game: gameLabel, market: row.market, prediction_record_id: row.id,
        expected: `verdict=${expectedVerdict} (from play_grade=${row.play_grade})`, actual: `verdict=${dtoVerdict}`, cause: "DTO verdict differs from locked play_grade", fix: "investigate resolveLockedVerdict in daily-edge route" });
    }
  }
  // Confidence match (within rounding tolerance)
  const dtoConf = dtoMarket?.confidence;
  if (row.confidence !== null && dtoConf !== null && Math.abs((dtoConf * 100) - row.confidence) > 1) {
    push({ severity: "WARN", category: "A_lock_contract", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: `confidence ≈ ${row.confidence}`, actual: `confidence=${(dtoConf * 100).toFixed(1)}`, cause: "confidence drift > 1pp from locked value", fix: "investigate confidence read path in buildMarketEdge" });
  }
}

// B. Public splits — locked snapshot must carry splits if history had them
async function auditB_publicSplits(row: any, sp: any, dtoMarket: any, gameLabel: string) {
  if (row.market === "first_inning") return; // FI doesn't use public_splits
  const sps = (sp.public_splits as Record<string, unknown> | null) ?? null;
  const snapHasSplitsField = sps !== null;
  const snapPickedMoney = sps?.picked_money_pct;
  const snapPickedBets = sps?.picked_bets_pct;
  const snapRich = snapHasSplitsField && ((snapPickedMoney !== null && snapPickedMoney !== undefined) || (snapPickedBets !== null && snapPickedBets !== undefined));

  const dtoSplits = Array.isArray(dtoMarket?.publicSplits) ? dtoMarket.publicSplits : [];
  const dtoHasRich = dtoSplits.some((s: any) => s.moneyPct !== null || s.betsPct !== null);

  // Look for pre-lock rich history rows for the picked side
  const pickedSide = row.market === "moneyline" ? row.pick : row.side;
  if (pickedSide) {
    const { data: histRich } = await supabase
      .from("sharp_signals_history")
      .select("id, recorded_at, public_money_pct, public_betting_pct")
      .eq("game_id", row.game_id).eq("market_type", row.market).eq("side", pickedSide)
      .lte("recorded_at", row.locked_at!)
      .or("public_money_pct.not.is.null,public_betting_pct.not.is.null")
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (!snapRich && histRich && histRich[0]) {
      const ageMin = Math.round((Date.parse(row.locked_at!) - Date.parse(histRich[0].recorded_at)) / 60000);
      push({ severity: "HIGH", category: "B_public_splits", game: gameLabel, market: row.market, prediction_record_id: row.id,
        expected: `snapshot.public_splits.picked_money_pct = ${histRich[0].public_money_pct} (from history id=${histRich[0].id}, ${ageMin}min pre-lock)`, actual: snapHasSplitsField ? "shell object with all nulls" : "undefined",
        cause: "destructive sharp_signals refresh wiped data before lock OR no history-fallback in writer",
        fix: "history fallback in buildPublicSplitsSnapshot OR repair this row from history with attribution" });
    }
  }
  // DTO vs snapshot consistency
  if (snapRich && !dtoHasRich) {
    push({ severity: "HIGH", category: "B_public_splits", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "DTO publicSplits renders rich values from snapshot", actual: "DTO publicSplits empty or all-null",
      cause: "DTO render path losing snapshot data", fix: "investigate route's buildPublicSplits call site" });
  }
  if (!snapHasSplitsField && dtoHasRich) {
    push({ severity: "HIGH", category: "B_public_splits", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "no DTO splits (snapshot missing)", actual: `DTO has ${dtoSplits.length} rich rows`,
      cause: "DTO leaking live sharp_signals into locked card", fix: "ensure DTO publicSplits sources from locked snapshot only after lock" });
  }
  // Track fallback usage
  const splitsSource = (sps as any)?.source;
  if (splitsSource === "history_fallback" || splitsSource?.startsWith?.("sharp_signals_history_repaired")) {
    push({ severity: "INFO", category: "B_public_splits", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "current sharp_signals provided rich data", actual: `fallback source: ${splitsSource}`,
      cause: "current sharp_signals was missing/thin at writer time — fallback fired", fix: "monitor; if fallback rate >30% per slate, investigate upstream" });
  }
}

// C. Lines/odds — locked price + line present when valid pre-lock existed
async function auditC_linesOdds(row: any, sp: any, dtoMarket: any, gameLabel: string) {
  if (row.market === "first_inning") return; // FI doesn't use lines table
  // Missing odds_american despite valid pre-lock real-book history?
  if (row.odds_american === null && row.no_bet !== true && row.side !== null) {
    const { data: histRb } = await supabase
      .from("line_history")
      .select("id, sportsbook, odds_american, line_value, recorded_at")
      .eq("game_id", row.game_id).eq("market_type", row.market).eq("side", row.side)
      .is("player_id", null)
      .neq("sportsbook", "splits_consensus")
      .not("odds_american", "is", null)
      .lte("recorded_at", row.locked_at!)
      .order("recorded_at", { ascending: false }).limit(5);
    const realBookHits = (histRb ?? []).filter((h) => REAL_BOOKS.has(h.sportsbook));
    if (realBookHits.length > 0) {
      const h = realBookHits[0];
      push({ severity: "HIGH", category: "C_lines_odds", game: gameLabel, market: row.market, prediction_record_id: row.id,
        expected: `odds_american from real-book pre-lock (e.g., ${h.sportsbook} ${h.odds_american} @ ${h.recorded_at.slice(11,16)})`, actual: "null",
        cause: "writer captured no real-book price; line_history had one",
        fix: "Forward Fix A line_history fallback active for future locks; this row stuck unless repaired" });
    }
  }
  // Phantom alt-line detection for totals
  if (row.market === "total" && row.line_value !== null) {
    const { data: histTot } = await supabase
      .from("line_history")
      .select("sportsbook, side, line_value, recorded_at")
      .eq("game_id", row.game_id).eq("market_type", "total")
      .is("player_id", null)
      .lte("recorded_at", row.locked_at!)
      .order("recorded_at", { ascending: false }).limit(500);
    // Count distinct real-books that had this line as a both-sided main
    const byBook = new Map<string, Set<string>>();
    for (const h of histTot ?? []) {
      if (!REAL_BOOKS.has(h.sportsbook) || h.line_value !== row.line_value) continue;
      const s = byBook.get(h.sportsbook) ?? new Set<string>();
      s.add(h.side as string);
      byBook.set(h.sportsbook, s);
    }
    const bothSidedCorroborators = [...byBook.entries()].filter(([_, s]) => s.has("over") && s.has("under")).length;
    if (bothSidedCorroborators === 0) {
      push({ severity: "HIGH", category: "C_lines_odds", game: gameLabel, market: row.market, prediction_record_id: row.id,
        expected: `locked line=${row.line_value} corroborated by ≥1 real-book main pre-lock`, actual: "no real-book has both sides at this line",
        cause: "phantom alt-line (Kalshi/onexbet alt) locked OR splits_consensus took priority",
        fix: "post-e526a67 fix prevents recurrence; repair this row if reasonable real-book main existed" });
    }
  }
  // DTO line/odds consistency
  if (row.market === "total" && dtoMarket?.line !== null && dtoMarket?.line !== row.line_value) {
    push({ severity: "HIGH", category: "C_lines_odds", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: `DTO line=${row.line_value}`, actual: `DTO line=${dtoMarket.line}`,
      cause: "DTO reading live total line instead of locked", fix: "investigate totalLineByGame override + DTO assembly" });
  }
  if (row.odds_american !== null && dtoMarket?.priceAmerican !== null && dtoMarket?.priceAmerican !== row.odds_american) {
    push({ severity: "HIGH", category: "C_lines_odds", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: `DTO priceAmerican=${row.odds_american}`, actual: `DTO priceAmerican=${dtoMarket.priceAmerican}`,
      cause: "DTO reading live odds instead of locked", fix: "investigate Phase 6B.18 locked_snapshot synthesis" });
  }
}

// D. Tracking/grading — grades use locked pick/line; no dup/missing
async function auditD_trackingGrading(row: any, game: any, gameLabel: string) {
  const { data: grades } = await supabase
    .from("prediction_grades")
    .select("id, result, line_value_used, grading_source, graded_at")
    .eq("prediction_record_id", row.id);
  const isFinal = game?.home_score !== null && game?.away_score !== null && (row.market !== "first_inning" || game?.first_inning_runs !== null);
  if (isFinal && (!grades || grades.length === 0) && row.no_bet !== true) {
    push({ severity: "HIGH", category: "D_tracking_grading", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "grade row present for final game", actual: "no grade row",
      cause: "grading cron did not process this row", fix: "trigger tracking-refresh cron or investigate predictionGradingService" });
  }
  if (grades && grades.length > 1) {
    push({ severity: "HIGH", category: "D_tracking_grading", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: "1 grade row per prediction_record", actual: `${grades.length} grade rows`,
      cause: "duplicate grading (cron raced or upsert conflict)", fix: "investigate predictionGradingService upsert" });
  }
  // Grade-vs-locked-line consistency for totals
  if (row.market === "total" && grades && grades.length === 1 && grades[0].line_value_used !== null && grades[0].line_value_used !== row.line_value) {
    push({ severity: "HIGH", category: "D_tracking_grading", game: gameLabel, market: row.market, prediction_record_id: row.id,
      expected: `grade computed against locked line ${row.line_value}`, actual: `grade used line=${grades[0].line_value_used}`,
      cause: "grader read a non-locked line", fix: "investigate gradeTotal in predictionGrader.ts" });
  }
}

// E_thinning runs per row; checks are per-game so dedupe by game_id.
const thinningSeenGames = new Set<number>();

// E. Current-vs-history thinning
async function auditE_thinning(row: any, gameLabel: string) {
  if (row.market === "first_inning") return; // FI doesn't have lines/signals
  if (thinningSeenGames.has(row.game_id)) return;
  thinningSeenGames.add(row.game_id);
  // sharp_signals: history vs current
  const { count: histSigCount } = await supabase
    .from("sharp_signals_history").select("*", { count: "exact", head: true })
    .eq("game_id", row.game_id);
  const { count: curSigCount } = await supabase
    .from("sharp_signals").select("*", { count: "exact", head: true })
    .eq("game_id", row.game_id);
  if ((histSigCount ?? 0) > 50 && (curSigCount ?? 0) < 3) {
    push({ severity: "WARN", category: "E_thinning", game: gameLabel, market: null, prediction_record_id: null,
      expected: `current sharp_signals carries some rows when history has ${histSigCount}`, actual: `current=${curSigCount}, history=${histSigCount}`,
      cause: "sharp_signals destructive thinning OR no recent /splits poll covered this game", fix: "verify a5ff80c fix is deployed; check ingest pipeline for late games" });
  }
  // lines: history vs current real-book counts (deduped by sportsbook)
  const { data: histBooks } = await supabase
    .from("line_history").select("sportsbook")
    .eq("game_id", row.game_id).in("market_type", ["moneyline", "total"])
    .is("player_id", null).neq("sportsbook", "splits_consensus");
  const { data: curBooks } = await supabase
    .from("lines").select("sportsbook")
    .eq("game_id", row.game_id).in("market_type", ["moneyline", "total"])
    .is("player_id", null).neq("sportsbook", "splits_consensus");
  const histBookCount = new Set((histBooks ?? []).map((b) => b.sportsbook)).size;
  const curBookCount = new Set((curBooks ?? []).map((b) => b.sportsbook)).size;
  if (histBookCount >= 5 && curBookCount < 2) {
    push({ severity: "WARN", category: "E_thinning", game: gameLabel, market: null, prediction_record_id: null,
      expected: `current lines carries multiple real-books when history has ${histBookCount}`, actual: `current=${curBookCount}, history=${histBookCount}`,
      cause: "lines destructive thinning OR SharpAPI returned only 1 book in latest poll",
      fix: "verify 5fb6fdc fix is deployed; this is a SOFT warning until per-(game,market,sportsbook) preservation has run a full day" });
  }
}

// ─── Output ─────────────────────────────────────────────────────────────

function renderText(args: Args, pr: any[], all: Issue[]) {
  console.log("=".repeat(120));
  console.log(`DAILY EDGE INTEGRITY AUDITOR — sport=${args.sport} date=${args.date}${args.gameId ? ` game_id=${args.gameId}` : ""}${args.market ? ` market=${args.market}` : ""}${args.strict ? " [STRICT]" : ""}`);
  console.log("=".repeat(120));
  console.log(`\nLocked rows audited: ${pr.length}`);
  console.log(`\nIssues by severity:`);
  const high = all.filter((i) => i.severity === "HIGH");
  const warn = all.filter((i) => i.severity === "WARN");
  const info = all.filter((i) => i.severity === "INFO");
  console.log(`  HIGH: ${high.length}`);
  console.log(`  WARN: ${warn.length}`);
  console.log(`  INFO: ${info.length}`);

  if (all.length > 0) {
    console.log(`\nIssues:`);
    for (const i of all) {
      console.log(`\n  [${i.severity}] [${i.category}] ${i.game} ${i.market ?? ""} ${i.prediction_record_id ? `pr.id=${i.prediction_record_id}` : ""}`);
      console.log(`    expected: ${i.expected}`);
      console.log(`    actual:   ${i.actual}`);
      console.log(`    cause:    ${i.cause}`);
      console.log(`    fix:      ${i.fix}`);
    }
  } else {
    console.log(`\n✓ CLEAN — no issues found`);
  }
}

function renderJson(args: Args, pr: any[], all: Issue[]) {
  console.log(JSON.stringify({
    sport: args.sport, date: args.date, game_id: args.gameId, market: args.market, strict: args.strict,
    audited_rows: pr.length,
    counts: {
      high: all.filter((i) => i.severity === "HIGH").length,
      warn: all.filter((i) => i.severity === "WARN").length,
      info: all.filter((i) => i.severity === "INFO").length,
    },
    issues: all,
  }, null, 2));
}

async function main() {
  const args = parseArgs();
  try {
    const { pr, issues: all } = await runAudit(args);
    if (args.json) renderJson(args, pr, all);
    else renderText(args, pr, all);

    const high = all.filter((i) => i.severity === "HIGH").length;
    const anyIssue = all.length > 0;
    // Exit 1 if any HIGH issue OR (strict AND any issue)
    if (high > 0 || (args.strict && anyIssue)) process.exit(1);
    process.exit(0);
  } catch (e) {
    console.error("FATAL:", e);
    process.exit(2);
  }
}
main();
