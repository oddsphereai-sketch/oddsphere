/**
 * Supabase-backed StreamWriter + ResolverDb for the worker. Uses the worker's
 * OWN service-role client (does NOT import lib/db/supabase, which throws at
 * import when env is absent). Thin I/O — not unit-tested; the pipeline logic is
 * tested with an injected recording mock.
 */

import { createRequire } from "node:module";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  StreamWriter,
  RawEventRow,
  CurrentRow,
  MovementRow,
  HealthPatch,
} from "./streamTypes";
import type { ResolverDb } from "./gameResolver";

/**
 * Build the worker-owned Supabase client options.
 *
 * Node < 22 (Render runs Node 20) has NO global WebSocket, but supabase-js v2
 * constructs a RealtimeClient at createClient() time which requires one — so on
 * Render the client crashed at boot ("Node.js 20 detected without native
 * WebSocket support"). We pass the already-installed `ws` package as the
 * realtime `transport`. We never use realtime subscriptions; this only
 * satisfies the constructor.
 *
 * Pure + exported so a test can assert the transport is always wired (the
 * regression guard) without constructing a real client.
 */
export function buildWorkerSupabaseOptions<T>(transport: T) {
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  };
}

export function makeSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  // Lazy require (not a top-level import) so db.ts stays importable in
  // environments where `ws` isn't installed (e.g. local disabled-mode boot).
  // `ws` IS installed in the Render Docker image; makeSupabase only runs when
  // the worker is enabled (on Render), so the require always resolves there.
  const req = createRequire(import.meta.url);
  const ws = req("ws");
  return createClient(url, serviceRoleKey, buildWorkerSupabaseOptions(ws));
}

export function makeStreamWriter(supa: SupabaseClient): StreamWriter {
  return {
    async writeRawEvents(rows: RawEventRow[]) {
      if (rows.length === 0) return;
      // Idempotent append — duplicate ticks (same payload_hash) are ignored.
      await supa.from("odds_events_raw").upsert(rows, {
        onConflict: "payload_hash",
        ignoreDuplicates: true,
      });
    },
    async upsertCurrents(rows: CurrentRow[]) {
      if (rows.length === 0) return;
      await supa.from("odds_current_stream").upsert(
        rows.map((r) => ({ ...r, observed_at: new Date().toISOString() })),
        { onConflict: "game_id,market_type,sportsbook,side" },
      );
    },
    async writeMovements(rows: MovementRow[]) {
      if (rows.length === 0) return;
      await supa.from("line_movements").insert(rows);
    },
    async upsertHealth(patch: HealthPatch) {
      await supa.from("stream_health").upsert(
        { ...patch, updated_at: new Date().toISOString() },
        { onConflict: "provider,sport" },
      );
    },
  };
}

export function makeResolverDb(supa: SupabaseClient): ResolverDb {
  return {
    async findGame(internalSport, homeAbbrev, awayAbbrev) {
      const { data: teams } = await supa
        .from("teams")
        .select("id, abbreviation")
        .eq("sport", internalSport)
        .in("abbreviation", [homeAbbrev, awayAbbrev]);
      if (!teams || teams.length < 2) return null;
      const home = teams.find((t: { abbreviation: string }) => t.abbreviation === homeAbbrev);
      const away = teams.find((t: { abbreviation: string }) => t.abbreviation === awayAbbrev);
      if (home === undefined || away === undefined) return null;
      // Near-term scheduled/in-progress game for these teams (include the last
      // 6h so a just-started game still resolves for post-lock CLV capture).
      const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data: game } = await supa
        .from("games")
        .select("id, external_id, game_date")
        .eq("sport", internalSport)
        .eq("home_team_id", home.id)
        .eq("away_team_id", away.id)
        .gte("game_date", since)
        .order("game_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (game as { id: number; external_id: number; game_date: string } | null) ?? null;
    },
  };
}
