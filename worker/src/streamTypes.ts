/**
 * Shared row shapes + the StreamWriter interface for the worker. Mirrors the
 * v24 migration columns. Kept separate so health.ts and pipeline.ts can both
 * depend on it without a cycle. The real Supabase-backed implementation lives
 * in db.ts; tests inject a recording mock.
 */

export type RawEventRow = {
  provider: string;
  provider_event_id: string | null;
  sport: string;
  league: string | null;
  game_id: number | null;
  external_id: number | null;
  sportsbook: string;
  market_type: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  provider_ts: string | null;
  payload_hash: string;
  status: "accepted" | "unresolved" | "blocked_book" | "dropped";
  /** TRUE = alternate/non-main line — kept in raw, excluded from current/movement. */
  is_alternate: boolean;
};

export type CurrentRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  provider_ts: string | null;
};

export type MovementRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string;
  prev_odds_american: number | null;
  next_odds_american: number | null;
  prev_line_value: number | null;
  next_line_value: number | null;
  delta_cents: number | null;
  delta_novig_pp: number | null;
  delta_points: number | null;
  crossed_key_number: boolean;
  direction_vs_pick: "toward" | "against" | "neutral" | null;
};

export type HealthPatch = {
  provider: string;
  sport: string;
  connected?: boolean;
  last_connect_at?: string;
  last_heartbeat_at?: string;
  last_message_at?: string;
  last_global_seq?: number | null;
  messages_total?: number;
  writes_total?: number;
  recompute_calls?: number;
  error_count?: number;
  reconnect_count?: number;
};

export interface StreamWriter {
  writeRawEvents(rows: RawEventRow[]): Promise<void>;
  upsertCurrents(rows: CurrentRow[]): Promise<void>;
  writeMovements(rows: MovementRow[]): Promise<void>;
  upsertHealth(patch: HealthPatch): Promise<void>;
}
