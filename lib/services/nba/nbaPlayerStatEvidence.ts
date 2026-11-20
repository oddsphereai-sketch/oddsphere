import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaPlayerPropsCurrentState } from "./nbaPlayerPropsCurrentState";

export const NBA_PLAYER_STAT_EVIDENCE_RELEASE = "nba_player_stat_evidence_2026_11_20_r1_normalized_observations" as const;
export const NBA_PLAYER_STAT_EVIDENCE_LIMITS = Object.freeze({ games: 128, batch: 48, rawBytesPerGame: 2_000_000,
  gzipBytesPerGame: 256_000, gzipBytesPerRun: 4_000_000, storageMs: 2500, reconcileMs: 1000 });
const RETENTION_MS = 3653 * 86400000;
type Body = { provider: "balldontlie"; sourceKind: "normalized_collector_state_not_raw_http";
  collectorRelease: string; season: number; game: NbaPlayerPropsCurrentState["games"][number];
  boxes: NbaPlayerPropsCurrentState["boxes"]; advanced: NbaPlayerPropsCurrentState["advanced"];
  coverage: ReturnType<typeof coverage> };
export type NbaPlayerStatEvidence = { release: typeof NBA_PLAYER_STAT_EVIDENCE_RELEASE; bodySha256: string;
  gameId: number; season: number; sourceStateUpdatedAt: string; firstRetainedAt: string;
  encoding: "gzip-base64"; rawBytes: number; gzipBytes: number; data: string };
export type NbaPlayerStatEvidenceReceipt = { release: typeof NBA_PLAYER_STAT_EVIDENCE_RELEASE;
  status: "retained" | "not_requested" | "unavailable"; games: number; inserted: number; existing: number;
  gzipBytes: number; observationsInserted?: number; observationsExisting?: number; reconciled?: number; reason?: string };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const time = (s: string) => { const v = Date.parse(s); if (!Number.isFinite(v)) throw Error("invalid_evidence_clock"); return v; };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") { const result = JSON.stringify(value); if (result === undefined || typeof value === "number" && !Number.isFinite(value)) throw Error("invalid_evidence_value"); return result; }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export const nbaPlayerStatEvidenceKey = (gameId: number, sha: string) => `nba::player-stat-evidence::${gameId}::${sha}`;
function coverage(game: Body["game"], boxes: Body["boxes"], advanced: Body["advanced"]) {
  const ambiguousPlayers = [...new Set(boxes.map(row => row.playerId))].filter(id =>
    new Set(boxes.filter(row => row.playerId === id).map(row => row.teamId)).size > 1).sort((a, b) => a - b);
  const rows = [game.homeTeamId, game.awayTeamId].map((teamId, i) => {
    const b = boxes.filter(row => row.teamId === teamId), a = advanced.filter(row => row.teamId === teamId && row.period === 0);
    const positive = b.filter(row => row.minutes > 0), missingAdvanced = positive.filter(row => !a.some(v => v.playerId === row.playerId)).map(row => row.playerId);
    const points = b.reduce((n, row) => n + row.points, 0), final = i === 0 ? game.homeScore : game.awayScore;
    return { teamId, boxRows: b.length, advancedRows: a.length, boxPoints: points, finalPoints: final,
      duplicatePlayer: new Set(b.map(row => row.playerId)).size !== b.length,
      minutes: b.reduce((n, row) => n + row.minutes, 0), missingAdvanced,
      finalPointsMatch: b.length > 0 && points === final };
  });
  return { teams: rows, ambiguousPlayers,
    completeForRotationResearch: ambiguousPlayers.length === 0 && rows.every(row => row.finalPointsMatch && !row.duplicatePlayer && row.missingAdvanced.length === 0),
    minutesPrecision: "normalized_provider_minutes_no_precision_invented" as const };
}

/** A new observation never acquires the older mutable cache's knowledge time. */
export function packNbaPlayerStatEvidence(args: { state: NbaPlayerPropsCurrentState; gameId: number; retainedAt: string }): NbaPlayerStatEvidence {
  const games = args.state.games.filter(g => g.gameId === args.gameId);
  if (games.length !== 1 || !Number.isSafeInteger(args.gameId) || args.gameId <= 0) throw Error("ambiguous_evidence_game");
  const game = games[0]!;
  if (game.season !== args.state.season || time(game.startTime) >= time(args.retainedAt) ||
      time(args.state.updatedAt) > time(args.retainedAt)) throw Error("invalid_evidence_source_chronology");
  const boxes = args.state.boxes.filter(b => b.gameId === args.gameId).sort((a, b) => a.rowId - b.rowId);
  const advanced = args.state.advanced.filter(b => b.gameId === args.gameId).sort((a, b) => a.rowId - b.rowId);
  if (!boxes.length || [boxes, advanced].some(rows => new Set(rows.map(r => r.rowId)).size !== rows.length) ||
      [...boxes, ...advanced].some(b => ![game.homeTeamId, game.awayTeamId].includes(b.teamId) || !Number.isSafeInteger(b.rowId) || b.rowId <= 0 ||
        !Number.isSafeInteger(b.playerId) || b.playerId <= 0)) throw Error("invalid_evidence_player_identity");
  const body: Body = { provider: "balldontlie", sourceKind: "normalized_collector_state_not_raw_http",
    collectorRelease: args.state.release, season: args.state.season, game, boxes, advanced, coverage: coverage(game, boxes, advanced) };
  const raw = Buffer.from(canonical(body));
  if (raw.length > NBA_PLAYER_STAT_EVIDENCE_LIMITS.rawBytesPerGame) throw Error("evidence_raw_limit");
  const gzip = gzipSync(raw);
  if (gzip.length > NBA_PLAYER_STAT_EVIDENCE_LIMITS.gzipBytesPerGame) throw Error("evidence_gzip_limit");
  return { release: NBA_PLAYER_STAT_EVIDENCE_RELEASE, bodySha256: hash(raw), gameId: args.gameId, season: args.state.season,
    sourceStateUpdatedAt: args.state.updatedAt, firstRetainedAt: args.retainedAt, encoding: "gzip-base64",
    rawBytes: raw.length, gzipBytes: gzip.length, data: gzip.toString("base64") };
}

export function decodeNbaPlayerStatEvidence(value: unknown): { evidence: NbaPlayerStatEvidence; body: Body } {
  if (!value || typeof value !== "object") throw Error("invalid_evidence_envelope");
  const e = value as NbaPlayerStatEvidence;
  if (e.release !== NBA_PLAYER_STAT_EVIDENCE_RELEASE || e.encoding !== "gzip-base64" ||
      !Number.isSafeInteger(e.gameId) || e.gameId <= 0 || !Number.isSafeInteger(e.season) || e.season <= 0 ||
      !/^[a-f0-9]{64}$/.test(e.bodySha256) || !Number.isSafeInteger(e.rawBytes) || e.rawBytes < 1 || e.rawBytes > NBA_PLAYER_STAT_EVIDENCE_LIMITS.rawBytesPerGame ||
      !Number.isSafeInteger(e.gzipBytes) || e.gzipBytes < 1 || e.gzipBytes > NBA_PLAYER_STAT_EVIDENCE_LIMITS.gzipBytesPerGame ||
      typeof e.data !== "string" || e.data.length > Math.ceil(NBA_PLAYER_STAT_EVIDENCE_LIMITS.gzipBytesPerGame / 3) * 4 ||
      time(e.sourceStateUpdatedAt) > time(e.firstRetainedAt)) throw Error("invalid_evidence_envelope");
  const compressed = Buffer.from(e.data, "base64");
  if (compressed.length !== e.gzipBytes || compressed.toString("base64") !== e.data) throw Error("invalid_evidence_base64");
  const raw = gunzipSync(compressed, { maxOutputLength: NBA_PLAYER_STAT_EVIDENCE_LIMITS.rawBytesPerGame });
  if (raw.length !== e.rawBytes || hash(raw) !== e.bodySha256) throw Error("evidence_hash_mismatch");
  const body = JSON.parse(raw.toString("utf8")) as Body;
  if (!Buffer.from(canonical(body)).equals(raw) || body.provider !== "balldontlie" || body.sourceKind !== "normalized_collector_state_not_raw_http" ||
      body.game.gameId !== e.gameId || body.season !== e.season || body.game.season !== e.season ||
      !Array.isArray(body.boxes) || !body.boxes.length || !Array.isArray(body.advanced) || time(body.game.startTime) >= time(e.firstRetainedAt) ||
      [body.boxes, body.advanced].some(rows => new Set(rows.map(r => r.rowId)).size !== rows.length) ||
      [...body.boxes, ...body.advanced].some(row => row.gameId !== e.gameId || ![body.game.homeTeamId, body.game.awayTeamId].includes(row.teamId) ||
        !Number.isSafeInteger(row.rowId) || row.rowId <= 0 || !Number.isSafeInteger(row.playerId) || row.playerId <= 0) ||
      canonical(body.coverage) !== canonical(coverage(body.game, body.boxes, body.advanced))) throw Error("invalid_evidence_binding");
  return { evidence: e, body };
}

/** Pure point-in-time admission. A later observation cannot populate an older forecast. */
export function nbaPlayerStatEvidenceAtCutoff(value: unknown, cutoff: string, targetGameId: number): Body | null {
  const { evidence, body } = decodeNbaPlayerStatEvidence(value);
  return body.coverage.completeForRotationResearch && body.game.gameId !== targetGameId && time(evidence.firstRetainedAt) <= time(cutoff) && time(body.game.startTime) < time(cutoff) ? body : null;
}

export type NbaPlayerStatObservation = { release: typeof NBA_PLAYER_STAT_EVIDENCE_RELEASE; kind: "nba_player_stat_observation_v1";
  gameId: number; season: number; bodyKey: string; bodySha256: string; sourceStateUpdatedAt: string; firstRetainedAt: string };
export const nbaPlayerStatObservationKey = (o: NbaPlayerStatObservation) => `nba::stat-seen::${o.gameId}::${time(o.sourceStateUpdatedAt)}::${o.bodySha256}`;
export function decodeNbaPlayerStatObservation(value: unknown): NbaPlayerStatObservation {
  if (!value || typeof value !== "object") throw Error("invalid_stat_observation");
  const o = value as NbaPlayerStatObservation;
  if (o.release !== NBA_PLAYER_STAT_EVIDENCE_RELEASE || o.kind !== "nba_player_stat_observation_v1" ||
      !Number.isSafeInteger(o.gameId) || o.gameId <= 0 || !Number.isSafeInteger(o.season) || o.season <= 0 ||
      !/^[a-f0-9]{64}$/.test(o.bodySha256) || o.bodyKey !== nbaPlayerStatEvidenceKey(o.gameId, o.bodySha256) ||
      time(o.sourceStateUpdatedAt) > time(o.firstRetainedAt)) throw Error("invalid_stat_observation");
  return o;
}
/** The latest known observation selects a version, including a reversion to an
 * older body. A body alone never establishes which version was current. */
export function selectNbaPlayerStatEvidenceAtCutoff(args: { gameId: number; targetGameId: number; cutoff: string;
  observations: readonly unknown[]; bodies: ReadonlyMap<string, unknown> }): Body | null {
  if (args.gameId === args.targetGameId) return null;
  try {
    const cutoff = time(args.cutoff), eligible: NbaPlayerStatObservation[] = [];
    for (const value of args.observations) {
      const clock = value as Partial<NbaPlayerStatObservation> | null;
      if (clock?.gameId !== args.gameId) continue;
      if (time(clock.firstRetainedAt ?? "") > cutoff) continue;
      const o = decodeNbaPlayerStatObservation(value); if (time(o.sourceStateUpdatedAt) <= cutoff) eligible.push(o);
    }
    if (!eligible.length) return null;
    const latestAt = Math.max(...eligible.map(o => time(o.sourceStateUpdatedAt)));
    const latest = eligible.filter(o => time(o.sourceStateUpdatedAt) === latestAt);
    if (new Set(latest.map(o => o.bodyKey)).size !== 1) return null;
    const o = latest[0]!, value = args.bodies.get(o.bodyKey);
    if (value === undefined) return null;
    const decoded = decodeNbaPlayerStatEvidence(value);
    if (decoded.evidence.gameId !== args.gameId || decoded.evidence.season !== o.season ||
        decoded.evidence.bodySha256 !== o.bodySha256 || time(decoded.evidence.firstRetainedAt) > time(o.firstRetainedAt)) return null;
    return nbaPlayerStatEvidenceAtCutoff(value, args.cutoff, args.targetGameId);
  } catch { return null; }
}

/** Existing full-refresh writer only. Storage trouble never invalidates the collected numerical state. */
export async function retainNbaPlayerStatEvidence(args: { client: SupabaseClient; writerRunId?: string;
  state: NbaPlayerPropsCurrentState; gameIds: readonly number[]; deadlineMs?: number; now?: () => string }): Promise<NbaPlayerStatEvidenceReceipt> {
  const receipt: NbaPlayerStatEvidenceReceipt = { release: NBA_PLAYER_STAT_EVIDENCE_RELEASE, status: "not_requested", games: args.gameIds.length,
    inserted: 0, existing: 0, observationsInserted: 0, observationsExisting: 0, gzipBytes: 0 };
  if (!args.gameIds.length) return receipt;
  const clock = args.now ?? (() => new Date().toISOString());
  try {
    if (!args.writerRunId) throw Error("missing_existing_nba_writer_lease");
    if (args.deadlineMs !== undefined && (!Number.isFinite(args.deadlineMs) ||
        args.deadlineMs - Date.now() < NBA_PLAYER_STAT_EVIDENCE_LIMITS.storageMs + NBA_PLAYER_STAT_EVIDENCE_LIMITS.reconcileMs)) throw Error("forecast_source_window_reserved");
    if (args.gameIds.length > NBA_PLAYER_STAT_EVIDENCE_LIMITS.games || new Set(args.gameIds).size !== args.gameIds.length) throw Error("evidence_game_limit_or_duplicate");
    const at = clock(), started = performance.now(), signal = AbortSignal.timeout(NBA_PLAYER_STAT_EVIDENCE_LIMITS.storageMs);
    type Entity = { key: string; payload: NbaPlayerStatEvidence | NbaPlayerStatObservation; body: boolean };
    const prepared: Entity[] = [];
    for (const gameId of args.gameIds) {
      if (performance.now() - started >= NBA_PLAYER_STAT_EVIDENCE_LIMITS.storageMs) throw Error("evidence_storage_deadline");
      const e = packNbaPlayerStatEvidence({ state: args.state, gameId, retainedAt: at });
      receipt.gzipBytes += e.gzipBytes;
      if (receipt.gzipBytes > NBA_PLAYER_STAT_EVIDENCE_LIMITS.gzipBytesPerRun) throw Error("evidence_run_bytes_limit");
      const observation: NbaPlayerStatObservation = { release: NBA_PLAYER_STAT_EVIDENCE_RELEASE, kind: "nba_player_stat_observation_v1",
        gameId, season: e.season, bodyKey: nbaPlayerStatEvidenceKey(gameId, e.bodySha256), bodySha256: e.bodySha256,
        sourceStateUpdatedAt: args.state.updatedAt, firstRetainedAt: at };
      prepared.push({ key: observation.bodyKey, payload: e, body: true }, { key: nbaPlayerStatObservationKey(observation), payload: observation, body: false });
    }
    const inventory = async (items: readonly Entity[], readSignal: AbortSignal) => {
      const found = new Map<string, unknown>();
      for (let i = 0; i < items.length; i += NBA_PLAYER_STAT_EVIDENCE_LIMITS.batch) {
        const keys = items.slice(i, i + NBA_PLAYER_STAT_EVIDENCE_LIMITS.batch).map(e => e.key);
        const read = await args.client.from("lab_response_snapshots").select("snapshot_key,payload").in("snapshot_key", keys).abortSignal(readSignal);
        if (read.error || !Array.isArray(read.data)) throw Error("evidence_inventory_unavailable");
        for (const r of read.data) { if (!keys.includes(r.snapshot_key) || found.has(r.snapshot_key)) throw Error("ambiguous_evidence_inventory"); found.set(r.snapshot_key, r.payload); }
      }
      return found;
    };
    const existing = await inventory(prepared, signal);
    const verify = (expected: Entity, original: unknown) => {
      if (expected.body) {
        const old = decodeNbaPlayerStatEvidence(original), current = decodeNbaPlayerStatEvidence(expected.payload);
        if (old.evidence.bodySha256 !== current.evidence.bodySha256 || canonical(old.body) !== canonical(current.body) ||
            time(old.evidence.firstRetainedAt) > time(clock())) throw Error("existing_evidence_conflict");
      } else {
        const old = decodeNbaPlayerStatObservation(original), current = decodeNbaPlayerStatObservation(expected.payload);
        if (canonical({ ...old, firstRetainedAt: current.firstRetainedAt }) !== canonical(current) || time(old.firstRetainedAt) > time(clock())) throw Error("existing_observation_conflict");
      }
    };
    const pending = prepared.filter(e => { const old = existing.get(e.key); if (old === undefined) return true; verify(e, old);
      if (e.body) receipt.existing++; else receipt.observationsExisting!++; return false; });
    if (!pending.length) return { ...receipt, status: "retained" };
    const beforeInsert = clock();
    const lease = await args.client.from("cron_job_leases").select("run_id,acquired_at,lease_expires_at")
      .eq("job_name", "prediction_pipeline:nba").eq("run_id", args.writerRunId).gt("lease_expires_at", beforeInsert).abortSignal(signal).maybeSingle();
    if (lease.error || !lease.data || lease.data.run_id !== args.writerRunId || time(lease.data.acquired_at) > time(beforeInsert) ||
        time(lease.data.lease_expires_at) - time(beforeInsert) < NBA_PLAYER_STAT_EVIDENCE_LIMITS.storageMs + NBA_PLAYER_STAT_EVIDENCE_LIMITS.reconcileMs) throw Error("nba_writer_lease_unavailable");
    const gameById = new Map(args.state.games.map(g => [g.gameId, g]));
    const rows = pending.map(e => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(gameById.get(e.payload.gameId)!.startTime));
      const day = ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("evidence_slate_date_unavailable");
      const expires = new Date(time(e.payload.firstRetainedAt) + RETENTION_MS).toISOString();
      return { snapshot_key: e.key, kind: "daily_edge", sport: "nba", slate_date: day, payload: e.payload,
        payload_version: NBA_PLAYER_STAT_EVIDENCE_RELEASE, source: NBA_PLAYER_STAT_EVIDENCE_RELEASE,
        generated_at: e.payload.firstRetainedAt, updated_at: e.payload.firstRetainedAt, expires_at: expires, stale_until: expires };
    });
    const insert = await args.client.from("lab_response_snapshots").insert(rows).abortSignal(signal);
    if (insert.error) {
      const remaining = Math.min(NBA_PLAYER_STAT_EVIDENCE_LIMITS.storageMs + NBA_PLAYER_STAT_EVIDENCE_LIMITS.reconcileMs - (performance.now() - started),
        args.deadlineMs === undefined ? Infinity : args.deadlineMs - Date.now());
      if (remaining < 1) throw Error("evidence_reconciliation_deadline");
      const acknowledged = await inventory(pending, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(NBA_PLAYER_STAT_EVIDENCE_LIMITS.reconcileMs, remaining)))));
      for (const e of pending) { const old = acknowledged.get(e.key); if (old === undefined) throw Error("evidence_insert_unconfirmed"); verify(e, old); }
      return { ...receipt, status: "retained", reconciled: pending.length };
    }
    return { ...receipt, status: "retained", inserted: pending.filter(e => e.body).length, observationsInserted: pending.filter(e => !e.body).length };
  } catch (error) {
    return { ...receipt, status: "unavailable", reason: error instanceof Error ? error.message : "evidence_storage_unavailable" };
  }
}
