/**
 * Universal slate-health auditor — cross-sport.
 *
 * Built 2026-06-14 after the WC TUR@AUS miss (a seeded-late, kicked-off-before-
 * prediction failure) and the prediction_grades→public-tracker bridge gap.
 * The goal is a single guardrail that catches the whole class of "a game we
 * should have covered isn't covered" across MLB / NBA / NHL / soccer (WC),
 * plus card/route/line/lock/tracking integrity, with an auto-fix path for the
 * deterministic-safe repairs.
 *
 * Read-only by default. `apply: true` runs the auto-fix-safe repairs only
 * (currently: rerun the soccer prediction writer for a slate that has seeded
 * games with odds but missing predictions, and reseed a slate missing games).
 * Everything else is classified hold / manual and only reported.
 *
 * No framework coupling — takes a Supabase client + options, returns a
 * structured result. Wrapped by app/api/cron/slate-health-audit/route.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isBlockedSportsbook } from "@/lib/config/blockedSportsbooks";

export type Sport = "mlb" | "nba" | "nhl" | "soccer";

export type AutofixClass = "auto_safe" | "hold" | "manual";
export type Severity = "error" | "warn" | "info";

export type AuditFinding = {
  check: string;
  sport: Sport | "all";
  severity: Severity;
  game_id: number | null;
  matchup: string | null;
  slate_date: string | null;
  detail: string;
  reason: string | null;
  autofix: AutofixClass;
  autofix_action: string | null;
  fixed: boolean;
};

export type AuditResult = {
  as_of: string;
  apply: boolean;
  slates: Array<{ sport: Sport; dates: string[] }>;
  findings: AuditFinding[];
  summary: {
    errors: number;
    warns: number;
    infos: number;
    autofix_safe: number;
    hold: number;
    manual: number;
    fixed: number;
  };
};

export type AuditOptions = {
  supabase: SupabaseClient;
  /** ET "today" YYYY-MM-DD. Caller passes the slate label. */
  today: string;
  sports?: Sport[];
  apply?: boolean;
  logger?: (msg: string) => void;
};

// Expected member-facing markets per sport (prediction_records.market vocab).
const EXPECTED_MARKETS: Record<Sport, string[]> = {
  mlb: ["moneyline", "total"], // first_inning audited separately (conditional)
  nba: ["moneyline", "total"],
  nhl: ["moneyline", "total"],
  soccer: ["match_result", "total", "btts", "double_chance"],
};

// Official WC public-tracking floor (Daniel: only 6/14 onward).
const SOCCER_TRACKING_FLOOR = "2026-06-14";
// Lock window: 60 min before kickoff (mirrors shouldLock conventions).
const LOCK_WINDOW_MS = 60 * 60 * 1000;

function addDays(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Slate dates to audit per sport. Soccer gets the lookahead window. */
function slatesForSport(sport: Sport, today: string): string[] {
  const yesterday = addDays(today, -1);
  if (sport === "soccer") return [yesterday, today, addDays(today, 1)];
  return [yesterday, today];
}

function newFinding(p: Partial<AuditFinding> & Pick<AuditFinding, "check" | "sport" | "severity" | "detail">): AuditFinding {
  return {
    game_id: null, matchup: null, slate_date: null, reason: null,
    autofix: "manual", autofix_action: null, fixed: false, ...p,
  };
}

// ─── Check 2 reason classifier ─────────────────────────────────────────
function classifyNoPredictionReason(args: {
  status: string;
  kickoffMs: number;
  nowMs: number;
  slateDate: string;
  gameSport: Sport;
}): { reason: string; autofix: AutofixClass; action: string | null; severity: Severity } {
  const { status, kickoffMs, nowMs } = args;
  const isFinal = /final|complete|closed/i.test(status);
  const started = kickoffMs <= nowMs;
  if (isFinal || started) {
    // Past kickoff with no predictions = a real miss, but unfixable now.
    return {
      reason: isFinal ? "kickoff already passed (final)" : "kickoff already passed",
      autofix: "manual",
      action: "too late to predict; investigate why it wasn't covered pre-kickoff (seed timing / lookahead)",
      severity: "error",
    };
  }
  // Upcoming + odds present + 0 predictions → the writer hasn't run for it.
  return {
    reason: "prediction writer skipped (upcoming, odds present, 0 records)",
    autofix: args.gameSport === "soccer" ? "auto_safe" : "hold",
    action: args.gameSport === "soccer"
      ? "rerun writeSoccerPredictionRecords for the slate"
      : "rerun the sport's prediction writer (not wired for auto-fix here)",
    severity: "error",
  };
}

// Pure helpers exported for tests.
export const __TEST__ = { classifyNoPredictionReason, slatesForSport, addDays };

// ───────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────
export async function runSlateHealthAudit(opts: AuditOptions): Promise<AuditResult> {
  const sb = opts.supabase;
  const sports: Sport[] = opts.sports ?? ["mlb", "nba", "nhl", "soccer"];
  const apply = opts.apply ?? false;
  const log = opts.logger ?? (() => {});
  const nowMs = Date.now();
  const findings: AuditFinding[] = [];
  const slates: AuditResult["slates"] = [];

  for (const sport of sports) {
    const dates = slatesForSport(sport, opts.today);
    slates.push({ sport, dates });

    // Load games for these slates once.
    const { data: games } = await sb
      .from("games")
      .select("id, external_id, home_team_id, away_team_id, game_date, slate_date, status, postseason")
      .eq("sport", sport)
      .in("slate_date", dates);
    const gameRows = games ?? [];

    // Team-name lookup for nicer labels.
    const teamIds = new Set<number>();
    for (const g of gameRows) { if (g.home_team_id) teamIds.add(g.home_team_id); if (g.away_team_id) teamIds.add(g.away_team_id); }
    const { data: teams } = teamIds.size
      ? await sb.from("teams").select("id, abbreviation, name, location").in("id", [...teamIds])
      : { data: [] as Array<{ id: number; abbreviation: string; name: string; location: string | null }> };
    const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
    const label = (g: { home_team_id: number | null; away_team_id: number | null }) =>
      `${teamById.get(g.away_team_id ?? -1)?.abbreviation ?? "?"}@${teamById.get(g.home_team_id ?? -1)?.abbreviation ?? "?"}`;

    // Per-game line + prediction counts (batched).
    const gameIds = gameRows.map((g) => g.id);
    const lineCountByGame = new Map<number, number>();
    const predMarketsByGame = new Map<number, Set<string>>();
    if (gameIds.length) {
      const { data: lns } = await sb.from("lines").select("game_id, sportsbook, market_type, side, odds_american").in("game_id", gameIds);
      for (const r of lns ?? []) lineCountByGame.set(r.game_id, (lineCountByGame.get(r.game_id) ?? 0) + 1);
      const { data: prs } = await sb.from("prediction_records").select("game_id, market, held").in("game_id", gameIds);
      for (const r of prs ?? []) {
        if (!predMarketsByGame.has(r.game_id)) predMarketsByGame.set(r.game_id, new Set());
        predMarketsByGame.get(r.game_id)!.add(r.market);
      }
    }

    // ── Check 1: missing games (soccer: provider vs DB count per slate) ──
    if (sport === "soccer") {
      for (const date of dates) {
        try {
          const { seedSoccerGames } = await import("@/lib/services/soccer/seedSoccerGamesService");
          const dry = await seedSoccerGames({ dryRun: true, slateDate: date, logger: () => {} });
          const dbCount = gameRows.filter((g) => g.slate_date === date).length;
          const providerCount = dry.gamesAttempted ?? 0;
          if (providerCount > dbCount) {
            const f = newFinding({
              check: "missing_games", sport, severity: "error", slate_date: date,
              detail: `Provider lists ${providerCount} fixtures for ${date} but DB has ${dbCount} seeded.`,
              reason: "scheduled game(s) missing from DB", autofix: "auto_safe",
              autofix_action: "reseed the slate (seedSoccerGames apply)",
            });
            if (apply) {
              try {
                const r = await seedSoccerGames({ dryRun: false, slateDate: date, logger: log });
                f.fixed = r.gamesUpserted > 0;
                f.detail += ` [auto-fix: reseeded, ${r.gamesUpserted} upserted]`;
              } catch (e) { f.detail += ` [reseed failed: ${e instanceof Error ? e.message : String(e)}]`; }
            }
            findings.push(f);
          }
        } catch (e) {
          findings.push(newFinding({
            check: "missing_games", sport, severity: "warn", slate_date: date,
            detail: `Provider schedule check failed: ${e instanceof Error ? e.message : String(e)}`,
            autofix: "manual",
          }));
        }
      }
    } else {
      // Coarse presence check for the active slate.
      const todayGames = gameRows.filter((g) => g.slate_date === opts.today).length;
      if (todayGames === 0) {
        findings.push(newFinding({
          check: "missing_games", sport, severity: "info", slate_date: opts.today,
          detail: `No ${sport} games seeded for ${opts.today} (offseason/off-day, or a missing slate — provider-level schedule check not wired for ${sport}).`,
          autofix: "manual", autofix_action: "verify against the sport's schedule provider",
        }));
      }
    }

    // ── Per-game checks (2, 3, 5, 6) ──
    for (const g of gameRows) {
      const kickoffMs = new Date(g.game_date).getTime();
      const lineN = lineCountByGame.get(g.id) ?? 0;
      const predMarkets = predMarketsByGame.get(g.id) ?? new Set<string>();
      const mlabel = label(g);

      // Check 2: seeded + odds + 0 predictions.
      if (lineN > 0 && predMarkets.size === 0) {
        const cls = classifyNoPredictionReason({ status: g.status, kickoffMs, nowMs, slateDate: g.slate_date, gameSport: sport });
        const f = newFinding({
          check: "odds_no_predictions", sport, severity: cls.severity, game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
          detail: `Seeded game with ${lineN} line rows but 0 prediction records.`,
          reason: cls.reason, autofix: cls.autofix, autofix_action: cls.action,
        });
        if (apply && cls.autofix === "auto_safe" && sport === "soccer") {
          try {
            const { writeSoccerPredictionRecords } = await import("@/lib/services/soccer/writeSoccerPredictionRecords");
            const r = await writeSoccerPredictionRecords({ slateDate: g.slate_date, apply: true, logger: log, gameId: g.id });
            f.fixed = r.recordsCreated > 0;
            f.detail += ` [auto-fix: writer rerun, ${r.recordsCreated} records created]`;
          } catch (e) { f.detail += ` [writer rerun failed: ${e instanceof Error ? e.message : String(e)}]`; }
        }
        findings.push(f);
      }

      // Check 3: market coverage (only when the game HAS predictions and is not started).
      if (predMarkets.size > 0) {
        const expected = EXPECTED_MARKETS[sport];
        const missing = expected.filter((m) => !predMarkets.has(m));
        if (missing.length) {
          findings.push(newFinding({
            check: "market_coverage", sport, severity: "warn", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
            detail: `Missing expected market(s): ${missing.join(", ")} (have: ${[...predMarkets].join(", ")}).`,
            reason: "incomplete market set", autofix: "hold",
            autofix_action: "rerun the prediction writer; if persistent, missing odds for that market",
          }));
        }
        // MLB first_inning: conditional — only flag if an FI line exists but no FI prediction.
        if (sport === "mlb" && !predMarkets.has("first_inning")) {
          findings.push(newFinding({
            check: "market_coverage_first_inning", sport, severity: "info", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
            detail: "No first_inning prediction.",
            reason: "first_inning intentionally unavailable or FI line missing", autofix: "manual",
            autofix_action: "confirm FI line availability for this game",
          }));
        }
      }

      // Check 5: line integrity (fliff contamination + flipped/both-positive ML).
      if (lineN > 0) {
        const { data: ml } = await sb.from("lines").select("sportsbook, side, odds_american, market_type")
          .eq("game_id", g.id).in("market_type", ["moneyline", "match_result"]);
        const mlRows = ml ?? [];
        const fliff = mlRows.filter((r) => isBlockedSportsbook(r.sportsbook));
        if (fliff.length) {
          findings.push(newFinding({
            // INFO, not a "fix": these rows are persisted but neutralized at
            // every read by isBlockedSportsbook — nothing is mutated, so this
            // must NOT inflate the `fixed`/records_updated count (which should
            // reflect only real repairs the operator should notice).
            check: "blocked_book_contamination", sport, severity: "info", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
            detail: `${fliff.length} blocked-book (fliff) ML row(s) present in DB — neutralized at read-time, no action needed.`,
            reason: "blocked sportsbook rows persisted but ignored at every consume point", autofix: "manual",
            autofix_action: "no write needed; filtered at read-time by isBlockedSportsbook",
          }));
        }
        // Both-positive ML pair on a single clean book (impossible 2-way).
        const byBook = new Map<string, number[]>();
        for (const r of mlRows) {
          if (isBlockedSportsbook(r.sportsbook)) continue;
          if (typeof r.odds_american !== "number") continue;
          if (!byBook.has(r.sportsbook)) byBook.set(r.sportsbook, []);
          byBook.get(r.sportsbook)!.push(r.odds_american);
        }
        for (const [book, odds] of byBook) {
          const twoWay = odds.filter((o) => o > -10000);
          if (twoWay.length >= 2 && twoWay.every((o) => o > 0)) {
            findings.push(newFinding({
              check: "corrupted_odds", sport, severity: "warn", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
              detail: `Impossible both-positive ML pair on ${book}: ${twoWay.join(", ")}.`,
              reason: "corrupted/outlier odds from a single book", autofix: "hold",
              autofix_action: "exclude this book from consensus; verify provider feed",
            }));
          }
        }
      }

      // Check 6: lock by T-60 + final-with-preds-no-grades.
      const isFinal = /final|complete|closed/i.test(g.status);
      const pastLock = kickoffMs - nowMs <= LOCK_WINDOW_MS;
      if (predMarkets.size > 0 && pastLock && !isFinal) {
        // Should be locked: check for a locked_at snapshot.
        const { count: lockedCount } = await sb.from("prediction_records")
          .select("id", { count: "exact", head: true }).eq("game_id", g.id).not("locked_at", "is", null);
        if ((lockedCount ?? 0) === 0) {
          findings.push(newFinding({
            check: "missing_lock_snapshot", sport, severity: "warn", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
            detail: `Within T-60 of kickoff but no locked_at snapshot on any prediction row.`,
            reason: "lock not applied by T-60", autofix: "hold",
            autofix_action: "next writer pass locks at T-60; investigate if it persists past kickoff",
          }));
        }
      }
      if (isFinal && predMarkets.size > 0) {
        // Final game with predictions: should have grade rows.
        const { data: recIds } = await sb.from("prediction_records").select("id").eq("game_id", g.id);
        const ids = (recIds ?? []).map((r) => r.id);
        let gradeCount = 0;
        for (let i = 0; i < ids.length; i += 500) {
          const { count } = await sb.from("prediction_grades").select("prediction_record_id", { count: "exact", head: true }).in("prediction_record_id", ids.slice(i, i + 500));
          gradeCount += count ?? 0;
        }
        if (gradeCount === 0) {
          findings.push(newFinding({
            check: "final_no_grades", sport, severity: "error", game_id: g.id, matchup: mlabel, slate_date: g.slate_date,
            detail: `Final game with ${ids.length} prediction records but 0 grade rows.`,
            reason: "tracking-refresh grading hasn't settled this game", autofix: "hold",
            autofix_action: "rerun gradePredictionsForSlate for the slate (tracking-refresh cron)",
          }));
        }
      }
    }
  }

  // ── Check 4 + 7: route/card coverage + WC caution audit (soccer focus) ──
  if (sports.includes("soccer")) {
    await auditSoccerCardAndCautions(sb, opts.today, findings);

    // Check 6 (tracking floor): confirm WC official tracking starts on the
    // floor date and pre-floor slates are graded internally but excluded.
    const beforeFloor = addDays(SOCCER_TRACKING_FLOOR, -1);
    const { data: preRecs } = await sb.from("prediction_records").select("id").eq("sport", "soccer").eq("slate_date", beforeFloor);
    const preIds = (preRecs ?? []).map((r) => r.id);
    let preGrades = 0;
    for (let i = 0; i < preIds.length; i += 500) {
      const { count } = await sb.from("prediction_grades").select("prediction_record_id", { count: "exact", head: true }).in("prediction_record_id", preIds.slice(i, i + 500));
      preGrades += count ?? 0;
    }
    findings.push(newFinding({
      check: "wc_tracking_floor", sport: "soccer", severity: "info", slate_date: SOCCER_TRACKING_FLOOR,
      detail: `WC official tracking floor = ${SOCCER_TRACKING_FLOOR}. Pre-floor slate ${beforeFloor}: ${preIds.length} records / ${preGrades} internal grades (graded internally, EXCLUDED from public tracking).`,
      reason: preGrades > 0 ? "floor working: pre-floor graded internally but excluded publicly" : "no pre-floor grades",
      autofix: "manual",
    }));
  }
  // Check 4 for NBA/NHL: adapter field scan on the active slate.
  for (const sport of sports) {
    if (sport === "nba" || sport === "nhl") {
      await auditAdapterCard(sport, opts.today, findings);
    }
  }

  // ── Check 6 (tracking bridge presence) ──
  // Soccer grades to prediction_grades and is bridged into the public tracker;
  // NBA/NHL grade to prediction_grades but are NOT bridged → flag.
  for (const sport of ["nba", "nhl"] as Sport[]) {
    if (!sports.includes(sport)) continue;
    findings.push(newFinding({
      check: "tracking_bridge_missing", sport, severity: "warn",
      detail: `${sport} grades to prediction_grades but the public tracker reads prediction_results and has no bridge for ${sport} (soccer is bridged; ${sport} is not).`,
      reason: "modern-grading sport not surfaced in public tracking", autofix: "manual",
      autofix_action: `extend the tracking route loader to bridge ${sport} like loadSoccerGradeRows`,
    }));
  }

  const summary = {
    errors: findings.filter((f) => f.severity === "error").length,
    warns: findings.filter((f) => f.severity === "warn").length,
    infos: findings.filter((f) => f.severity === "info").length,
    autofix_safe: findings.filter((f) => f.autofix === "auto_safe").length,
    hold: findings.filter((f) => f.autofix === "hold").length,
    manual: findings.filter((f) => f.autofix === "manual").length,
    fixed: findings.filter((f) => f.fixed).length,
  };

  return { as_of: new Date().toISOString(), apply, slates, findings, summary };
}

// ─── Check 4 + 7: soccer card + WC caution audit ───────────────────────
async function auditSoccerCardAndCautions(
  sb: SupabaseClient,
  today: string,
  findings: AuditFinding[],
): Promise<void> {
  let resp: { games?: unknown[] } | null = null;
  try {
    const { buildSoccerDailyEdgeAdapted } = await import("@/lib/services/soccer/buildSoccerDailyEdgeAdapted");
    resp = (await buildSoccerDailyEdgeAdapted(today)) as { games?: unknown[] };
  } catch (e) {
    findings.push(newFinding({
      check: "route_card_error", sport: "soccer", severity: "error", slate_date: today,
      detail: `WC daily-edge adapter threw: ${e instanceof Error ? e.message : String(e)}`,
      autofix: "manual",
    }));
    return;
  }
  const games = Array.isArray(resp?.games) ? resp!.games as Array<Record<string, unknown>> : [];
  const nowMs = Date.now();

  // The card's `id` is "soccer-<external_id>" — join card↔DB on external_id.
  const { data: gs } = await sb.from("games").select("id, external_id, game_date, status").eq("sport", "soccer").eq("slate_date", today);
  const extToId = new Map<number, number>();
  const slateGames = (gs ?? []) as Array<{ id: number; external_id: number; game_date: string; status: string }>;
  for (const g of slateGames) extToId.set(Number(g.external_id), g.id);
  const cardInternalIds = new Set(
    games.map((g) => extToId.get(Number(g.external_id))).filter((x): x is number => x != null),
  );
  const { data: predGames } = await sb.from("prediction_records").select("game_id").eq("sport", "soccer").eq("slate_date", today);
  const predicted = new Set((predGames ?? []).map((r) => r.game_id));
  // Only flag UPCOMING predicted games that are absent from the card (started/
  // final games are hidden by design and must not false-positive).
  for (const sg of slateGames) {
    const upcoming = new Date(sg.game_date).getTime() > nowMs && !/final|complete|closed/i.test(sg.status);
    if (upcoming && predicted.has(sg.id) && !cardInternalIds.has(sg.id)) {
      findings.push(newFinding({
        check: "route_visibility", sport: "soccer", severity: "error", game_id: sg.id, slate_date: today,
        detail: `Upcoming game ${sg.id} has predictions for ${today} but does NOT appear on the WC daily-edge card.`,
        reason: "route filter hides a predicted upcoming game (kickoff/lock/slate filter?)", autofix: "manual",
        autofix_action: "check the adapter's slate/kickoff visibility filter",
      }));
    }
  }

  // Field integrity + caution audit per visible game.
  for (const g of games) {
    const mlabel = `${g.awayTeam ?? "?"}@${g.homeTeam ?? "?"}`;
    const internalId = extToId.get(Number(g.external_id)) ?? null;
    // Missing logos.
    if (!g.awayTeamLogo || !g.homeTeamLogo) {
      findings.push(newFinding({
        check: "card_missing_logo", sport: "soccer", severity: "warn", game_id: internalId, matchup: mlabel, slate_date: today,
        detail: `Missing team logo (home=${g.homeTeamLogo ?? "null"}, away=${g.awayTeamLogo ?? "null"}).`,
        reason: "country flag unmapped for a team code", autofix: "manual",
        autofix_action: "add the alpha-3 code to _countryFlags ALPHA3_TO_ALPHA2",
      }));
    }
    // Lowercase / malformed team labels.
    for (const side of ["homeTeam", "awayTeam"] as const) {
      const v = g[side];
      if (typeof v === "string" && (v === v.toLowerCase() && v !== v.toUpperCase())) {
        findings.push(newFinding({
          check: "card_team_label", sport: "soccer", severity: "warn", game_id: internalId, matchup: mlabel, slate_date: today,
          detail: `Lowercase/malformed team label: ${side}="${v}".`, autofix: "manual",
        }));
      }
    }
    // NaN/null/malformed scan on predictions.
    const preds = (g.predictions ?? {}) as Record<string, Record<string, unknown>>;
    for (const [mk, p] of Object.entries(preds)) {
      for (const [k, val] of Object.entries(p ?? {})) {
        if (typeof val === "number" && Number.isNaN(val)) {
          findings.push(newFinding({
            check: "card_nan_field", sport: "soccer", severity: "error", game_id: internalId, matchup: mlabel, slate_date: today,
            detail: `NaN field in ${mk}.${k}.`, autofix: "manual",
          }));
        }
        if (typeof val === "string" && /\bNaN\b|undefined|\[object/i.test(val)) {
          findings.push(newFinding({
            check: "card_malformed_field", sport: "soccer", severity: "error", game_id: internalId, matchup: mlabel, slate_date: today,
            detail: `Malformed string in ${mk}.${k}="${val}".`, autofix: "manual",
          }));
        }
      }
    }

    // (Caution-pick audit is record-driven below — play_grade is the
    // authoritative grade; the card's sharpStatus defaults to "caution" and
    // is NOT the displayed grade, so it must not drive the caution audit.)
  }

  // Check 7: WC caution-pick audit (record-driven).
  await auditWcCautionPicks(sb, today, nowMs, cardInternalIds, findings);
}

/**
 * Check 7 — enumerate every current/upcoming WC caution pick (play_grade =
 * "Caution") and verify it is healthy: backing record present, not held,
 * numeric fields present, market odds available, card-visible, gradeable
 * market, no duplicates.
 */
async function auditWcCautionPicks(
  sb: SupabaseClient,
  today: string,
  nowMs: number,
  cardInternalIds: Set<number>,
  findings: AuditFinding[],
): Promise<void> {
  const { data: recs } = await sb
    .from("prediction_records")
    .select("id, game_id, matchup, market, pick, held, play_grade, model_probability, market_probability, edge, confidence, odds_american, slate_date")
    .eq("sport", "soccer")
    .gte("slate_date", today)
    .ilike("play_grade", "caution");
  const cautions = (recs ?? []) as Array<Record<string, unknown>>;
  if (cautions.length === 0) {
    findings.push(newFinding({
      check: "wc_caution_audit", sport: "soccer", severity: "info", slate_date: today,
      detail: "No current/upcoming WC caution picks to audit.", autofix: "manual",
    }));
    return;
  }

  // Game + odds context (batched).
  const gameIds = [...new Set(cautions.map((c) => Number(c.game_id)))];
  const { data: gms } = await sb.from("games").select("id, game_date, status").in("id", gameIds);
  const gameById = new Map((gms ?? []).map((g) => [g.id, g as { id: number; game_date: string; status: string }]));

  // Duplicate detection key.
  const seen = new Map<string, number>();
  for (const c of cautions) seen.set(`${c.game_id}|${c.market}`, (seen.get(`${c.game_id}|${c.market}`) ?? 0) + 1);

  let healthy = 0;
  const gradeable = new Set(["match_result", "total", "btts", "double_chance"]);
  for (const c of cautions) {
    const gid = Number(c.game_id);
    const game = gameById.get(gid);
    const mk = String(c.market);
    const issues: string[] = [];
    const mp = typeof c.model_probability === "number" ? (c.model_probability as number) : null;
    const edge = typeof c.edge === "number" ? (c.edge as number) : null;

    const oddsAmerican = typeof c.odds_american === "number" ? (c.odds_american as number) : null;
    if (c.held === true) issues.push("HELD — must not surface as a member pick");
    if (mp === null || Number.isNaN(mp)) issues.push("model_probability null/NaN");
    if (edge === null || Number.isNaN(edge)) issues.push("edge null/NaN");
    if (oddsAmerican === null) issues.push("no price (odds_american null)");
    if (!gradeable.has(mk)) issues.push(`market "${mk}" is not gradeable by soccerGrading`);
    if ((seen.get(`${gid}|${mk}`) ?? 0) > 1) issues.push("duplicate caution record for this game+market");
    // Card visibility (only meaningful for upcoming games on TODAY's slate).
    const upcoming = game ? new Date(game.game_date).getTime() > nowMs && !/final|complete|closed/i.test(game.status) : false;
    if (c.slate_date === today && upcoming && !cardInternalIds.has(gid)) {
      issues.push("upcoming but not visible on the WC card");
    }

    if (issues.length) {
      findings.push(newFinding({
        check: "wc_caution_unhealthy", sport: "soccer",
        severity: "error", // all remaining issues are genuine integrity problems
        game_id: gid, matchup: String(c.matchup ?? ""), slate_date: String(c.slate_date),
        detail: `Caution ${mk} (pick=${c.pick} mP=${mp} edge=${edge}): ${issues.join("; ")}.`,
        reason: "caution pick health issue", autofix: "manual",
        autofix_action: "investigate; regenerate record or adjust grade as warranted",
      }));
    } else {
      healthy++;
      // Informational: a large-edge Caution is EXPECTED (the grade ladder
      // caps big model-vs-market divergence to Caution pre-calibration). Note
      // it as an upgrade candidate for after WC calibration — not a bug.
      if (edge !== null && Math.abs(edge) >= 8) {
        findings.push(newFinding({
          check: "wc_caution_large_edge_expected", sport: "soccer", severity: "info",
          game_id: gid, matchup: String(c.matchup ?? ""), slate_date: String(c.slate_date),
          detail: `Caution ${mk} (pick=${c.pick}) has a large ${edge.toFixed(1)}pp edge — expected pre-calibration cap; upgrade candidate once WC calibration exists.`,
          reason: "uncalibrated large-divergence capped to Caution (by design)", autofix: "manual",
          autofix_action: "revisit after WC Platt calibration (project_wc_calibration_roadmap)",
        }));
      }
    }
  }
  findings.push(newFinding({
    check: "wc_caution_audit", sport: "soccer", severity: "info", slate_date: today,
    detail: `WC caution audit: ${cautions.length} caution pick(s), ${healthy} healthy, ${cautions.length - healthy} flagged.`,
    autofix: "manual",
  }));
}

// ─── Check 4: NBA/NHL adapter field scan ───────────────────────────────
async function auditAdapterCard(sport: "nba" | "nhl", today: string, findings: AuditFinding[]): Promise<void> {
  try {
    const mod = sport === "nba"
      ? await import("@/lib/services/nba/buildNbaDailyEdgeAdapted")
      : await import("@/lib/services/nhl/buildNhlDailyEdgeAdapted");
    const fn = sport === "nba"
      ? (mod as { buildNbaDailyEdgeAdapted: (d: string) => Promise<{ games?: unknown[] }> }).buildNbaDailyEdgeAdapted
      : (mod as { buildNhlDailyEdgeAdapted: (d: string) => Promise<{ games?: unknown[] }> }).buildNhlDailyEdgeAdapted;
    const resp = await fn(today);
    const games = Array.isArray(resp?.games) ? resp.games as Array<Record<string, unknown>> : [];
    for (const g of games) {
      const scan = (o: Record<string, unknown>, path: string) => {
        for (const [k, v] of Object.entries(o)) {
          if (v === null || v === undefined) continue;
          if (typeof v === "number" && Number.isNaN(v)) {
            findings.push(newFinding({ check: "card_nan_field", sport, severity: "error", game_id: null, matchup: String(g.id ?? ""), detail: `NaN at ${path}.${k}.`, autofix: "manual" }));
          } else if (typeof v === "object") {
            scan(v as Record<string, unknown>, `${path}.${k}`);
          }
        }
      };
      scan(g, sport);
    }
  } catch (e) {
    findings.push(newFinding({
      check: "route_card_error", sport, severity: "warn", slate_date: today,
      detail: `${sport} adapter threw: ${e instanceof Error ? e.message : String(e)}`, autofix: "manual",
    }));
  }
}
