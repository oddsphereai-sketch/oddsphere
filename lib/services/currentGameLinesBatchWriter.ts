import type { SupabaseClient } from "@supabase/supabase-js";

export const CURRENT_LINES_PRIOR_PAGE_SIZE = 1_000;
export const CURRENT_LINES_MAX_PRIOR_ROWS = 10_000;
export const CURRENT_LINES_MAX_INCOMING_ROWS = 10_000;
export const CURRENT_LINES_MAX_INCOMING_GROUPS = 2_000;
export const CURRENT_LINES_INSERT_CHUNK_ROWS = 200;
export const CURRENT_LINES_DELETE_CHUNK_IDS = 500;

type LineRow = Record<string, unknown>;
type PriorLineRow = {
  id: number | string;
  game_id: number;
  market_type: string;
  sportsbook: string;
  player_id: null;
};

type LineGroup = {
  key: string;
  gameId: number;
  marketType: string;
  sportsbook: string;
  rows: LineRow[];
};

type PriorGroup = LineGroup & { priorIds: Array<number | string> };

export type CurrentLinesBatchOptions = {
  priorPageSize?: number;
  maxPriorRows?: number;
  maxIncomingRows?: number;
  maxIncomingGroups?: number;
  insertChunkRows?: number;
  deleteChunkIds?: number;
};

export type CurrentLinesReplaceResult = {
  attemptedRows: number;
  attemptedGroups: number;
  insertedRows: number;
  insertedGroups: number;
  failedRows: number;
  failedGroups: number;
  cleanupFailedGroups: number;
  firstError: string | null;
  failedSample: Array<Record<string, unknown>>;
  priorRowsRead: number;
  priorReadQueries: number;
  insertQueries: number;
  insertFallbackQueries: number;
  deleteQueries: number;
  deleteFallbackQueries: number;
  recoveredInsertChunks: number;
  recoveredDeleteChunks: number;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function groupKey(gameId: number, marketType: string, sportsbook: string): string {
  return `${gameId}::${marketType}::${sportsbook}`;
}

function groupIdentity(group: LineGroup): Record<string, unknown> {
  return {
    game_id: group.gameId,
    market_type: group.marketType,
    sportsbook: group.sportsbook,
  };
}

export function groupCurrentGameLineRows(rows: ReadonlyArray<LineRow>): LineGroup[] {
  const groups = new Map<string, LineGroup>();
  for (const row of rows) {
    const gameId = row.game_id;
    const marketType = row.market_type;
    const sportsbook = row.sportsbook;
    if (
      typeof gameId !== "number" ||
      typeof marketType !== "string" ||
      typeof sportsbook !== "string"
    ) {
      continue;
    }
    const key = groupKey(gameId, marketType, sportsbook);
    const group = groups.get(key) ?? {
      key,
      gameId,
      marketType,
      sportsbook,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Chunk complete groups without ever dividing one game/market/book generation.
 * An individually oversized group occupies one chunk by itself.
 */
export function chunkCompleteLineGroups<T extends { rows: ReadonlyArray<unknown> }>(
  groups: ReadonlyArray<T>,
  maxRows: number,
): T[][] {
  const limit = Math.max(1, Math.floor(maxRows));
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentRows = 0;
  for (const group of groups) {
    const groupRows = group.rows.length;
    if (current.length > 0 && currentRows + groupRows > limit) {
      chunks.push(current);
      current = [];
      currentRows = 0;
    }
    current.push(group);
    currentRows += groupRows;
    if (currentRows >= limit) {
      chunks.push(current);
      current = [];
      currentRows = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function chunkPriorGroups(groups: ReadonlyArray<PriorGroup>, maxIds: number): PriorGroup[][] {
  const limit = Math.max(1, Math.floor(maxIds));
  const chunks: PriorGroup[][] = [];
  let current: PriorGroup[] = [];
  let currentIds = 0;
  for (const group of groups) {
    if (group.priorIds.length === 0) continue;
    if (current.length > 0 && currentIds + group.priorIds.length > limit) {
      chunks.push(current);
      current = [];
      currentIds = 0;
    }
    current.push(group);
    currentIds += group.priorIds.length;
    if (currentIds >= limit) {
      chunks.push(current);
      current = [];
      currentIds = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function emptyResult(rows: number, groups: number): CurrentLinesReplaceResult {
  return {
    attemptedRows: rows,
    attemptedGroups: groups,
    insertedRows: 0,
    insertedGroups: 0,
    failedRows: 0,
    failedGroups: 0,
    cleanupFailedGroups: 0,
    firstError: null,
    failedSample: [],
    priorRowsRead: 0,
    priorReadQueries: 0,
    insertQueries: 0,
    insertFallbackQueries: 0,
    deleteQueries: 0,
    deleteFallbackQueries: 0,
    recoveredInsertChunks: 0,
    recoveredDeleteChunks: 0,
  };
}

function recordFailure(
  result: CurrentLinesReplaceResult,
  group: LineGroup,
  message: string,
  failedRows: boolean,
  cleanupFailure = false,
): void {
  result.failedGroups += 1;
  if (failedRows) result.failedRows += group.rows.length;
  if (cleanupFailure) result.cleanupFailedGroups += 1;
  result.firstError ??= message;
  if (result.failedSample.length < 5) result.failedSample.push(groupIdentity(group));
}

function markAllFailed(
  result: CurrentLinesReplaceResult,
  groups: ReadonlyArray<LineGroup>,
  message: string,
): CurrentLinesReplaceResult {
  result.firstError = message;
  result.failedRows = result.attemptedRows;
  result.failedGroups = groups.length;
  result.failedSample = groups.slice(0, 5).map(groupIdentity);
  return result;
}

async function readPriorRows(
  client: SupabaseClient,
  groups: ReadonlyArray<LineGroup>,
  result: CurrentLinesReplaceResult,
  pageSize: number,
  maxPriorRows: number,
): Promise<{ rows: PriorLineRow[]; error: string | null }> {
  const gameIds = [...new Set(groups.map((group) => group.gameId))].sort((a, b) => a - b);
  const markets = [...new Set(groups.map((group) => group.marketType))].sort();
  const books = [...new Set(groups.map((group) => group.sportsbook))].sort();
  const acceptedKeys = new Set(groups.map((group) => group.key));
  const acceptedRows: PriorLineRow[] = [];
  const seenIds = new Set<string>();
  let expectedRows: number | null = null;

  for (let from = 0; expectedRows === null || from < expectedRows; from += pageSize) {
    const to = from + pageSize - 1;
    result.priorReadQueries += 1;
    const query = await client
      .from("lines")
      .select("id,game_id,market_type,sportsbook,player_id", { count: "exact" })
      .in("game_id", gameIds)
      .in("market_type", markets)
      .in("sportsbook", books)
      .is("player_id", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (query.error) {
      return { rows: [], error: `current lines batch prior-row read failed: ${query.error.message}` };
    }
    if (typeof query.count !== "number") {
      return {
        rows: [],
        error: "current lines batch prior-row read returned no exact count; truncation cannot be excluded",
      };
    }
    if (query.count > maxPriorRows) {
      return {
        rows: [],
        error: `current lines batch prior-row cap exceeded: count=${query.count} cap=${maxPriorRows}`,
      };
    }
    expectedRows ??= query.count;
    if (query.count !== expectedRows) {
      return {
        rows: [],
        error: `current lines batch prior-row count changed during pagination: initial=${expectedRows} current=${query.count}`,
      };
    }
    const page = (query.data ?? []) as unknown as PriorLineRow[];
    for (const row of page) {
      if (
        row.player_id !== null ||
        typeof row.game_id !== "number" ||
        typeof row.market_type !== "string" ||
        typeof row.sportsbook !== "string" ||
        (typeof row.id !== "number" && typeof row.id !== "string")
      ) {
        continue;
      }
      if (!acceptedKeys.has(groupKey(row.game_id, row.market_type, row.sportsbook))) continue;
      const idKey = `${typeof row.id}:${String(row.id)}`;
      if (seenIds.has(idKey)) continue;
      seenIds.add(idKey);
      acceptedRows.push(row);
      if (acceptedRows.length > maxPriorRows) {
        return {
          rows: [],
          error: `current lines batch prior-row cap exceeded after exact-key filtering: cap=${maxPriorRows}`,
        };
      }
    }
    const expectedPageRows = Math.min(pageSize, expectedRows - from);
    if (page.length !== expectedPageRows) {
      return {
        rows: [],
        error: `current lines batch prior-row pagination truncated: offset=${from} expected=${expectedPageRows} received=${page.length}`,
      };
    }
  }
  result.priorRowsRead = acceptedRows.length;
  return { rows: acceptedRows, error: null };
}

/**
 * Replace current game-line rows with bounded batch I/O while retaining the
 * insert-before-delete and per-complete-group last-known-good contract.
 */
export async function replaceCurrentGameLinesBatched(
  client: SupabaseClient,
  rows: ReadonlyArray<LineRow>,
  context: string,
  options: CurrentLinesBatchOptions = {},
): Promise<CurrentLinesReplaceResult> {
  const groups = groupCurrentGameLineRows(rows);
  const result = emptyResult(rows.length, groups.length);
  if (groups.length === 0) return result;

  const maxIncomingRows = positiveInteger(options.maxIncomingRows, CURRENT_LINES_MAX_INCOMING_ROWS);
  const maxIncomingGroups = positiveInteger(options.maxIncomingGroups, CURRENT_LINES_MAX_INCOMING_GROUPS);
  if (rows.length > maxIncomingRows || groups.length > maxIncomingGroups) {
    return markAllFailed(
      result,
      groups,
      `${context} current-line input cap exceeded: rows=${rows.length}/${maxIncomingRows} groups=${groups.length}/${maxIncomingGroups}`,
    );
  }

  const pageSize = positiveInteger(options.priorPageSize, CURRENT_LINES_PRIOR_PAGE_SIZE);
  const maxPriorRows = positiveInteger(options.maxPriorRows, CURRENT_LINES_MAX_PRIOR_ROWS);
  const priorRead = await readPriorRows(client, groups, result, pageSize, maxPriorRows);
  if (priorRead.error !== null) {
    return markAllFailed(result, groups, `${context} ${priorRead.error}`);
  }

  const priorIdsByGroup = new Map<string, Array<number | string>>();
  for (const row of priorRead.rows) {
    const key = groupKey(row.game_id, row.market_type, row.sportsbook);
    const ids = priorIdsByGroup.get(key) ?? [];
    ids.push(row.id);
    priorIdsByGroup.set(key, ids);
  }

  const successfulGroups: LineGroup[] = [];
  const insertChunks = chunkCompleteLineGroups(
    groups,
    positiveInteger(options.insertChunkRows, CURRENT_LINES_INSERT_CHUNK_ROWS),
  );
  for (const chunk of insertChunks) {
    result.insertQueries += 1;
    const chunkRows = chunk.flatMap((group) => group.rows);
    const inserted = await client.from("lines").insert(chunkRows);
    if (!inserted.error) {
      successfulGroups.push(...chunk);
      result.insertedGroups += chunk.length;
      result.insertedRows += chunkRows.length;
      continue;
    }

    let recoveredGroups = 0;
    for (const group of chunk) {
      result.insertFallbackQueries += 1;
      const fallback = await client.from("lines").insert(group.rows);
      if (fallback.error) {
        recordFailure(
          result,
          group,
          `${context} insert failed for game_id=${group.gameId} market=${group.marketType} sportsbook=${group.sportsbook}: ${fallback.error.message}`,
          true,
        );
        continue;
      }
      recoveredGroups += 1;
      successfulGroups.push(group);
      result.insertedGroups += 1;
      result.insertedRows += group.rows.length;
    }
    if (recoveredGroups > 0) result.recoveredInsertChunks += 1;
  }

  const cleanupGroups: PriorGroup[] = successfulGroups.map((group) => ({
    ...group,
    priorIds: [...new Set(priorIdsByGroup.get(group.key) ?? [])],
  }));
  const deleteChunks = chunkPriorGroups(
    cleanupGroups,
    positiveInteger(options.deleteChunkIds, CURRENT_LINES_DELETE_CHUNK_IDS),
  );
  for (const chunk of deleteChunks) {
    const ids = chunk.flatMap((group) => group.priorIds);
    result.deleteQueries += 1;
    const deleted = await client.from("lines").delete().in("id", ids);
    if (!deleted.error) continue;

    let recoveredGroups = 0;
    for (const group of chunk) {
      result.deleteFallbackQueries += 1;
      const fallback = await client.from("lines").delete().in("id", group.priorIds);
      if (fallback.error) {
        recordFailure(
          result,
          group,
          `${context} prior-row cleanup failed for game_id=${group.gameId} market=${group.marketType} sportsbook=${group.sportsbook}: ${fallback.error.message}`,
          false,
          true,
        );
        continue;
      }
      recoveredGroups += 1;
    }
    if (recoveredGroups > 0) result.recoveredDeleteChunks += 1;
  }

  return result;
}
