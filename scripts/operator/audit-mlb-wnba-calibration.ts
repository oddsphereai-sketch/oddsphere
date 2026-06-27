import { supabase } from "../../lib/db/supabase";
import { MARKET_INTELLIGENCE_V2_RESOLVER_VERSION } from "../../lib/services/marketIntelligenceV2/snapshotSync";

type Row = Record<string, any>;

const argv = process.argv.slice(2);
const jsonOnly = argv.includes("--json");
const yesterday = readFlag("--mlb-date") ?? "2026-06-26";
const today = readFlag("--wnba-date") ?? "2026-06-27";
const wnbaStart = readFlag("--wnba-start") ?? "2026-06-24";

function readFlag(name: string): string | null {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] ?? null : null;
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number | null | undefined, places = 3): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** places;
  return Math.round(value * m) / m;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : round((part / total) * 100, 1)!;
}

function inc(out: Record<string, number>, key: string): void {
  out[key] = (out[key] ?? 0) + 1;
}

function americanProfit(odds: number | null, result: "win" | "loss" | "push" | "void" | "pending"): number | null {
  if (odds === null || result === "void" || result === "pending" || result === "push") return result === "push" ? 0 : null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarizeBetRows(rows: Array<{ result: string; odds: number | null }>) {
  const graded = rows.filter((r) => r.result === "win" || r.result === "loss" || r.result === "push");
  const roiRows = graded
    .map((r) => americanProfit(r.odds, r.result as "win" | "loss" | "push"))
    .filter((x): x is number => x !== null);
  const wins = graded.filter((r) => r.result === "win").length;
  const losses = graded.filter((r) => r.result === "loss").length;
  const pushes = graded.filter((r) => r.result === "push").length;
  const profit = roiRows.reduce((a, b) => a + b, 0);
  return {
    n: graded.length,
    wins,
    losses,
    pushes,
    hitRate: pct(wins, wins + losses),
    roi: roiRows.length ? round((profit / roiRows.length) * 100, 1) : null,
    profit: round(profit, 3),
    roiEligible: roiRows.length,
  };
}

function resultForTotal(side: string | null, line: number | null, actualTotal: number | null): "win" | "loss" | "push" | "pending" {
  if (!side || line === null || actualTotal === null) return "pending";
  if (actualTotal === line) return "push";
  if (actualTotal > line) return side === "over" ? "win" : "loss";
  return side === "under" ? "win" : "loss";
}

function resultForSpread(side: string | null, line: number | null, homeScore: number | null, awayScore: number | null): "win" | "loss" | "push" | "pending" | "void" {
  if (side !== "home" && side !== "away") return "void";
  if (line === null || homeScore === null || awayScore === null) return "pending";
  const margin = side === "home" ? homeScore - awayScore : awayScore - homeScore;
  const cover = margin + line;
  if (cover === 0) return "push";
  return cover > 0 ? "win" : "loss";
}

function resultForMl(side: string | null, homeScore: number | null, awayScore: number | null): "win" | "loss" | "pending" | "void" {
  if (side !== "home" && side !== "away") return "void";
  if (homeScore === null || awayScore === null) return "pending";
  if (homeScore === awayScore) return "void";
  const winner = homeScore > awayScore ? "home" : "away";
  return side === winner ? "win" : "loss";
}

async function page(table: string, build: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await build(supabase.from(table).select("*")).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    out.push(...((res.data ?? []) as Row[]));
    if ((res.data ?? []).length < 1000) return out;
  }
}

async function loadRecords(sport: string, startDate: string, endDate: string | null, markets: string[]): Promise<Row[]> {
  return page("prediction_records", (q) => {
    let query = q.eq("sport", sport).gte("slate_date", startDate).in("market", markets).order("slate_date", { ascending: true });
    if (endDate) query = query.lte("slate_date", endDate);
    return query;
  });
}

async function loadByIds(table: string, ids: number[], column = "id"): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    if (!batch.length) continue;
    const { data, error } = await supabase.from(table).select("*").in(column, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
  }
  return out;
}

function rawTotal(rec: Row): number | null {
  return n(rec.snapshot_json?.mlb_core_model_calibration?.raw_projected_total)
    ?? n(rec.snapshot_json?.total_projection_reconciliation?.raw_projected_total)
    ?? n(rec.snapshot_json?.v2_2_audit?.posterior_total)
    ?? n(rec.snapshot_json?.model?.total);
}

function calibratedMlbTotal(rec: Row): number | null {
  const blob = rec.snapshot_json?.mlb_core_model_calibration;
  return n(blob?.market_aware_projected_total)
    ?? n(blob?.market_aware_projected_total_if_enabled)
    ?? (rawTotal(rec) !== null && n(rec.line_value) !== null
      ? n(rec.line_value)! + 0.25 * (rawTotal(rec)! - n(rec.line_value)!)
      : null);
}

function wnbaRawTotal(rec: Row): number | null {
  const modelTotal = n(rec.snapshot_json?.model?.total);
  if (modelTotal !== null) return modelTotal;
  const away = n(rec.snapshot_json?.projected_score?.away);
  const home = n(rec.snapshot_json?.projected_score?.home);
  return away !== null && home !== null ? away + home : null;
}

function wnbaProjectedMargin(rec: Row): number | null {
  return n(rec.snapshot_json?.model?.margin);
}

function lineAtMarket(rec: Row): number | null {
  return n(rec.line_value);
}

function marketTotalFromSnapshot(rec: Row): number | null {
  return n(rec.snapshot_json?.market_consensus?.total) ?? n(rec.snapshot_json?.trusted_consensus?.total) ?? lineAtMarket(rec);
}

function marketSpreadForPickedSide(rec: Row): number | null {
  return lineAtMarket(rec);
}

function calibratedValue(market: number, raw: number, coef: number): number {
  return market + coef * (raw - market);
}

function totalSideFromProjection(proj: number | null, line: number | null): string | null {
  if (proj === null || line === null) return null;
  if (proj > line) return "over";
  if (proj < line) return "under";
  return null;
}

function spreadSideFromMargin(projectedHomeMargin: number | null, rec: Row): string | null {
  if (projectedHomeMargin === null || rec.line_value === null) return null;
  const homeLine = rec.side === "home" ? n(rec.line_value) : rec.side === "away" ? -n(rec.line_value)! : null;
  if (homeLine === null) return null;
  const edgeHome = projectedHomeMargin + homeLine;
  if (edgeHome > 0) return "home";
  if (edgeHome < 0) return "away";
  return null;
}

function extractOppositeOdds(rec: Row, oppositeSide: string): number | null {
  const lines = rec.snapshot_json?.lines_at_lock;
  if (Array.isArray(lines)) {
    const exact = lines.filter((r: Row) =>
      r.market_type === rec.market &&
      r.side === oppositeSide &&
      (rec.line_value === null || n(r.line_value) === n(rec.line_value) || rec.market === "moneyline")
    );
    const odds = exact.map((r: Row) => n(r.odds_american)).filter((x: number | null): x is number => x !== null);
    if (odds.length) return odds[Math.floor(odds.length / 2)]!;
  }
  const ss = rec.snapshot_json?.odds_source_at_lock_ou;
  if (rec.market === "total" && ss?.[oppositeSide]?.odds != null) return n(ss[oppositeSide].odds);
  return null;
}

function bucketTotalLine(line: number | null): string {
  if (line === null) return "missing";
  if (line <= 155) return "<=155";
  if (line <= 160) return "155.5-160";
  if (line <= 165) return "160.5-165";
  return "165.5+";
}

function bucketSpread(line: number | null): string {
  if (line === null) return "missing";
  const a = Math.abs(line);
  if (a <= 2.5) return "0-2.5";
  if (a <= 5.5) return "3-5.5";
  if (a <= 8.5) return "6-8.5";
  return "9+";
}

function bucketConfidence(c: number | null): string {
  if (c === null) return "missing";
  if (c < 53) return "<53";
  if (c < 56) return "53-55.9";
  if (c < 60) return "56-59.9";
  if (c < 65) return "60-64.9";
  return "65+";
}

function bucketEdge(e: number | null): string {
  if (e === null) return "missing";
  const a = Math.abs(e);
  if (a < 2) return "0-2";
  if (a < 4) return "2-4";
  if (a < 6) return "4-6";
  if (a < 8) return "6-8";
  return "8+";
}

function groupStats(rows: Row[], keyOf: (r: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, rs]) => {
    const summary = summarizeBetRows(rs.map((r) => ({ result: r.recomputed_result ?? r.grade?.result ?? "pending", odds: n(r.odds_american) })));
    const expected = rs
      .map((r) => n(r.model_probability) ?? (n(r.confidence) !== null ? n(r.confidence)! / 100 : null))
      .filter((x): x is number => x !== null);
    const actual = summary.wins + summary.losses ? summary.wins / (summary.wins + summary.losses) : null;
    const expectedAvg = expected.length ? expected.reduce((a, b) => a + b, 0) / expected.length : null;
    const odds = rs.map((r) => n(r.odds_american)).filter((x): x is number => x !== null);
    return {
      key,
      sample: rs.length,
      ...summary,
      avgOdds: odds.length ? round(odds.reduce((a, b) => a + b, 0) / odds.length, 1) : null,
      expectedHitRate: expectedAvg === null ? null : round(expectedAvg * 100, 1),
      actualHitRate: actual === null ? null : round(actual * 100, 1),
      calibrationError: actual === null || expectedAvg === null ? null : round((actual - expectedAvg) * 100, 1),
    };
  });
}

function projectionMetrics(rows: Row[], project: (r: Row) => number | null, sideOf: (r: Row, proj: number | null) => string | null, market: "total" | "spread") {
  const withActual = rows.filter((r) => r.actual_home_score !== null && r.actual_away_score !== null);
  const withProjection = withActual.filter((r) => project(r) !== null);
  const errors = withProjection.map((r) => {
    const p = project(r);
    const actual = market === "total"
      ? n(r.actual_total)
      : n(r.actual_home_score)! - n(r.actual_away_score)!;
    return p! - actual!;
  });
  const sideRows = withProjection.map((r) => {
    const side = sideOf(r, project(r));
    const result = market === "total"
      ? resultForTotal(side, n(r.line_value), n(r.actual_total))
      : resultForSpread(side, side === null ? null : side === r.side ? n(r.line_value) : -n(r.line_value)!, n(r.actual_home_score), n(r.actual_away_score));
    const odds = side === r.side ? n(r.odds_american) : side ? extractOppositeOdds(r, side) : null;
    return { result, odds };
  });
  const betSummary = summarizeBetRows(sideRows);
  return {
    sample: withProjection.length,
    settledRows: withActual.length,
    mae: errors.length ? round(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length, 3) : null,
    rmse: errors.length ? round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length), 3) : null,
    bias: errors.length ? round(errors.reduce((a, b) => a + b, 0) / errors.length, 3) : null,
    side: betSummary,
  };
}

async function latestMarketReadLabels(sport: string, records: Row[]) {
  const eventIds = Array.from(new Set(records.map((r) => String(r.external_id)).filter(Boolean)));
  if (!eventIds.length) return new Map<string, string>();
  const rows: Row[] = [];
  for (let i = 0; i < eventIds.length; i += 500) {
    const { data, error } = await supabase
      .from("market_intelligence_snapshots_v2")
      .select("canonical_event_id, market_type, selection_key, label, validity_status, generated_at")
      .eq("league", sport)
      .eq("resolver_version", MARKET_INTELLIGENCE_V2_RESOLVER_VERSION)
      .in("canonical_event_id", eventIds.slice(i, i + 500));
    if (error) throw new Error(`market_intelligence_snapshots_v2: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
  }
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.canonical_event_id}:${row.market_type}:${row.selection_key}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(row.generated_at) > Date.parse(prev.generated_at)) latest.set(key, row);
  }
  const out = new Map<string, string>();
  for (const rec of records) {
    const key = `${rec.external_id}:${rec.market}:${rec.external_id}:${rec.market}:${rec.side}`;
    const snap = latest.get(key);
    out.set(`${rec.id}`, snap?.validity_status?.startsWith("valid") ? snap.label ?? "valid_unlabeled" : "No Market Read");
  }
  return out;
}

async function mlbAudit() {
  const records = await loadRecords("mlb", yesterday, yesterday, ["total"]);
  const grades = await loadByIds("prediction_grades", records.map((r) => r.id), "prediction_record_id");
  const games = await loadByIds("games", Array.from(new Set(records.map((r) => r.game_id))));
  const gradeByRecord = new Map(grades.map((g) => [g.prediction_record_id, g]));
  const gameById = new Map(games.map((g) => [g.id, g]));

  const rows = records.map((rec) => {
    const game = gameById.get(rec.game_id) ?? {};
    const grade = gradeByRecord.get(rec.id) ?? null;
    const actualTotal = n(grade?.actual_total) ?? (n(game.home_score) !== null && n(game.away_score) !== null ? n(game.home_score)! + n(game.away_score)! : null);
    const raw = rawTotal(rec);
    const calibrated = calibratedMlbTotal(rec);
    const market = n(rec.line_value);
    const prodSide = String(rec.side ?? rec.pick ?? "").toLowerCase();
    const calSide = totalSideFromProjection(calibrated, market);
    const calResult = resultForTotal(calSide, market, actualTotal);
    const prodResult = grade?.result ?? resultForTotal(prodSide, market, actualTotal);
    const calOdds = calSide === prodSide ? n(rec.odds_american) : calSide ? extractOppositeOdds(rec, calSide) : null;
    return {
      matchup: rec.matchup,
      marketTotal: market,
      rawProjectedTotal: round(raw, 3),
      calibratedProjectedTotal: round(calibrated, 3),
      actualFinalTotal: actualTotal,
      rawAbsError: raw !== null && actualTotal !== null ? round(Math.abs(raw - actualTotal), 3) : null,
      calibratedAbsError: calibrated !== null && actualTotal !== null ? round(Math.abs(calibrated - actualTotal), 3) : null,
      marketAbsError: market !== null && actualTotal !== null ? round(Math.abs(market - actualTotal), 3) : null,
      calibratedBeatRaw: raw !== null && calibrated !== null && actualTotal !== null ? Math.abs(calibrated - actualTotal) < Math.abs(raw - actualTotal) : null,
      calibratedBeatMarket: calibrated !== null && market !== null && actualTotal !== null ? Math.abs(calibrated - actualTotal) < Math.abs(market - actualTotal) : null,
      productionPick: prodSide,
      productionResult: prodResult,
      productionOdds: n(rec.odds_american),
      calibratedSideIfAllowed: calSide,
      calibratedSideResult: calResult,
      calibratedSideOdds: calOdds,
      recommendationUseImpact: calSide === null || calSide === prodSide ? "no_side_change" : calResult === prodResult ? "same_result" : calResult === "win" ? "helped" : calResult === "loss" ? "hurt" : "push_or_pending",
    };
  });

  const rawErr = rows.map((r) => r.rawAbsError).filter((x): x is number => x !== null);
  const calErr = rows.map((r) => r.calibratedAbsError).filter((x): x is number => x !== null);
  const mktErr = rows.map((r) => r.marketAbsError).filter((x): x is number => x !== null);
  const hypothetical = rows.map((r) => ({ result: r.calibratedSideResult, odds: r.calibratedSideOdds }));
  return {
    date: yesterday,
    rows,
    summary: {
      games: rows.length,
      rawMAE: rawErr.length ? round(rawErr.reduce((a, b) => a + b, 0) / rawErr.length, 3) : null,
      calibratedMAE: calErr.length ? round(calErr.reduce((a, b) => a + b, 0) / calErr.length, 3) : null,
      marketMAE: mktErr.length ? round(mktErr.reduce((a, b) => a + b, 0) / mktErr.length, 3) : null,
      calibratedImprovedCount: rows.filter((r) => r.calibratedBeatRaw === true).length,
      rawImprovedCount: rows.filter((r) => r.calibratedBeatRaw === false).length,
      marketBeatCalibratedCount: rows.filter((r) => r.calibratedBeatMarket === false).length,
      calibratedBeatRawPct: pct(rows.filter((r) => r.calibratedBeatRaw === true).length, rows.filter((r) => r.calibratedBeatRaw !== null).length),
      calibratedBeatMarketPct: pct(rows.filter((r) => r.calibratedBeatMarket === true).length, rows.filter((r) => r.calibratedBeatMarket !== null).length),
      sideDifferences: rows.filter((r) => r.calibratedSideIfAllowed && r.calibratedSideIfAllowed !== r.productionPick).length,
      recommendationUseHypothetical: summarizeBetRows(hypothetical),
      formulaStillUseful: calErr.length && rawErr.length && (calErr.reduce((a, b) => a + b, 0) / calErr.length) < (rawErr.reduce((a, b) => a + b, 0) / rawErr.length),
    },
  };
}

async function wnbaAudit() {
  const records = await loadRecords("wnba", wnbaStart, null, ["moneyline", "total", "spread"]);
  const grades = await loadByIds("prediction_grades", records.map((r) => r.id), "prediction_record_id");
  const games = await loadByIds("games", Array.from(new Set(records.map((r) => r.game_id))));
  const teams = await loadByIds("teams", Array.from(new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter(Boolean))));
  const marketLabels = await latestMarketReadLabels("wnba", records);
  const gradeByRecord = new Map(grades.map((g) => [g.prediction_record_id, g]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const enriched: Row[] = records.map((rec) => {
    const game = gameById.get(rec.game_id) ?? {};
    const grade = gradeByRecord.get(rec.id) ?? null;
    const homeScore = n(game.home_score);
    const awayScore = n(game.away_score);
    const actualTotal = homeScore !== null && awayScore !== null ? homeScore + awayScore : n(grade?.actual_total);
    const recomputed = rec.market === "moneyline"
      ? resultForMl(rec.side, homeScore, awayScore)
      : rec.market === "total"
        ? resultForTotal(rec.side, n(rec.line_value), actualTotal)
        : resultForSpread(rec.side, n(rec.line_value), homeScore, awayScore);
    const homeTeam = teamById.get(game.home_team_id)?.abbreviation ?? "?";
    const awayTeam = teamById.get(game.away_team_id)?.abbreviation ?? "?";
    return {
      ...rec,
      grade,
      game,
      matchupComputed: `${awayTeam}@${homeTeam}`,
      actual_home_score: homeScore,
      actual_away_score: awayScore,
      actual_total: actualTotal,
      recomputed_result: recomputed,
      grade_mismatch: grade && grade.result !== recomputed && recomputed !== "pending" ? { stored: grade.result, recomputed } : null,
      market_read_label: marketLabels.get(`${rec.id}`) ?? "No Market Read",
    };
  });

  const settled = enriched.filter((r) => ["win", "loss", "push"].includes(r.recomputed_result));
  const totals = settled.filter((r) => r.market === "total");
  const spreads = settled.filter((r) => r.market === "spread");
  const mls = settled.filter((r) => r.market === "moneyline");

  const byGame = new Map<number, Row[]>();
  for (const r of records) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id)!.push(r);
  }
  const duplicateRows = Array.from(byGame.values()).flatMap((rs) => {
    const counts = new Map<string, Row[]>();
    for (const r of rs) {
      if (!counts.has(r.market)) counts.set(r.market, []);
      counts.get(r.market)!.push(r);
    }
    return Array.from(counts.entries()).filter(([, v]) => v.length > 1).map(([market, v]) => ({
      game_id: v[0].game_id,
      matchup: v[0].matchup,
      market,
      ids: v.map((r) => r.id),
    }));
  });

  const expectedMarkets = ["moneyline", "total", "spread"];
  const missingExpectedRows = Array.from(byGame.entries()).flatMap(([gameId, rs]) => {
    const have = new Set(rs.map((r) => r.market));
    return expectedMarkets.filter((m) => !have.has(m)).map((market) => ({
      game_id: gameId,
      matchup: rs[0]?.matchup ?? null,
      market,
    }));
  });

  const lockIssues = enriched.filter((r) => {
    const start = Date.parse(r.game_date);
    const locked = r.locked_at ? Date.parse(r.locked_at) : NaN;
    if (!Number.isFinite(start)) return false;
    if (!r.locked_at) return Date.now() > start - 60 * 60 * 1000;
    return Number.isFinite(locked) && locked > start;
  }).map((r) => ({
    id: r.id,
    matchup: r.matchup,
    market: r.market,
    game_date: r.game_date,
    locked_at: r.locked_at,
    issue: r.locked_at ? "locked_after_tip" : "missing_lock_inside_t60_or_after_start",
  }));

  const integrity = {
    recordCount: records.length,
    settledCount: settled.length,
    currentOrPendingCount: enriched.length - settled.length,
    gamesWithRecords: byGame.size,
    missingExpectedRows,
    duplicateRows,
    missingLockedPrices: enriched.filter((r) => r.locked_at && r.odds_american == null).map((r) => ({ id: r.id, matchup: r.matchup, market: r.market, side: r.side, line: r.line_value })),
    gradeMismatches: enriched.filter((r) => r.grade_mismatch).map((r) => ({ id: r.id, matchup: r.matchup, market: r.market, stored: r.grade_mismatch.stored, recomputed: r.grade_mismatch.recomputed })),
    lockIssues,
    sideSignIssues: enriched.filter((r) => r.market === "spread" && r.side === "home" && String(r.pick ?? "").includes("+") && n(r.line_value)! < 0)
      .concat(enriched.filter((r) => r.market === "spread" && r.side === "away" && String(r.pick ?? "").includes("+") && n(r.line_value)! < 0))
      .map((r) => ({ id: r.id, matchup: r.matchup, pick: r.pick, side: r.side, line: r.line_value })),
  };

  const performanceBreakdown = {
    byMarket: groupStats(settled, (r) => r.market),
    byGrade: groupStats(settled, (r) => r.play_grade ?? "missing"),
    byConfidence: groupStats(settled, (r) => bucketConfidence(n(r.confidence))),
    byEdge: groupStats(settled, (r) => bucketEdge(n(r.edge))),
    byMarketRead: groupStats(settled, (r) => r.market_read_label ?? "No Market Read"),
    mlFavoritesDogs: groupStats(mls, (r) => n(r.odds_american) !== null && n(r.odds_american)! < 0 ? "favorite" : "dog"),
    mlHomeAway: groupStats(mls, (r) => r.side ?? "missing"),
    totalsOverUnder: groupStats(totals, (r) => r.side ?? "missing"),
    totalLineBuckets: groupStats(totals, (r) => bucketTotalLine(n(r.line_value))),
    spreadsFavoriteDog: groupStats(spreads, (r) => n(r.line_value) !== null && n(r.line_value)! < 0 ? "favorite_ats" : "dog_ats"),
    spreadSizeBuckets: groupStats(spreads, (r) => bucketSpread(n(r.line_value))),
    spreadsHomeAway: groupStats(spreads, (r) => r.side ?? "missing"),
  };

  const totalCoefficients = [0, 0.25, 0.5, 0.75, 1];
  const totalCandidates = Object.fromEntries(totalCoefficients.map((coef) => [
    `market_plus_${Math.round(coef * 100)}pct_model_edge`,
    projectionMetrics(totals, (r) => {
      const raw = wnbaRawTotal(r);
      const market = marketTotalFromSnapshot(r);
      return raw === null || market === null ? null : calibratedValue(market, raw, coef);
    }, (r, p) => totalSideFromProjection(p, n(r.line_value)), "total"),
  ]));
  let bestCoef = 0;
  let bestMae = Infinity;
  for (let coef = 0; coef <= 1.0001; coef += 0.05) {
    const m = projectionMetrics(totals, (r) => {
      const raw = wnbaRawTotal(r);
      const market = marketTotalFromSnapshot(r);
      return raw === null || market === null ? null : calibratedValue(market, raw, coef);
    }, (r, p) => totalSideFromProjection(p, n(r.line_value)), "total");
    if (m.mae !== null && m.mae < bestMae) {
      bestMae = m.mae;
      bestCoef = round(coef, 2)!;
    }
  }

  const spreadCandidates = Object.fromEntries(totalCoefficients.map((coef) => [
    `market_plus_${Math.round(coef * 100)}pct_model_edge`,
    projectionMetrics(spreads, (r) => {
      const rawHomeMargin = wnbaProjectedMargin(r);
      if (rawHomeMargin === null) return null;
      const marketHomeMargin = r.side === "home" ? -n(r.line_value)! : n(r.line_value)!;
      return calibratedValue(marketHomeMargin, rawHomeMargin, coef);
    }, (r, p) => spreadSideFromMargin(p, r), "spread"),
  ]));
  let bestSpreadCoef = 0;
  let bestSpreadMae = Infinity;
  for (let coef = 0; coef <= 1.0001; coef += 0.05) {
    const m = projectionMetrics(spreads, (r) => {
      const rawHomeMargin = wnbaProjectedMargin(r);
      if (rawHomeMargin === null) return null;
      const marketHomeMargin = r.side === "home" ? -n(r.line_value)! : n(r.line_value)!;
      return calibratedValue(marketHomeMargin, rawHomeMargin, coef);
    }, (r, p) => spreadSideFromMargin(p, r), "spread");
    if (m.mae !== null && m.mae < bestSpreadMae) {
      bestSpreadMae = m.mae;
      bestSpreadCoef = round(coef, 2)!;
    }
  }

  const upcoming = enriched
    .filter((r) => r.slate_date >= today && !["win", "loss", "push"].includes(r.recomputed_result))
    .map((r) => {
      const rawT = wnbaRawTotal(r);
      const mktT = marketTotalFromSnapshot(r);
      const rawM = wnbaProjectedMargin(r);
      const marketHomeMargin = r.market === "spread" && n(r.line_value) !== null
        ? (r.side === "home" ? -n(r.line_value)! : n(r.line_value)!)
        : null;
      const bestTotal = rawT !== null && mktT !== null ? calibratedValue(mktT, rawT, bestCoef) : null;
      const bestSpread = rawM !== null && marketHomeMargin !== null ? calibratedValue(marketHomeMargin, rawM, bestSpreadCoef) : null;
      const suggestedSide = r.market === "total"
        ? totalSideFromProjection(bestTotal, n(r.line_value))
        : r.market === "spread"
          ? spreadSideFromMargin(bestSpread, r)
          : r.side;
      return {
        id: r.id,
        matchup: r.matchup,
        market: r.market,
        currentPick: r.pick,
        currentSide: r.side,
        currentLine: r.line_value,
        currentPrice: r.odds_american,
        confidence: r.confidence,
        grade: r.play_grade,
        projectedScore: r.snapshot_json?.projected_score ?? null,
        rawProjectedTotal: round(rawT, 2),
        rawProjectedHomeMargin: round(rawM, 2),
        bestCalibratedTotalCandidate: r.market === "total" ? round(bestTotal, 2) : null,
        bestCalibratedSpreadCandidateHomeMargin: r.market === "spread" ? round(bestSpread, 2) : null,
        wouldPickChange: suggestedSide !== null && suggestedSide !== r.side,
        wouldGradeChange: "not_tested_live",
        reasonCode: suggestedSide !== null && suggestedSide !== r.side ? "calibrated_side_differs_audit_only" : "no_audit_side_change",
        safetyStatus: settled.length < 30 ? "not enough evidence" : "audit-only",
      };
    });

  return {
    startDate: wnbaStart,
    asOfDate: today,
    integrity,
    performanceBreakdown,
    totalsCalibration: {
      candidates: {
        currentRaw: projectionMetrics(totals, (r) => wnbaRawTotal(r), (r, p) => totalSideFromProjection(p, n(r.line_value)), "total"),
        marketTotal: projectionMetrics(totals, (r) => marketTotalFromSnapshot(r), (r, p) => totalSideFromProjection(p, n(r.line_value)), "total"),
        ...totalCandidates,
        learnedShrinkageCoefficient: {
          coefficient: bestCoef,
          metrics: projectionMetrics(totals, (r) => {
            const raw = wnbaRawTotal(r);
            const market = marketTotalFromSnapshot(r);
            return raw === null || market === null ? null : calibratedValue(market, raw, bestCoef);
          }, (r, p) => totalSideFromProjection(p, n(r.line_value)), "total"),
          overfittingRisk: totals.length < 50 ? "high_thin_sample" : "moderate",
        },
      },
      unavailableCandidateFamilies: ["pace correction", "injury/availability correction", "rest/travel correction", "league-average scoring environment correction"].filter(Boolean),
      examples: totals.map((r) => ({
        matchup: r.matchup,
        marketTotal: r.line_value,
        rawProjectedTotal: round(wnbaRawTotal(r), 2),
        actualTotal: r.actual_total,
        projectionError: round((wnbaRawTotal(r) ?? 0) - (r.actual_total ?? 0), 2),
        pick: r.pick,
        result: r.recomputed_result,
        grade: r.play_grade,
        marketRead: r.market_read_label,
        movement: r.snapshot_json?.public_market_context ?? null,
        dataQuality: r.snapshot_json?.data_quality ?? null,
      })),
    },
    spreadCalibration: {
      candidates: {
        currentRaw: projectionMetrics(spreads, (r) => wnbaProjectedMargin(r), (r, p) => spreadSideFromMargin(p, r), "spread"),
        marketSpread: projectionMetrics(spreads, (r) => r.side === "home" ? -n(r.line_value)! : n(r.line_value)!, (r, p) => spreadSideFromMargin(p, r), "spread"),
        ...spreadCandidates,
        learnedShrinkageCoefficient: {
          coefficient: bestSpreadCoef,
          metrics: projectionMetrics(spreads, (r) => {
            const rawHomeMargin = wnbaProjectedMargin(r);
            if (rawHomeMargin === null) return null;
            const marketHomeMargin = r.side === "home" ? -n(r.line_value)! : n(r.line_value)!;
            return calibratedValue(marketHomeMargin, rawHomeMargin, bestSpreadCoef);
          }, (r, p) => spreadSideFromMargin(p, r), "spread"),
          overfittingRisk: spreads.length < 50 ? "high_thin_sample" : "moderate",
        },
      },
      unavailableCandidateFamilies: ["injury/rest correction", "team-strength weight recalibration"].filter(Boolean),
      examples: spreads.map((r) => ({
        matchup: r.matchup,
        marketSpread: r.line_value,
        projectedHomeMargin: round(wnbaProjectedMargin(r), 2),
        actualHomeMargin: r.actual_home_score !== null && r.actual_away_score !== null ? r.actual_home_score - r.actual_away_score : null,
        marginError: r.actual_home_score !== null && r.actual_away_score !== null && wnbaProjectedMargin(r) !== null ? round(wnbaProjectedMargin(r)! - (r.actual_home_score - r.actual_away_score), 2) : null,
        pick: r.pick,
        side: r.side,
        result: r.recomputed_result,
        grade: r.play_grade,
        marketRead: r.market_read_label,
        dataQuality: r.snapshot_json?.data_quality ?? null,
      })),
    },
    gradeCalibration: {
      byGrade: performanceBreakdown.byGrade,
      bestAnglesOutperformLeans: (() => {
        const ba = performanceBreakdown.byGrade.find((g) => g.key === "best_angle");
        const lean = performanceBreakdown.byGrade.find((g) => g.key === "lean");
        return ba?.roi !== null && lean?.roi !== null ? ba!.roi! > lean!.roi! : null;
      })(),
      higherConfidenceWinsMore: performanceBreakdown.byConfidence,
    },
    upcomingSimulation: upcoming,
  };
}

async function main() {
  const [mlb, wnba] = await Promise.all([mlbAudit(), wnbaAudit()]);
  const report = {
    generatedAt: new Date().toISOString(),
    safety: {
      readOnly: true,
      productionMutation: false,
      recommendationUseEnabled: false,
    },
    mlbTotalCalibrationPostgame: mlb,
    wnbaEmergencyAudit: wnba,
  };
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
