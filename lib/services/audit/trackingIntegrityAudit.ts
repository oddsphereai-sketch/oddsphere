import { computeSlateDate } from "../../dates/slateDate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPredictionRecords, dedupePredictionRecordsForTracking, effectiveTrackingPlayGrade, trackingDisplaySport, isTrackingRecordEligible } from "../trackingAggregateService";
import { gradeStoredTrackingRecord } from "../predictionGradingService";
import type { PredictionRecordRow, PredictionGradeRow } from "../../types/domain/Tracking";

export const TRACKING_INTEGRITY_AUDIT_RELEASE = "tracking_integrity_audit_2026_11_08_r1_published_locks_and_settlement" as const;
const PAGE_SIZE = 200;
const ROLLOUT = "2026-11-08T00:00:00Z";
export type TrackingLockExpectation = { sport: string; externalId: number; market: string; grade: string; lockedAt: string; startsAt: string; source: string; exactGrade?: boolean };
export type TrackingIntegrityFinding = { kind: string; sport: string; game: number; market: string; severity: "error" | "warn"; recordId?: number; detail: string };
export type TrackingIntegrityReport = { release: typeof TRACKING_INTEGRITY_AUDIT_RELEASE; checkedAt: string; from: string; records: number; publishedActionableLocks: number; errors: number; warnings: number; findings: TrackingIntegrityFinding[]; sports: Record<string, { records: number; bestAngles: number; leans: number; settled: number; pending: number }> };
const gradeKey = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const terminal = (value: string) => ["final", "completed", "status_final", "post", "off", "canceled", "cancelled", "postponed"].includes(value.toLowerCase().replace(/^status[_ -]*/, ""));

/** Exact saved lock expectations only. No reforecast or retrospective grading changes. */
export function compareTrackingLockExpectations(records: PredictionRecordRow[], expectations: TrackingLockExpectation[]): TrackingIntegrityFinding[] {
  const byKey = new Map(records.map(r => [`${r.sport}:${r.external_id}:${r.market}`, r]));
  const findings: TrackingIntegrityFinding[] = [];
  for (const lock of expectations) {
    const row = byKey.get(`${lock.sport}:${lock.externalId}:${lock.market}`);
    const base = { sport: lock.sport, game: lock.externalId, market: lock.market };
    if (!row || !row.locked_at) {
      findings.push({ ...base, kind: "published_lock_missing_tracking", severity: "error", detail: `Saved ${lock.grade} lock has no locked tracking row (${lock.source}).` });
    } else if (lock.exactGrade !== false && effectiveTrackingPlayGrade(row) !== lock.grade) {
      // An explicitly superseding immutable correction is a different public
      // record, not a lost source grade. Older accuracy-only recoveries require
      // owner review; never manufacture recommendations from them here.
      const projection = row as PredictionRecordRow & { supersedes_prediction_record_id?: unknown };
      if (projection.supersedes_prediction_record_id) continue;
      findings.push({ ...base, recordId: row.id, kind: "published_grade_differs", severity: Date.parse(lock.lockedAt) < Date.parse(ROLLOUT) ? "warn" : "error", detail: `Saved ${lock.grade}; tracked ${effectiveTrackingPlayGrade(row)}. Original records preserved for review.` });
    }
  }
  return findings;
}

export function inspectTrackingSettlements(args: { records: PredictionRecordRow[]; games: Map<number, any>; grades: Map<number, PredictionGradeRow>; now: string }): TrackingIntegrityFinding[] {
  const findings: TrackingIntegrityFinding[] = [];
  const now = Date.parse(args.now);
  for (const row of args.records) {
    if (!isTrackingRecordEligible(row)) continue;
    const game = args.games.get(row.game_id), stored = args.grades.get(row.id!);
    const base = { sport: trackingDisplaySport(row), game: row.external_id!, market: row.market, recordId: row.id };
    if (!game) { findings.push({ ...base, kind: "tracking_game_missing", severity: "error", detail: "Locked record has no canonical game." }); continue; }
    const computed = gradeStoredTrackingRecord(row, { ...game, game_date: game.game_date ?? row.game_date });
    if (!stored || stored.result === "pending") {
      if (computed.result !== "pending" || now - Date.parse(row.game_date ?? "") > 8 * 3_600_000) findings.push({ ...base, kind: "locked_result_overdue", severity: "error", detail: `Stored ${stored?.result ?? "missing"}; game ${game.status}; computed ${computed.result}.` });
    } else if (terminal(String(game.status)) && stored.result !== computed.result) {
      findings.push({ ...base, kind: "settled_result_differs", severity: "error", detail: `Stored ${stored.result}; computed ${computed.result}. Review without overwriting history.` });
    } else if (!terminal(String(game.status)) && now - Date.parse(row.game_date ?? "") > 8 * 3_600_000) {
      findings.push({ ...base, kind: "terminal_grade_source_status_regressed", severity: "warn", detail: `Retained ${stored.result}; canonical game status ${game.status}. No pending downgrade allowed.` });
    }
  }
  return findings;
}

/** One recent-window read-only guard, owned by the existing tracking-refresh
 * schedule. Complete ordered pages and narrow JSON projections keep history
 * growth outside each run's working set. Errors abort; empty failed reads are
 * never treated as healthy. Caller persists a concise error in its cron log. */
export async function runTrackingIntegrityAudit(args: { client: SupabaseClient; now?: string; from?: string }): Promise<TrackingIntegrityReport> {
  const checkedAt = args.now ?? new Date().toISOString();
  const from = args.from ?? new Date(Date.parse(checkedAt) - 8 * 86_400_000).toISOString().slice(0, 10);
  const through = new Date(Date.parse(checkedAt) + 86_400_000).toISOString().slice(0, 10);
  const deadline = AbortSignal.timeout(65_000);
  const db = args.client;
  const read = await fetchAllPredictionRecords(db, { from, to: through, signal: deadline });
  if (read.error) throw new Error(`tracking integrity ledger read failed: ${JSON.stringify(read.error)}`);
  const records = dedupePredictionRecordsForTracking(read.rows);
  const games = new Map<number, any>(), grades = new Map<number, PredictionGradeRow>();
  const gameIds = [...new Set(records.map(r => r.game_id))], ids = records.map(r => r.id!);
  for (let i = 0; i < gameIds.length; i += PAGE_SIZE) {
    const r = await db.from("games").select("id,status,game_date,home_score,away_score,first_inning_runs").in("id", gameIds.slice(i, i + PAGE_SIZE)).abortSignal(deadline);
    if (r.error) throw new Error(`tracking integrity game read failed: ${r.error.message}`);
    for (const g of r.data ?? []) games.set(g.id, g);
  }
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const r = await db.from("prediction_grades").select("*").in("prediction_record_id", ids.slice(i, i + PAGE_SIZE)).abortSignal(deadline);
    if (r.error) throw new Error(`tracking integrity grade read failed: ${r.error.message}`);
    for (const g of r.data ?? []) grades.set(g.prediction_record_id, g as PredictionGradeRow);
  }
  const expectations: TrackingLockExpectation[] = [];
  for (const sport of ["nfl", "cfb"]) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const r = await db.from(`${sport}_forward_evidence_snapshots`).select("id,provider_game_id,captured_at,game_start_at,enabled:payload->decisions->>trackingEnabled,published:payload->decisions->>publicationEnabled,bets:payload->decisions->evaluatedBets")
        .eq("stage", "t60").gte("game_start_at", `${from}T00:00:00Z`).lte("game_start_at", new Date(Date.parse(checkedAt) + 3_600_000).toISOString()).order("id").range(offset, offset + PAGE_SIZE - 1).abortSignal(deadline);
      if (r.error) throw new Error(`tracking integrity ${sport} manifest read failed: ${r.error.message}`);
      for (const s of r.data ?? []) {
        if (s.enabled !== "true" || s.published !== "true" || computeSlateDate(sport as "nfl" | "cfb", s.game_start_at) < from) continue;
        for (const bet of (s.bets ?? []) as Array<{ market: string; grade: string }>) {
          const grade = gradeKey(bet.grade); if (!["best_angle", "lean"].includes(grade)) continue;
          expectations.push({ sport, externalId: Number(s.provider_game_id), market: bet.market, grade, lockedAt: s.captured_at, startsAt: s.game_start_at, source: s.id });
        }
      }
      if ((r.data?.length ?? 0) < PAGE_SIZE) break;
    }
  }
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const r = await db.from("lab_response_snapshots").select("snapshot_key,id:payload->snapshot->>gameId,locked:payload->snapshot->>lockedAt,starts:payload->snapshot->>startsAt,rows:payload->snapshot->board->rows")
      .like("snapshot_key", "cbb::member-game::%").gte("slate_date", from).lte("slate_date", through).order("snapshot_key").range(offset, offset + PAGE_SIZE - 1).abortSignal(deadline);
    if (r.error) throw new Error(`tracking integrity CBB manifest read failed: ${r.error.message}`);
    for (const s of r.data ?? []) { if (!s.locked) continue; for (const bet of (s.rows ?? []) as Array<{ market: string; grade: string }>) {
      const grade = gradeKey(bet.grade); if (["best_angle", "lean"].includes(grade)) expectations.push({ sport: "cbb", externalId: Number(s.id), market: bet.market, grade, lockedAt: s.locked, startsAt: s.starts!, source: s.snapshot_key });
    } }
    if ((r.data?.length ?? 0) < PAGE_SIZE) break;
  }
  // NBA and NHL each freeze all three member markets in every lock's
  // capture. One surviving sibling can therefore prove a missing actionable
  // sibling without re-running either model.
  const siblingSources = [...new Map(records.filter(r => ["nba", "nhl"].includes(r.sport) && r.locked_at)
    .map(r => [r.game_id, r])).values()];
  for (let i = 0; i < siblingSources.length; i += PAGE_SIZE) {
    const batch = siblingSources.slice(i, i + PAGE_SIZE), byId = new Map(batch.map(r => [r.id!, r]));
    const r = await db.from("prediction_records").select("id,nba_ml:snapshot_json->nba_daily_edge_game_at_capture->markets->moneyline->verdict->>key,nba_total:snapshot_json->nba_daily_edge_game_at_capture->markets->total->verdict->>key,nba_spread:snapshot_json->nba_daily_edge_game_at_capture->markets->first_inning->verdict->>key,nhl_ml:snapshot_json->model_output->moneyline->>verdict,nhl_total:snapshot_json->model_output->total->>verdict,nhl_spread:snapshot_json->model_output->puck_line->>verdict")
      .in("id", batch.map(r => r.id!)).abortSignal(deadline);
    if (r.error) throw new Error(`tracking integrity sibling manifest read failed: ${r.error.message}`);
    if ((r.data?.length ?? 0) !== batch.length) throw new Error("tracking integrity sibling manifest read incomplete");
    for (const source of r.data ?? []) { const row = byId.get(source.id)!;
      const sourceGrades = row.sport === "nba" ? [source.nba_ml, source.nba_total, source.nba_spread] : [source.nhl_ml, source.nhl_total, source.nhl_spread];
      for (const [index, market] of ["moneyline", "total", "spread"].entries()) {
        const grade = gradeKey(sourceGrades[index]); if (!["best_angle", "lean"].includes(grade)) continue;
        expectations.push({ sport: row.sport, externalId: row.external_id!, market, grade, lockedAt: row.locked_at!, startsAt: row.game_date ?? "", source: `locked_sibling:${row.id}` });
      }
    }
  }
  // Independently locked native predictions catch an entirely absent game,
  // including MLB/WNBA where the public market row is the lock authority.
  // Their final writer may refine a GP grade, so this is presence-only.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const census = await db.from("games").select("id,external_id,sport,game_date").in("sport", ["mlb", "wnba", "nba", "nhl"])
      .gte("game_date", `${from}T00:00:00Z`).lte("game_date", checkedAt).order("id").range(offset, offset + PAGE_SIZE - 1).abortSignal(deadline);
    if (census.error) throw new Error(`tracking integrity fixture census failed: ${census.error.message}`);
    const batch = census.data ?? [];
    if (batch.length) {
      const gp = await db.from("game_predictions").select("id,game_id,locked_at,ml:sport_specific->>ml_play_grade,total:sport_specific->>ou_play_grade,fi:sport_specific->fi_v2_audit->>fi_play_grade,wnba_ml:sport_specific->moneyline->>grade,wnba_total:sport_specific->total->>grade,wnba_spread:sport_specific->spread->>grade")
        .in("game_id", batch.map(g => g.id)).not("locked_at", "is", null).order("id").abortSignal(deadline);
      if (gp.error) throw new Error(`tracking integrity native manifest read failed: ${gp.error.message}`);
      if ((gp.data?.length ?? 0) >= 1_000) throw new Error("tracking integrity native manifest exceeded bounded fixture scope");
      const map = new Map(batch.map(g => [g.id, g]));
      for (const pred of gp.data ?? []) { const g = map.get(pred.game_id)!;
        const markets = g.sport === "wnba" ? { moneyline: pred.wnba_ml, total: pred.wnba_total, spread: pred.wnba_spread }
          : { moneyline: pred.ml, total: pred.total, first_inning: pred.fi };
        for (const [market, raw] of Object.entries(markets)) { const grade = gradeKey(raw); if (!["best_angle", "lean"].includes(grade)) continue;
          expectations.push({ sport: g.sport, externalId: g.external_id, market, grade, lockedAt: pred.locked_at!, startsAt: g.game_date, source: `native_lock:${pred.id}`, exactGrade: false });
        }
      }
    }
    if (batch.length < PAGE_SIZE) break;
  }
  // The active club-soccer caches retain each complete locked member card.
  const soccer = await db.from("lab_response_snapshots").select("snapshot_key,payload").in("snapshot_key", ["soccer::english_premier_league::current-week", "soccer::uefa_champions_league::current-week"]).abortSignal(deadline);
  if (soccer.error) throw new Error(`tracking integrity soccer member read failed: ${soccer.error.message}`);
  for (const s of soccer.data ?? []) {
    const board = s.payload as { games?: Array<{ external_id: number; lockedAt?: string; gameStartAt: string; markets: Record<string, { verdict?: { key?: string } }>; soccerDoubleChanceMarket?: { verdict?: { key?: string } } }> };
    if (!Array.isArray(board.games)) throw new Error("tracking integrity soccer member manifest missing");
    for (const g of board.games) { if (!g.lockedAt || g.gameStartAt < `${from}T00:00:00Z`) continue;
      const clubMarkets = { match_result: g.markets.moneyline, total: g.markets.total,
        btts: g.markets.first_inning, double_chance: g.soccerDoubleChanceMarket };
      const offset = s.snapshot_key.includes("uefa_champions_league") ? 30_000_000 : 20_000_000;
      const externalId = g.external_id < offset ? offset + g.external_id : g.external_id;
      for (const [market, m] of Object.entries(clubMarkets)) { const grade = gradeKey(m?.verdict?.key); if (!["best_angle", "lean"].includes(grade)) continue;
        expectations.push({ sport: "soccer", externalId, market, grade, lockedAt: g.lockedAt, startsAt: g.gameStartAt, source: s.snapshot_key });
      }
    }
  }
  const findings = [...compareTrackingLockExpectations(records, expectations), ...inspectTrackingSettlements({ records, games, grades, now: checkedAt })];
  const sports: TrackingIntegrityReport["sports"] = {};
  for (const name of ["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "cbb", "soccer", "epl", "ucl"]) sports[name] = { records: 0, bestAngles: 0, leans: 0, settled: 0, pending: 0 };
  for (const row of records.filter(isTrackingRecordEligible)) {
    const s = sports[trackingDisplaySport(row)], grade = effectiveTrackingPlayGrade(row);
    s.records++; if (grade === "best_angle") s.bestAngles++; if (grade === "lean") s.leans++;
    if (grades.has(row.id!) && grades.get(row.id!)!.result !== "pending") s.settled++; else s.pending++;
  }
  return { release: TRACKING_INTEGRITY_AUDIT_RELEASE, checkedAt, from, records: records.length, publishedActionableLocks: expectations.length,
    errors: findings.filter(f => f.severity === "error").length, warnings: findings.filter(f => f.severity === "warn").length, findings, sports };
}
