import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_HISTORY_BASE_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_SPREAD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_HOLISTIC_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CONTINUITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_COHERENT_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_WEATHER_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  hashCfbForwardEvidencePayload,
  matchesCfbForwardEvidencePayloadHash,
  type CfbForwardEvidencePayload,
  type CfbForwardMarketHistoryEvidence,
  type CfbForwardStoredEvidence,
} from "./cfbForwardEvidence";

type StoredRow = {
  id: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
  payload_sha256: string;
  payload: unknown;
};

type StoredMetadataRow = {
  id: string;
  evidence_release: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
};

type StoredMarketHistoryRow = {
  id: string;
  evidence_release: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
  payload_sha256: string;
  payload_schema_release: string;
  payload_provider_game_id: string;
  payload_stage: string;
  payload_captured_at: string;
  current: CfbForwardEvidencePayload["market"]["current"];
  current_books: CfbForwardEvidencePayload["market"]["currentBooks"];
  provider_opening: CfbForwardEvidencePayload["market"]["providerOpening"];
  operational_opening: CfbForwardEvidencePayload["market"]["operationalOpening"];
  playbook_splits: CfbForwardEvidencePayload["market"]["playbookSplits"];
  sharp_api_splits: CfbForwardEvidencePayload["market"]["sharpApiSplits"];
};

export type CfbForwardEvidenceMetadata = Pick<CfbForwardStoredEvidence, "providerGameId" | "capturedAt" | "gameStartAt">;

export const CFB_FORWARD_EVIDENCE_PAGE_SIZE = 1_000 as const;
export const CFB_FORWARD_EVIDENCE_MAX_ROWS = 50_000 as const;
export const CFB_FORWARD_WRITER_PAYLOAD_BATCH_SIZE = 100 as const;
export const CFB_FORWARD_MARKET_HISTORY_PAGE_SIZE = 1_000 as const;
export const CFB_FORWARD_MARKET_HISTORY_MAX_ROWS = 12_000 as const;
export const CFB_FORWARD_MARKET_HISTORY_GAME_BATCH_SIZE = 100 as const;
export const CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES = [
  CFB_FORWARD_MARKET_HISTORY_BASE_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_SPREAD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
] as const;

/**
 * Read only the JSON fields required by the member movement panels for the
 * visible board. This preserves the real same-book chronology without
 * returning the large forecast, context, quarterback, and decision payload on
 * every historical row.
 */
export async function readCfbForwardMarketHistory(args: {
  client: SupabaseClient;
  season: number;
  providerGameIds: string[];
}): Promise<CfbForwardMarketHistoryEvidence[]> {
  const providerGameIds = [...new Set(args.providerGameIds)].sort();
  if (providerGameIds.length === 0) return [];
  const rows: StoredMarketHistoryRow[] = [];
  for (let gameIndex = 0; gameIndex < providerGameIds.length; gameIndex += CFB_FORWARD_MARKET_HISTORY_GAME_BATCH_SIZE) {
    const gameIds = providerGameIds.slice(gameIndex, gameIndex + CFB_FORWARD_MARKET_HISTORY_GAME_BATCH_SIZE);
    for (let from = 0; from < CFB_FORWARD_MARKET_HISTORY_MAX_ROWS; from += CFB_FORWARD_MARKET_HISTORY_PAGE_SIZE) {
      const { data, error } = await args.client
        .from("cfb_forward_evidence_snapshots")
        .select([
          "id",
          "evidence_release",
          "provider_game_id",
          "stage",
          "captured_at",
          "game_start_at",
          "payload_sha256",
          "payload_schema_release:payload->>schemaRelease",
          "payload_provider_game_id:payload->game->>providerGameId",
          "payload_stage:payload->>stage",
          "payload_captured_at:payload->>capturedAt",
          "current:payload->market->current",
          "current_books:payload->market->currentBooks",
          "provider_opening:payload->market->providerOpening",
          "operational_opening:payload->market->operationalOpening",
          "playbook_splits:payload->market->playbookSplits",
          "sharp_api_splits:payload->market->sharpApiSplits",
        ].join(","))
        .eq("season", args.season)
        .in("evidence_release", [...CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES])
        .in("provider_game_id", gameIds)
        .order("captured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + CFB_FORWARD_MARKET_HISTORY_PAGE_SIZE - 1);
      if (error) throw new Error(`CFB forward market history read failed: ${error.message}`);
      const page = (data ?? []) as unknown as StoredMarketHistoryRow[];
      if (rows.length + page.length > CFB_FORWARD_MARKET_HISTORY_MAX_ROWS) {
        throw new Error(`CFB forward market history exceeded its bounded ${CFB_FORWARD_MARKET_HISTORY_MAX_ROWS}-row visible-board limit.`);
      }
      rows.push(...page);
      if (page.length < CFB_FORWARD_MARKET_HISTORY_PAGE_SIZE) break;
      if (from + CFB_FORWARD_MARKET_HISTORY_PAGE_SIZE >= CFB_FORWARD_MARKET_HISTORY_MAX_ROWS) {
        throw new Error(`CFB forward market history exceeded its bounded ${CFB_FORWARD_MARKET_HISTORY_MAX_ROWS}-row visible-board limit.`);
      }
    }
  }
  return rows.map(normalizeMarketHistoryRow);
}

/** Load one authoritative current payload per game/stage, one latest payload
 * per game from the immediately previous release for a bounded member-release
 * transition, the last immutable payload published no later than each game's
 * T-60 boundary, and the lightweight season identity/date trail used by the
 * prior-results planner. */
export async function readCfbForwardWriterEvidence(args: {
  client: SupabaseClient;
  season: number;
}): Promise<{ evidence: CfbForwardStoredEvidence[]; metadata: CfbForwardEvidenceMetadata[] }> {
  const metadataRows: StoredMetadataRow[] = [];
  for (let from = 0; from < CFB_FORWARD_EVIDENCE_MAX_ROWS; from += CFB_FORWARD_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await args.client
      .from("cfb_forward_evidence_snapshots")
      .select("id,evidence_release,provider_game_id,stage,captured_at,game_start_at")
      .eq("season", args.season)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CFB_FORWARD_EVIDENCE_PAGE_SIZE - 1);
    if (error) throw new Error(`CFB forward evidence metadata read failed: ${error.message}`);
    const page = (data ?? []) as StoredMetadataRow[];
    metadataRows.push(...page);
    if (page.length < CFB_FORWARD_EVIDENCE_PAGE_SIZE) break;
    if (from + CFB_FORWARD_EVIDENCE_PAGE_SIZE >= CFB_FORWARD_EVIDENCE_MAX_ROWS) {
      throw new Error(`CFB forward evidence metadata read exceeded its bounded ${CFB_FORWARD_EVIDENCE_MAX_ROWS}-row season limit.`);
    }
  }

  const latestCurrentByGameStage = new Map<string, StoredMetadataRow>();
  const latestTransitionPreviousByGame = new Map<string, StoredMetadataRow>();
  const latestPublishedByGameAtCutoff = new Map<string, StoredMetadataRow>();
  for (const row of metadataRows) {
    const currentRelease = row.evidence_release === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE;
    const transitionPreviousRelease = row.evidence_release === CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
    const recoveryRelease = currentRelease ||
      row.evidence_release === CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE ||
      row.evidence_release === CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE ||
      row.evidence_release === CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE;
    if (currentRelease) {
      const key = `${row.provider_game_id}:${row.stage}`;
      const current = latestCurrentByGameStage.get(key);
      if (!current || row.captured_at > current.captured_at || (row.captured_at === current.captured_at && row.id > current.id)) {
        latestCurrentByGameStage.set(key, row);
      }
    }
    if (transitionPreviousRelease) {
      const previous = latestTransitionPreviousByGame.get(row.provider_game_id);
      if (!previous || row.captured_at > previous.captured_at || (row.captured_at === previous.captured_at && row.id > previous.id)) {
        latestTransitionPreviousByGame.set(row.provider_game_id, row);
      }
    }
    if (!recoveryRelease) continue;
    const cutoffAt = Date.parse(row.game_start_at) - 60 * 60_000;
    const capturedAt = Date.parse(row.captured_at);
    if (!Number.isFinite(cutoffAt) || !Number.isFinite(capturedAt) || capturedAt > cutoffAt) continue;
    const published = latestPublishedByGameAtCutoff.get(row.provider_game_id);
    if (!published || row.captured_at > published.captured_at || (row.captured_at === published.captured_at && row.id > published.id)) {
      latestPublishedByGameAtCutoff.set(row.provider_game_id, row);
    }
  }

  const storedRows: StoredRow[] = [];
  const ids = [...new Set([
    ...latestCurrentByGameStage.values(),
    ...latestTransitionPreviousByGame.values(),
    ...latestPublishedByGameAtCutoff.values(),
  ].map((row) => row.id))].sort();
  for (let index = 0; index < ids.length; index += CFB_FORWARD_WRITER_PAYLOAD_BATCH_SIZE) {
    const { data, error } = await args.client
      .from("cfb_forward_evidence_snapshots")
      .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
      .in("evidence_release", [CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE])
      .in("id", ids.slice(index, index + CFB_FORWARD_WRITER_PAYLOAD_BATCH_SIZE));
    if (error) throw new Error(`CFB current writer evidence read failed: ${error.message}`);
    storedRows.push(...((data ?? []) as StoredRow[]));
  }
  if (storedRows.length !== ids.length) {
    throw new Error(`CFB current writer evidence read returned ${storedRows.length} of ${ids.length} latest game rows.`);
  }

  return {
    evidence: storedRows.map(normalizeStoredRow).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id)),
    metadata: metadataRows.map((row) => ({
      providerGameId: row.provider_game_id,
      capturedAt: new Date(row.captured_at).toISOString(),
      gameStartAt: new Date(row.game_start_at).toISOString(),
    })),
  };
}

export async function readCfbForwardEvidence(args: { client: SupabaseClient; season: number }): Promise<CfbForwardStoredEvidence[]> {
  const rows: StoredRow[] = [];
  for (let from = 0; from < CFB_FORWARD_EVIDENCE_MAX_ROWS; from += CFB_FORWARD_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await args.client
      .from("cfb_forward_evidence_snapshots")
      .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
      .in("evidence_release", [CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_WEATHER_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_COHERENT_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CONTINUITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_HOLISTIC_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_SPREAD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE])
      .eq("season", args.season)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CFB_FORWARD_EVIDENCE_PAGE_SIZE - 1);
    if (error) throw new Error(`CFB forward evidence read failed: ${error.message}`);
    const page = (data ?? []) as StoredRow[];
    rows.push(...page);
    if (page.length < CFB_FORWARD_EVIDENCE_PAGE_SIZE) return rows.map(normalizeStoredRow);
  }
  throw new Error(`CFB forward evidence read exceeded its bounded ${CFB_FORWARD_EVIDENCE_MAX_ROWS}-row season limit.`);
}

export async function appendCfbForwardEvidence(args: {
  client: SupabaseClient;
  runId: string;
  payloads: CfbForwardEvidencePayload[];
  apply: boolean;
}): Promise<{ proposed: number; inserted: number; hashes: string[] }> {
  const rows = args.payloads.map((payload) => {
    const payloadSha256 = hashCfbForwardEvidencePayload(payload);
    return {
      evidence_release: payload.schemaRelease,
      collector_release: payload.collectorRelease,
      run_id: args.runId,
      season: payload.season,
      week: payload.week,
      provider_game_id: payload.game.providerGameId,
      away_team: payload.game.away.abbreviation,
      home_team: payload.game.home.abbreviation,
      game_start_at: payload.game.scheduledStart,
      stage: payload.stage,
      captured_at: payload.capturedAt,
      cutoff_at: payload.cutoffAt,
      payload,
      payload_sha256: payloadSha256,
      coverage: payload.coverage,
    };
  });
  const hashes = rows.map((row) => row.payload_sha256);
  if (!args.apply || rows.length === 0) return { proposed: rows.length, inserted: 0, hashes };
  const { data, error } = await args.client.from("cfb_forward_evidence_snapshots").insert(rows).select("id");
  if (error) throw new Error(`CFB forward evidence append failed: ${error.message}`);
  return { proposed: rows.length, inserted: data?.length ?? rows.length, hashes };
}

function normalizeStoredRow(row: StoredRow): CfbForwardStoredEvidence {
  if (row.payload === null || typeof row.payload !== "object") throw new Error(`CFB evidence ${row.id} has no payload.`);
  const payload = row.payload as CfbForwardEvidencePayload;
  if (![CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_WEATHER_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_COHERENT_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_CONTINUITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_HOLISTIC_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_SPREAD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MARKET_HISTORY_PRICE_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_SCORE_COHERENCE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE].includes(payload.schemaRelease as typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE) || payload.game.providerGameId !== row.provider_game_id || payload.stage !== row.stage || payload.capturedAt !== new Date(row.captured_at).toISOString()) {
    throw new Error(`CFB evidence ${row.id} violates the immutable payload contract.`);
  }
  if (!matchesCfbForwardEvidencePayloadHash(payload, row.payload_sha256)) throw new Error(`CFB evidence ${row.id} checksum mismatch.`);
  return { id: row.id, providerGameId: row.provider_game_id, stage: payload.stage, capturedAt: payload.capturedAt, gameStartAt: new Date(row.game_start_at).toISOString(), payloadSha256: row.payload_sha256, payload };
}

function normalizeMarketHistoryRow(row: StoredMarketHistoryRow): CfbForwardMarketHistoryEvidence {
  const capturedAt = new Date(row.captured_at).toISOString();
  const gameStartAt = new Date(row.game_start_at).toISOString();
  if (
    row.evidence_release !== row.payload_schema_release ||
    !CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES.includes(
      row.evidence_release as typeof CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES[number],
    ) ||
    row.payload_provider_game_id !== row.provider_game_id ||
    row.payload_stage !== row.stage ||
    new Date(row.payload_captured_at).toISOString() !== capturedAt ||
    !["opening", "unlocked", "t60"].includes(row.stage) ||
    !Array.isArray(row.current_books)
  ) {
    throw new Error(`CFB market history ${row.id} violates the immutable payload identity contract.`);
  }
  return {
    id: row.id,
    providerGameId: row.provider_game_id,
    stage: row.stage as CfbForwardMarketHistoryEvidence["stage"],
    capturedAt,
    gameStartAt,
    payloadSha256: row.payload_sha256,
    payload: {
      market: {
        current: row.current ?? null,
        currentBooks: row.current_books,
        providerOpening: row.provider_opening ?? null,
        operationalOpening: row.operational_opening ?? null,
        playbookSplits: row.playbook_splits ?? null,
        sharpApiSplits: row.sharp_api_splits ?? null,
      },
    },
  };
}
