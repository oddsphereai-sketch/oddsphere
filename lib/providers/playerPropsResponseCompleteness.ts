/** Admission for declared whole-response feeds. No pagination or provider I/O. */
export const PLAYER_PROPS_RESPONSE_COMPLETENESS_RELEASE =
  "player_props_response_completeness_2026_11_10_r1_whole_response" as const;

export class PlayerPropsResponseCompletenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerPropsResponseCompletenessError";
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

function envelope(value: unknown, endpoint: string) {
  const body = record(value);
  if (!body || body.success !== undefined && body.success !== true) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: invalid or unsuccessful envelope.`);
  }
  const meta = body.meta;
  if (meta !== undefined && meta !== null && !record(meta)) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: malformed metadata.`);
  }
  return { body, meta: record(meta) ?? {} };
}

/** A capped one-response source cannot silently claim a continued response is
 * complete. Unknown fields do not establish an undocumented paging protocol.
 * Schedule callers deliberately do NOT apply a returned-row count rule. */
export function assertNoDeclaredContinuation(value: unknown, endpoint: string): void {
  const { body, meta } = envelope(value, endpoint);
  const cursors = [body.next_cursor, body.nextCursor, body.pagination,
    meta.next_cursor, meta.nextCursor, meta.pagination];
  const more = [body.has_more, body.hasMore, meta.has_more, meta.hasMore];
  if (cursors.some(v => v !== undefined && v !== null)
    || more.some(v => v !== undefined && v !== null && v !== false)) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: declared or malformed continuation.`);
  }
}

function wholeData(value: unknown, endpoint: string) {
  assertNoDeclaredContinuation(value, endpoint);
  const { body, meta } = envelope(value, endpoint);
  if (!Array.isArray(body.data)) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: malformed data.`);
  }
  return { data: body.data, meta };
}

/** BDL current/opening props are unpaginated. per_page counts raw props,
 * never normalized Over/Under legs. Missing legacy metadata remains valid. */
export function assertCompleteBdlPropsResponse(value: unknown, endpoint: string): void {
  const { data, meta } = wholeData(value, endpoint), count = meta.per_page;
  if (count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0 || count !== data.length)) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: contradictory returned count.`);
  }
}

/** Owls' merged sport props board documents gamesReturned for its event array.
 * propsReturned has no established aggregation contract here; do not infer it
 * from normalized quotes, alternate lines or per-book prop counts. */
export function assertCompleteOwlsPropsResponse(value: unknown, endpoint: string): void {
  const { data, meta } = wholeData(value, endpoint), count = meta.gamesReturned;
  if (count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0 || count !== data.length)) {
    throw new PlayerPropsResponseCompletenessError(`${endpoint} violated the complete single-response contract: contradictory returned game count.`);
  }
}
