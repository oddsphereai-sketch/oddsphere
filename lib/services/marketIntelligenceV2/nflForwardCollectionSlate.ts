import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "@/lib/services/football/nflForwardEvidence";
import type { NflPreviewGame } from "@/lib/services/football/balldontlieNflPreviewSlate";

export type MarketIntelligenceCollectionGame = {
  /** Null when the authoritative football slate has no generic games-table row. */
  id: number | null;
  externalId: number;
  /** Preserved when a proven exact-match bridge maps a generic provider ID to NFL's BDL identity. */
  genericExternalId?: number;
  slateDate: string | null;
  gameDate: string | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeAbbr: string;
  awayAbbr: string;
  homeName: string;
  awayName: string;
};

export type NflCollectionSlateRow = {
  id: string;
  provider_game_id: string;
  captured_at: string;
  game_start_at: string;
  stage: string;
  payload_schema: string;
  payload_captured_at: string;
  payload_stage: string;
  game: NflPreviewGame;
};

const PAGE_ROWS = 1_000;
export type NflForwardSlateReadTelemetry = { dbQueries: number; dbRows: number; dbBytes: number };
const MAX_ROWS = 20_000;

/** Observation-only substrate: reads existing slate identities, never model outputs or prices. */
export async function readNflForwardCollectionSlate(args: {
  client: SupabaseClient; from: string; through: string; availableAt: string;
  canonical?: readonly MarketIntelligenceCollectionGame[];
  telemetry?: NflForwardSlateReadTelemetry;
}): Promise<MarketIntelligenceCollectionGame[]> {
  const rows: NflCollectionSlateRow[] = [];
  const deadline = Date.now() + 10_000;
  const measured = <T>(data: T): T => {
    if (args.telemetry) {
      args.telemetry.dbRows += Array.isArray(data) ? data.length : 0;
      args.telemetry.dbBytes += new TextEncoder().encode(JSON.stringify(data)).byteLength;
    }
    return data;
  };
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_ROWS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("NFL collection slate exceeded its ten-second read budget.");
    if (args.telemetry) args.telemetry.dbQueries++;
    const { data, error } = await args.client.from("nfl_forward_evidence_snapshots")
      .select("id,provider_game_id,captured_at,game_start_at,stage,payload_schema:payload->>schemaRelease,payload_captured_at:payload->>capturedAt,payload_stage:payload->>stage,game:payload->game")
      .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
      .gte("game_start_at", `${args.from}T00:00:00Z`)
      .lt("game_start_at", `${addDaysToSlate(args.through, 2)}T00:00:00Z`)
      .lte("captured_at", args.availableAt)
      .order("captured_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_ROWS - 1).abortSignal(AbortSignal.timeout(remaining));
    if (error) throw new Error(`NFL canonical collection slate read failed: ${error.message}`);
    const page = measured(data ?? []) as unknown as NflCollectionSlateRow[];
    rows.push(...page);
    if (page.length < PAGE_ROWS) {
      // Window rows discover IDs only. Resolve their latest state without a
      // start-date filter, or a cancellation/reschedule can resurrect an old row.
      const ids = [...new Set(rows.map((row) => row.provider_game_id))];
      if (ids.length > 64) throw new Error("NFL collection slate exceeded its 64-event identity bound.");
      const latest: NflCollectionSlateRow[] = [];
      for (let index = 0; index < ids.length; index += 4) {
        const batch = await Promise.all(ids.slice(index, index + 4).map(async (id) => {
          const timeLeft = deadline - Date.now();
          if (timeLeft <= 0) throw new Error("NFL collection latest-state read exceeded its budget.");
          if (args.telemetry) args.telemetry.dbQueries++;
          const read = await args.client.from("nfl_forward_evidence_snapshots")
            .select("id,provider_game_id,captured_at,game_start_at,stage,payload_schema:payload->>schemaRelease,payload_captured_at:payload->>capturedAt,payload_stage:payload->>stage,game:payload->game")
            .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE).eq("provider_game_id", id)
            .lte("captured_at", args.availableAt).order("captured_at", { ascending: false })
            .order("id", { ascending: false }).limit(2).abortSignal(AbortSignal.timeout(timeLeft));
          if (read.error) throw new Error(`NFL collection latest-state read failed: ${read.error.message}`);
          const found = measured(read.data ?? []) as unknown as NflCollectionSlateRow[];
          if (found.length === 0 || found.some((row) => row.provider_game_id !== id)) {
            throw new Error(`NFL collection latest-state identity missing: ${id}.`);
          }
          if (found.length === 2 && Date.parse(found[0]!.captured_at) === Date.parse(found[1]!.captured_at)) {
            throw new Error(`NFL collection latest-state clock is ambiguous: ${id}.`);
          }
          return found[0]!;
        }));
        latest.push(...batch);
      }
      return mergeNflForwardCollectionSlate({ ...args, rows: latest, canonical: args.canonical ?? [] });
    }
  }
  throw new Error(`NFL canonical collection slate exceeded its ${MAX_ROWS}-row bound.`);
}

export function mergeNflForwardCollectionSlate(args: {
  from: string; through: string; availableAt: string;
  rows: readonly NflCollectionSlateRow[]; canonical: readonly MarketIntelligenceCollectionGame[];
}): MarketIntelligenceCollectionGame[] {
  const available = Date.parse(args.availableAt);
  if (!Number.isFinite(available)) throw new Error("NFL collection availability clock is invalid.");
  const byId = new Map(args.canonical.map((game) => [game.externalId, game]));
  const latest = new Map<number, NflCollectionSlateRow>();
  const rows = [...args.rows].sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at) || b.id.localeCompare(a.id));
  for (const row of rows) {
    const game = row.game;
    const captured = Date.parse(row.captured_at);
    const starts = Date.parse(row.game_start_at);
    if (!Number.isFinite(captured) || captured > available) continue;
    if (!game || row.payload_schema !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
        game.providerGameId !== String(row.provider_game_id) ||
        Date.parse(row.payload_captured_at) !== captured || row.payload_stage !== row.stage ||
        !Number.isFinite(starts) || Date.parse(game.scheduledStart) !== starts ||
        !/^\d+$/.test(game.providerGameId) || !Number.isSafeInteger(Number(game.providerGameId)) ||
        !game.home?.name?.trim() || !game.away?.name?.trim() ||
        !game.home.abbreviation?.trim() || !game.away.abbreviation?.trim()) {
      throw new Error(`NFL collection slate has inconsistent immutable identity ${row.id}.`);
    }
    const id = Number(game.providerGameId);
    const previous = latest.get(id);
    if (previous && Date.parse(previous.captured_at) === captured &&
        identity(previous.game) !== identity(game)) throw new Error(`NFL collection slate has conflicting same-time identity ${id}.`);
    if (!previous) latest.set(id, row);
  }
  const claimedForwardIdentities = new Map<string, number>();
  for (const [externalId, row] of latest) {
    const game = row.game;
    const semanticKey = [Date.parse(game.scheduledStart), normalize(game.home.abbreviation), normalize(game.away.abbreviation)].join(":");
    const claimed = claimedForwardIdentities.get(semanticKey);
    if (claimed !== undefined && claimed !== externalId) {
      throw new Error(`NFL collection has multiple forward IDs for one exact game: ${claimed}, ${externalId}.`);
    }
    claimedForwardIdentities.set(semanticKey, externalId);
    const semanticMatches = [...byId.values()].filter((current) =>
      Date.parse(current.gameDate ?? "") === Date.parse(game.scheduledStart) &&
      normalize(current.homeAbbr) === normalize(game.home.abbreviation) &&
      normalize(current.awayAbbr) === normalize(game.away.abbreviation));
    if (semanticMatches.length > 1) throw new Error(`NFL collection slate has ambiguous cross-provider identity ${externalId}.`);
    const current = byId.get(externalId) ?? semanticMatches[0];
    if (current && current.externalId !== externalId && (current.id === null || current.genericExternalId !== undefined)) {
      throw new Error(`NFL collection cannot re-bridge an existing forward identity ${externalId}.`);
    }
    if (!current && [...byId.values()].some((candidate) =>
      normalize(candidate.homeAbbr) === normalize(game.home.abbreviation) &&
      normalize(candidate.awayAbbr) === normalize(game.away.abbreviation))) {
      throw new Error(`NFL cross-provider schedule identity conflict for ${externalId}.`);
    }
    if (current && (Date.parse(current.gameDate ?? "") !== Date.parse(game.scheduledStart) ||
        normalize(current.homeAbbr) !== normalize(game.home.abbreviation) ||
        normalize(current.awayAbbr) !== normalize(game.away.abbreviation))) {
      throw new Error(`NFL generic/forward slate identity conflict for ${externalId}.`);
    }
    const date = computeSlateDate("nfl", game.scheduledStart);
    const status = typeof game.status === "string" ? game.status.trim().toLowerCase() : "";
    if (date < args.from || date > args.through || Date.parse(game.scheduledStart) <= available ||
        (status !== "scheduled" && status !== "pre")) {
      if (current) byId.delete(current.externalId);
      continue;
    }
    if (current && current.externalId !== externalId) {
      byId.delete(current.externalId);
      byId.set(externalId, { ...current, externalId, genericExternalId: current.externalId });
    }
    if (!current) byId.set(externalId, {
      id: null, externalId, slateDate: computeSlateDate("nfl", game.scheduledStart), gameDate: game.scheduledStart,
      homeTeamId: null, awayTeamId: null,
      homeAbbr: game.home.abbreviation, awayAbbr: game.away.abbreviation,
      homeName: game.home.name, awayName: game.away.name,
    });
  }
  return [...byId.values()].sort((a, b) => (a.gameDate ?? "").localeCompare(b.gameDate ?? "") || a.externalId - b.externalId);
}

function normalize(value: string) {
  const clean = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ({ was: "wsh", lar: "la", jac: "jax" } as Record<string, string>)[clean] ?? clean;
}
function identity(game: NflPreviewGame) {
  return [game.providerGameId, game.scheduledStart, normalize(game.home.abbreviation), normalize(game.away.abbreviation)].join(":");
}
