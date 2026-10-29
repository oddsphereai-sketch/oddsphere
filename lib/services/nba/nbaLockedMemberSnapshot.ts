import type { NbaDailyEdgeGameDto } from "./buildNbaDailyEdgeDto";
import type { DailyEdgeGameDto, MarketEdgeDto } from "../../../app/lab/lib/labTypes";
import { computeLocksAt } from "../../automodel/lockState";
import type { NbaMovementMarket } from "./nbaSameBookMovement";

export const NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE =
  "nba_locked_member_snapshot_2026_10_29_r7_consumer_trail_coherence" as const;

export const NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE =
  "nba_legacy_locked_evidence_recovery_2026_10_20_r1_bos_det" as const;

const APPROVED_LEGACY_RECOVERY = {
  externalId: 401909088,
  matchup: "BOS @ DET",
  lockedAt: "2026-10-20T18:00:59.937Z",
} as const;

export type NbaLockedMemberRecord = {
  game_id: number;
  market: string;
  locked_at: string | null;
  snapshot_json: unknown;
};

export type NbaApprovedLegacyLockedEvidenceRecovery = {
  release: typeof NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE;
  lockedAt: string;
  capturedAt: string;
  publicSplits: Record<NbaMovementMarket, MarketEdgeDto["publicSplits"]>;
};

type LegacyPublicSplits = {
  picked_side?: unknown;
  picked_handle_pct?: unknown;
  picked_bets_pct?: unknown;
  opp_handle_pct?: unknown;
  opp_bets_pct?: unknown;
};

function pctTo100(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return normalized >= 0 && normalized <= 100 ? Math.round(normalized * 10) / 10 : null;
}

function oppositeSide(side: "home" | "away" | "over" | "under") {
  if (side === "home") return "away" as const;
  if (side === "away") return "home" as const;
  return side === "over" ? "under" as const : "over" as const;
}

function labelForSide(
  side: "home" | "away" | "over" | "under",
  game: NbaDailyEdgeGameDto,
): string {
  if (side === "home") return game.home_abbr;
  if (side === "away") return game.away_abbr;
  return side === "over" ? "Over" : "Under";
}

function normalizedIso(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Owner-approved, read-only recovery for the single Boston-Detroit legacy
 * lock that predates complete-card capture. It reads only fields already
 * stored in the three immutable lock rows. Every other legacy lock remains
 * outside this exception and receives no reconstruction.
 */
export function resolveApprovedNbaLegacyLockedEvidenceRecovery(args: {
  game: NbaDailyEdgeGameDto;
  gameId: number;
  rows: readonly NbaLockedMemberRecord[];
}): NbaApprovedLegacyLockedEvidenceRecovery | null {
  if (
    args.game.game_external_id !== APPROVED_LEGACY_RECOVERY.externalId ||
    args.game.matchup !== APPROVED_LEGACY_RECOVERY.matchup
  ) return null;

  const rows = args.rows.filter((row) => row.game_id === args.gameId && row.locked_at !== null);
  const markets = new Set(rows.map((row) => row.market));
  const lockedAtValues = new Set(rows.map((row) => normalizedIso(row.locked_at!)));
  if (
    rows.length !== 3 || markets.size !== 3 ||
    !["moneyline", "spread", "total"].every((market) => markets.has(market)) ||
    lockedAtValues.size !== 1 ||
    !lockedAtValues.has(APPROVED_LEGACY_RECOVERY.lockedAt)
  ) {
    throw new Error("Approved NBA legacy evidence recovery requires the exact immutable BOS-DET lock tuple");
  }

  const capturedAtValues = new Set<string>();
  const publicSplits = {} as Record<NbaMovementMarket, MarketEdgeDto["publicSplits"]>;
  for (const row of rows) {
    if (row.snapshot_json === null || typeof row.snapshot_json !== "object") {
      throw new Error(`Approved NBA legacy evidence recovery is missing ${row.market} snapshot_json`);
    }
    const snapshot = row.snapshot_json as {
      as_of?: unknown;
      splits_state?: unknown;
      public_splits?: LegacyPublicSplits | null;
      nba_daily_edge_game_at_capture?: unknown;
    };
    if (snapshot.nba_daily_edge_game_at_capture !== undefined) {
      return null;
    }
    if (typeof snapshot.as_of !== "string" || normalizedIso(snapshot.as_of) === null) {
      throw new Error(`Approved NBA legacy evidence recovery has no valid ${row.market} capture timestamp`);
    }
    const capturedAt = normalizedIso(snapshot.as_of)!;
    if (Date.parse(capturedAt) > Date.parse(APPROVED_LEGACY_RECOVERY.lockedAt)) {
      throw new Error(`Approved NBA legacy evidence recovery rejects post-lock ${row.market} evidence`);
    }
    capturedAtValues.add(capturedAt);
    if (snapshot.splits_state !== "available" || snapshot.public_splits === null || snapshot.public_splits === undefined) {
      throw new Error(`Approved NBA legacy evidence recovery is missing stored ${row.market} public splits`);
    }

    const market = row.market as NbaMovementMarket;
    const expectedSides = market === "total" ? ["over", "under"] as const : ["home", "away"] as const;
    const pickedSide = snapshot.public_splits.picked_side;
    if (typeof pickedSide !== "string" || !expectedSides.includes(pickedSide as never)) {
      throw new Error(`Approved NBA legacy evidence recovery has an invalid ${row.market} picked side`);
    }
    const picked = pickedSide as "home" | "away" | "over" | "under";
    const opposing = oppositeSide(picked);
    const pickedMoney = pctTo100(snapshot.public_splits.picked_handle_pct);
    const pickedBets = pctTo100(snapshot.public_splits.picked_bets_pct);
    const opposingMoney = pctTo100(snapshot.public_splits.opp_handle_pct);
    const opposingBets = pctTo100(snapshot.public_splits.opp_bets_pct);
    if ([pickedMoney, pickedBets, opposingMoney, opposingBets].some((value) => value === null)) {
      throw new Error(`Approved NBA legacy evidence recovery has incomplete ${row.market} public splits`);
    }
    if (Math.abs(pickedMoney! + opposingMoney! - 100) > 1.1 || Math.abs(pickedBets! + opposingBets! - 100) > 1.1) {
      throw new Error(`Approved NBA legacy evidence recovery rejects incoherent ${row.market} public splits`);
    }
    publicSplits[market] = [
      {
        side: picked,
        label: labelForSide(picked, args.game),
        moneyPct: pickedMoney,
        betsPct: pickedBets,
        observedAt: capturedAt,
        freshnessCheckedAt: capturedAt,
        isStale: false,
      },
      {
        side: opposing,
        label: labelForSide(opposing, args.game),
        moneyPct: opposingMoney,
        betsPct: opposingBets,
        observedAt: capturedAt,
        freshnessCheckedAt: capturedAt,
        isStale: false,
      },
    ];
  }
  if (capturedAtValues.size !== 1) {
    throw new Error("Approved NBA legacy evidence recovery requires one shared capture timestamp");
  }
  return {
    release: NBA_APPROVED_LEGACY_LOCKED_EVIDENCE_RECOVERY_RELEASE,
    lockedAt: APPROVED_LEGACY_RECOVERY.lockedAt,
    capturedAt: [...capturedAtValues][0]!,
    publicSplits,
  };
}

function readStoredGameDto(value: unknown): NbaDailyEdgeGameDto | null {
  if (value === null || typeof value !== "object") return null;
  const stored = (value as { nba_game_dto_at_capture?: unknown }).nba_game_dto_at_capture;
  if (stored === null || typeof stored !== "object") return null;
  const candidate = stored as Partial<NbaDailyEdgeGameDto>;
  if (
    typeof candidate.game_external_id !== "number" ||
    typeof candidate.matchup !== "string" ||
    candidate.projection === null || typeof candidate.projection !== "object" ||
    candidate.intelligence === null || typeof candidate.intelligence !== "object"
  ) return null;
  return stored as NbaDailyEdgeGameDto;
}

function readStoredMemberGame(value: unknown): DailyEdgeGameDto | null {
  if (value === null || typeof value !== "object") return null;
  const stored = (value as { nba_daily_edge_game_at_capture?: unknown })
    .nba_daily_edge_game_at_capture;
  if (stored === null || typeof stored !== "object") return null;
  const candidate = stored as Partial<DailyEdgeGameDto>;
  if (
    typeof candidate.external_id !== "number" ||
    typeof candidate.id !== "string" ||
    candidate.markets === null || typeof candidate.markets !== "object" ||
    candidate.predictions === null || typeof candidate.predictions !== "object"
  ) return null;
  return stored as DailyEdgeGameDto;
}

export function buildNbaLockedMemberCapture(args: {
  gameDto: NbaDailyEdgeGameDto;
  memberGame: DailyEdgeGameDto;
}): Record<string, unknown> {
  if (args.memberGame.external_id !== args.gameDto.game_external_id) {
    throw new Error("NBA locked member capture identity mismatch");
  }
  return {
    nba_locked_member_snapshot_release: NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE,
    nba_game_dto_at_capture: args.gameDto,
    nba_daily_edge_game_at_capture: args.memberGame,
  };
}

/**
 * Replace dynamic games with the exact DTO captured by an immutable lock.
 * Multiple official-market rows must carry byte-identical payloads. Missing
 * legacy payloads are not reconstructed here; their stored fields remain
 * untouched and the historical response-snapshot reader keeps precedence.
 */
export function applyNbaLockedMemberSnapshotPrecedence(args: {
  games: readonly NbaDailyEdgeGameDto[];
  dbIdByExternalId: ReadonlyMap<number, number>;
  rows: readonly NbaLockedMemberRecord[];
}): {
  games: NbaDailyEdgeGameDto[];
  memberGamesByExternalId: Map<number, DailyEdgeGameDto>;
} {
  const rowsByGame = new Map<number, NbaLockedMemberRecord[]>();
  for (const row of args.rows) {
    if (row.locked_at === null) continue;
    rowsByGame.set(row.game_id, [...(rowsByGame.get(row.game_id) ?? []), row]);
  }
  const memberGamesByExternalId = new Map<number, DailyEdgeGameDto>();
  const games = args.games.map((game) => {
    const dbId = args.dbIdByExternalId.get(game.game_external_id);
    if (dbId === undefined) return game;
    const lockedRows = rowsByGame.get(dbId) ?? [];
    const stored = lockedRows
      .map((row) => readStoredGameDto(row.snapshot_json))
      .filter((row): row is NbaDailyEdgeGameDto => row !== null);
    if (stored.length === 0) return game;
    const markets = new Set(lockedRows.map((row) => row.market));
    if (
      lockedRows.length !== 3 || stored.length !== 3 ||
      !["moneyline", "spread", "total"].every((market) => markets.has(market))
    ) {
      throw new Error(`NBA locked member DTO is incomplete for game_id=${dbId}`);
    }
    const identity = JSON.stringify(stored[0]);
    const lockTimestamps = new Set(lockedRows.map((row) => row.locked_at));
    if (
      stored.some((row) => row.game_external_id !== game.game_external_id || JSON.stringify(row) !== identity) ||
      lockTimestamps.size !== 1
    ) {
      throw new Error(`NBA locked member DTO mismatch for game_id=${dbId}`);
    }

    const storedMemberGames = lockedRows
      .map((row) => readStoredMemberGame(row.snapshot_json))
      .filter((row): row is DailyEdgeGameDto => row !== null);
    if (storedMemberGames.length > 0) {
      if (storedMemberGames.length !== 3) {
        throw new Error(`NBA locked member card is incomplete for game_id=${dbId}`);
      }
      const memberIdentity = JSON.stringify(storedMemberGames[0]);
      if (
        storedMemberGames.some((row) =>
          row.external_id !== game.game_external_id || JSON.stringify(row) !== memberIdentity
        )
      ) {
        throw new Error(`NBA locked member card mismatch for game_id=${dbId}`);
      }
      const lockedAt = lockedRows[0]!.locked_at!;
      const captured = storedMemberGames[0]!;
      memberGamesByExternalId.set(game.game_external_id, {
        ...captured,
        scheduledLockAt: computeLocksAt(captured.gameStartAt) ?? captured.scheduledLockAt,
        lockState: "locked",
        lockedAt,
      });
    }
    // Preserve the exact captured DTO and overlay only the authoritative
    // column-owned lifecycle timestamp for the response adapter. The stored
    // snapshot_json remains byte-for-byte immutable.
    return { ...stored[0]!, locked_at: lockedRows[0]!.locked_at };
  });
  return { games, memberGamesByExternalId };
}
