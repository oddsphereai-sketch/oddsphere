import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { soccerStoredPriceMaxAgeMs } from "@/lib/providers/real_api/CurrentSoccerMarketProvider";

/** Operator-only source inspection, never an inference or persistence input. */
export const UCL_PRICE_SOURCE_PROBE = "ucl_bounded_price_source_probe_2026_11_03_r1" as const;
const SPORT_KEY = "soccer_uefa_champs_league";
const MARKETS = ["h2h", "double_chance", "totals", "btts"] as const;
const BOOKMAKERS = "pinnacle,draftkings,fanduel,betmgm,caesars"; // one <=10-book billing group
const MAX_CREDITS = 8;
const RESERVE = 1_000;
const KNOWN = {
  4243843: { home: "LASK Linz", away: "Slovan Bratislava", kickoff: "2026-11-03T20:00:00.000Z" },
  4438978: { home: "Lens", away: "Como", kickoff: "2026-11-04T20:00:00.000Z" },
} as const;
type KnownId = keyof typeof KNOWN;
type SnapshotGame = Pick<DailyEdgeGameDto, "id" | "sport" | "external_id" | "homeTeamDisplayName" | "awayTeamDisplayName" |
  "gameStartAt" | "lockState" | "lockedAt" | "soccerCompetitionContext">;
type ProbeSnapshot = Pick<DailyEdgeResponse, "sport" | "as_of"> & { games: readonly SnapshotGame[] };
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as JsonObject : null;
const string = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const integerHeader = (response: Response, name: string): number | null => {
  const value = response.headers.get(name);
  const number = value !== null && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : null;
};
function nameKey(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}
// Diagnostic-only exact equivalences, not broad substring production mapping.
function namesMatch(left: unknown, right: unknown): boolean {
  const a = nameKey(left), b = nameKey(right);
  return !!a && !!b && (a === b || [["lask", "lasklinz"], ["lens", "rclens"], ["como", "calciocomo1907"],
    ["slovanbratislava", "skslovanbratislava", "sbratislava"]].some(group => group.includes(a) && group.includes(b)));
}
function matches(event: JsonObject, fixture: { home: string; away: string; kickoff: string }): boolean {
  const time = Date.parse(String(event.commence_time));
  return (!event.sport_key || event.sport_key === SPORT_KEY) && namesMatch(event.home_team, fixture.home) &&
    namesMatch(event.away_team, fixture.away) && Number.isFinite(time) && Math.abs(time - Date.parse(fixture.kickoff)) <= 90 * 60_000;
}

export function parseUclPriceProbeIds(value: string | null): number[] | null {
  if (!value || !/^\d+(,\d+)?$/.test(value)) return null;
  const ids = value.split(",").map(Number);
  return new Set(ids).size === ids.length && ids.every(id => Object.hasOwn(KNOWN, id)) ? ids : null;
}

export async function runUclBoundedPriceSourceProbe(input: {
  snapshot: ProbeSnapshot | null; fixtureIds: readonly number[]; apiKey: string | undefined;
  now?: () => Date; fetchImpl?: typeof fetch;
}) {
  const now = input.now ?? (() => new Date());
  const fetcher = input.fetchImpl ?? fetch;
  const receipt = { release: UCL_PRICE_SOURCE_PROBE, diagnosticOnly: true, readOnly: true,
    recordsUpdated: 0, catalogRequests: 0, paidRequests: 0, creditsUsed: 0, reservedCredits: 0,
    maximumCredits: MAX_CREDITS, normalRefreshCadenceUpdated: false,
    holds: [] as string[], catalog: [] as JsonObject[], fixtures: [] as JsonObject[] };
  const hold = (reason: string) => { receipt.holds.push(reason); return receipt; };
  if (!Number.isFinite(now().getTime())) return hold("invalid_evaluation_clock");
  const ids = parseUclPriceProbeIds(input.fixtureIds.join(","));
  if (!ids) return hold("only_one_or_two_explicit_approved_fixture_ids_allowed");
  if (!input.snapshot || input.snapshot.sport !== "soccer" || !Array.isArray(input.snapshot.games)) return hold("current_ucl_snapshot_unavailable");
  const asOf = Date.parse(input.snapshot.as_of);
  if (!Number.isFinite(asOf) || asOf > now().getTime() || now().getTime() - asOf > 24 * 3_600_000) return hold("snapshot_clock_invalid_or_stale");
  for (const id of ids) {
    const rows = input.snapshot.games.filter(game => game.external_id === id);
    const game = rows[0], expected = KNOWN[id as KnownId];
    if (rows.length !== 1 || !game || game.sport !== "soccer" || game.id !== `soccer-ucl-${id}` ||
      game.soccerCompetitionContext?.competition !== "uefa_champions_league" ||
      !namesMatch(game.homeTeamDisplayName, expected.home) || !namesMatch(game.awayTeamDisplayName, expected.away) ||
      Date.parse(game.gameStartAt ?? "") !== Date.parse(expected.kickoff)) return hold(`snapshot_fixture_identity_invalid:${id}`);
    if (game.lockedAt !== null || game.lockState !== "open" || Date.parse(expected.kickoff) - now().getTime() <= 60 * 60_000)
      return hold(`fixture_not_unlocked:${id}`);
  }
  if (!input.apiKey) return hold("api_key_unavailable");
  const safe = (value: unknown): string | null => typeof value === "string"
    ? value.replaceAll(input.apiKey!, "[redacted]").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) : null;
  const summary = (event: JsonObject) => ({ id: safe(event.id), home: safe(event.home_team), away: safe(event.away_team),
    kickoff: safe(event.commence_time), sportKey: safe(event.sport_key) });
  const url = (path: string): URL => {
    const value = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/${path}`);
    value.searchParams.set("apiKey", input.apiKey!); value.searchParams.set("dateFormat", "iso"); return value;
  };
  const read = async (value: URL): Promise<Response | null> => {
    try { return await fetcher(value, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) }); }
    catch { receipt.holds.push("source_request_failed"); return null; } // Never echo URL/error/credentials.
  };
  receipt.catalogRequests++;
  const catalogResponse = await read(url("events"));
  if (!catalogResponse || !catalogResponse.ok) return hold("catalog_unavailable");
  const catalogCost = integerHeader(catalogResponse, "x-requests-last");
  if (catalogCost !== null && catalogCost !== 0) { receipt.creditsUsed += catalogCost; return hold("catalog_cost_contract_violation"); }
  let remaining = integerHeader(catalogResponse, "x-requests-remaining");
  let catalogBody: unknown;
  try { catalogBody = await catalogResponse.json(); } catch { return hold("catalog_malformed"); }
  if (!Array.isArray(catalogBody) || catalogBody.length > 512) return hold("catalog_malformed");
  const catalog = catalogBody.flatMap(event => { const row = object(event); return row ? [row] : []; });
  receipt.catalog = catalog.map(summary);
  for (const id of ids) {
    const fixture = KNOWN[id as KnownId];
    const candidates = catalog.filter(event => matches(event, fixture));
    const diagnostic: JsonObject = { fixtureId: id, fixture, catalogMatches: candidates.map(summary), status: "event_not_published", books: [] };
    receipt.fixtures.push(diagnostic);
    if (candidates.length !== 1) { diagnostic.status = candidates.length ? "ambiguous_event_identity" : "event_not_published"; continue; }
    const event = candidates[0]!, eventId = string(event.id);
    if (!eventId || !/^[a-zA-Z0-9_-]{1,128}$/.test(eventId) || catalog.filter(row => row.id === eventId).length !== 1) {
      diagnostic.status = "invalid_or_duplicate_event_id"; continue;
    }
    if (Date.parse(fixture.kickoff) - now().getTime() <= 60 * 60_000) { diagnostic.status = "fixture_no_longer_unlocked"; continue; }
    if (receipt.paidRequests >= 2 || receipt.creditsUsed + MARKETS.length > MAX_CREDITS) { diagnostic.status = "request_or_credit_ceiling"; continue; }
    if (remaining === null || remaining - MARKETS.length < RESERVE) { diagnostic.status = "credit_balance_unavailable_or_reserve"; continue; }
    const oddsUrl = url(`events/${eventId}/odds`);
    oddsUrl.searchParams.set("markets", MARKETS.join(",")); oddsUrl.searchParams.set("bookmakers", BOOKMAKERS);
    oddsUrl.searchParams.set("oddsFormat", "american");
    receipt.paidRequests++; receipt.reservedCredits += MARKETS.length;
    const source = await read(oddsUrl);
    const cost = source ? integerHeader(source, "x-requests-last") ?? MARKETS.length : MARKETS.length;
    receipt.creditsUsed += cost; remaining = source ? integerHeader(source, "x-requests-remaining") : null;
    if (cost > MARKETS.length) { diagnostic.status = "source_cost_contract_violation"; continue; }
    if (!source?.ok) { diagnostic.status = "source_odds_unavailable"; continue; }
    let body: unknown;
    try { body = await source.json(); } catch { diagnostic.status = "source_odds_malformed"; continue; }
    const receivedAt = now(); // Validate against receipt of the full body, not request/header time.
    if (!Number.isFinite(receivedAt.getTime())) { diagnostic.status = "invalid_receipt_clock"; continue; }
    const offered = object(body);
    if (!offered || offered.id !== eventId || !matches(offered, fixture)) { diagnostic.status = "returned_fixture_identity_mismatch"; continue; }
    diagnostic.status = "received_current_source"; diagnostic.sourceEvent = summary(offered); diagnostic.receivedAt = receivedAt.toISOString();
    diagnostic.books = (Array.isArray(offered.bookmakers) ? offered.bookmakers : []).slice(0, 64).flatMap(item => {
      const book = object(item); if (!book) return [];
      return [{ key: safe(book.key), title: safe(book.title), lastUpdate: safe(book.last_update),
        markets: (Array.isArray(book.markets) ? book.markets : []).slice(0, 32).flatMap(item => {
          const market = object(item); if (!market || !MARKETS.some(key => key === market.key)) return [];
          const originalClock = market.last_update === undefined || market.last_update === null ? book.last_update : market.last_update;
          const clock = Date.parse(String(originalClock));
          return [{ key: safe(market.key), originalUpdatedAt: safe(originalClock),
            clockStatus: !Number.isFinite(clock) ? "invalid_or_missing" : clock > receivedAt.getTime() ? "future" :
              receivedAt.getTime() - clock > soccerStoredPriceMaxAgeMs(fixture.kickoff, receivedAt.getTime()) ? "stale" : "current",
            outcomes: (Array.isArray(market.outcomes) ? market.outcomes : []).slice(0, 16).flatMap(item => {
              const outcome = object(item); if (!outcome) return [];
              return [{ name: safe(outcome.name), american: typeof outcome.price === "number" && Number.isFinite(outcome.price) ? outcome.price : null,
                line: typeof outcome.point === "number" && Number.isFinite(outcome.point) ? outcome.point : null }];
            }) }];
        }) }];
    });
  }
  return receipt;
}
