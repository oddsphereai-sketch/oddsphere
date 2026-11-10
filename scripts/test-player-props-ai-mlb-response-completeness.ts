/** Real MLB HTTP client/provider -> live packet -> request; all HTTP is fake. */
import assert from "node:assert/strict";
import { BdlClient } from "../lib/providers/real_api/_bdlClient";
import { BallDontLieMlbPropsClient, parseBallDontLiePlayerProps } from "../lib/mlb/props/providerClients";
import type { PropOddsSnapshot } from "../lib/mlb/props/providers";
import type { MlbPropsBoardSnapshot } from "../lib/mlb/props/boardSnapshotStore";
import type { PlayerPropPreviewRow } from "../app/mlb/props/components/PlayerPropsDashboard";
import { CATALOG } from "../lib/playerPropsAi/evidenceContract";
import { liveMlbPacket } from "../lib/playerPropsAi/liveSources";
import { jointReviewRequest } from "../lib/playerPropsAi/request";
import { digest } from "../lib/playerPropsAi/evidence";
import { MLB_PROPS_MODEL_RELEASE_ID } from "../lib/mlb/props/marketModelVersions";

const at = "2030-06-01T18:00:00.000Z", old = "2030-06-01T17:00:00.000Z";
const start = "2030-06-01T21:00:00.000Z", lock = "2030-06-01T20:00:00.000Z";
const NativeDate = Date, originalFetch = globalThis.fetch, originalVercel = process.env.VERCEL;
const databaseEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const originalDatabaseEnv = Object.fromEntries(databaseEnv.map(name => [name, process.env[name]]));
class SyntheticDate extends Date {
  constructor(value?: string | number) { super(value ?? at); }
  static now() { return NativeDate.parse(at); }
}
const game = { id: 1, date: start, status: "Scheduled", home_team_id: 111, away_team_id: 147,
  home_team: { id: 111, abbreviation: "BOS", full_name: "Boston Red Sox" }, away_team: { id: 147, abbreviation: "NYY", full_name: "New York Yankees" },
  home_team_pitcher_id: 20, away_team_pitcher_id: 21 };
const raw = CATALOG.mlb.required.map((market, index) => ({ id: 100 + index, game_id: 1,
  player_id: market.startsWith("pitcher_") ? 20 : 30, vendor: "draftkings", prop_type: market, line_value: .5,
  updated_at: old, opened_at: old, market: { type: "over_under", over_odds: -110, under_odds: -110 } }));
type Mode = { target?: "current" | "opening"; patch?: Record<string, unknown>; body?: unknown; status?: number; games?: number; badGame?: string };
function transport(mode: Mode = {}) {
  const calls: string[] = [];
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.balldontlie.io"); calls.push(u.pathname + u.search);
    assert(!u.searchParams.has("cursor"), "A complete props response must never buy an extra page");
    if (u.pathname === "/mlb/v1/games") return Response.json({ data: Array.from({ length: mode.games ?? 1 }, (_, i) => ({ ...game, id: i + 1 })), meta: { next_cursor: null } });
    assert(["/mlb/v1/odds/player_props", "/mlb/v1/odds/player_props/opening"].includes(u.pathname), "No research or other provider request is allowed");
    const opening = u.pathname.endsWith("/opening"), id = u.searchParams.get("game_id");
    const target = (opening ? mode.target === "opening" : mode.target !== "opening") && (!mode.badGame || mode.badGame === id);
    assert(id && Number(id) >= 1 && Number(id) <= (mode.games ?? 1));
    assert.deepEqual([...u.searchParams.keys()], opening ? ["game_id"] : ["game_id", "per_page"]);
    if (target && mode.status) return Response.json({ error: "synthetic unavailable" }, { status: mode.status });
    return Response.json(target && Object.hasOwn(mode, "body") ? mode.body : { data: raw.map(row => ({ ...row, game_id: Number(id) })), meta: { per_page: raw.length }, ...(target ? mode.patch : {}) });
  };
  return calls;
}
function nativeSnapshot(current: PropOddsSnapshot[], opening: PropOddsSnapshot[]): MlbPropsBoardSnapshot {
  const rows = current.map((q, index) => ({ id: `native-${index}`, providerIds: { gameId: "balldontlie-game-1", bdlGameId: "1",
    bdlPlayerId: Number(q.playerId.replace("balldontlie-player-", "")), mlbStatsPlayerId: q.playerId },
    player: q.playerId.endsWith("20") ? "Synthetic Pitcher" : "Synthetic Batter", team: "NYY", opponent: "BOS", gameStartTime: start,
    market: q.marketKey, offerContract: "two_way", side: q.side, line: q.line, book: q.sportsbook, odds: q.americanOdds,
    lastUpdated: q.asOfTimestamp, projection: 1, finalProbability: .5, playGrade: "WATCHLIST", missingFeatures: [], oddsSanity: [], units: 0 })) as unknown as PlayerPropPreviewRow[];
  return { slateDate: "2030-06-01", snapshotId: "synthetic-complete-source", asOfTimestamp: at, data: { props: rows },
    modelContext: { modelReleaseId: MLB_PROPS_MODEL_RELEASE_ID, openingPropOdds: opening } } as MlbPropsBoardSnapshot;
}
async function main() {
  globalThis.Date = SyntheticDate as DateConstructor;
  process.env.VERCEL = "1"; // Existing private provider diagnostics go to OS tmp, never the checkout.
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1", SUPABASE_SERVICE_ROLE_KEY: "synthetic-never-real" });
  globalThis.fetch = async () => { throw Error("MLB response completeness forbids unmocked HTTP"); };
  try {
    // liveBoard imports the existing database client. Bind dummy configuration
    // before loading it; this test never performs a database request.
    const { validateMlbPropsBoardData } = await import("../lib/mlb/props/liveBoard");
    assert.equal(MLB_PROPS_MODEL_RELEASE_ID, "mlb_props_2026_10_21_r44");
    let expectedCurrent: string | undefined, expectedOpening: string | undefined;
    for (const patch of [{}, { meta: undefined }, { meta: null }, { meta: { per_page: raw.length } },
      { meta: { next_cursor: null, has_more: false } }, { unrelated: "not a pagination contract", meta: { per_page: raw.length, note: "diagnostic" } }]) {
      const calls = transport({ patch }), provider = new BallDontLieMlbPropsClient("synthetic-only");
      const current = await provider.getPropOdds({ date: "2030-06-01", asOfTimestamp: at, maxPages: 5 });
      const opening = await provider.getOpeningPropOdds({ gameIds: ["1", "1"], asOfTimestamp: at });
      assert.equal(calls.length, 4, "Two date schedules, one current and one deduplicated opening request");
      assert.equal(provider.getClient().getRequestCount(), calls.length);
      assert.equal(current.length, raw.length * 2); assert.equal(opening.length, raw.length * 2);
      expectedCurrent ??= digest(current); expectedOpening ??= digest(opening);
      assert.equal(digest(current), expectedCurrent); assert.equal(digest(opening), expectedOpening);
      const parsed = parseBallDontLiePlayerProps(raw, at, game);
      assert.deepEqual(current, parsed.map(q => ({ ...q, providerResponseAt: at })), "Raw metadata changes cannot rewrite original quote IDs, events, prices or clocks");
      assert(current.every(q => q.asOfTimestamp === at && q.providerResponseAt === at));
      assert(opening.every(q => q.asOfTimestamp === old && q.providerResponseAt === at));
      const snapshot = nativeSnapshot(current, opening), before = digest(snapshot);
      const packet = liveMlbPacket({ game: { id: "balldontlie-game-1", start, away: "NYY", home: "BOS" },
        window: { gameId: "balldontlie-game-1", cutoff: at, lock, stage: "final" }, snapshot, currentOdds: current, openingOdds: opening });
      assert.equal(packet.players.length, 2);
      assert.deepEqual(packet.players.flatMap(p => p.markets).sort(), [...CATALOG.mlb.required].sort());
      assert.equal(packet.executionQuotes?.length, raw.length * 2);
      assert.equal(packet.quotes.filter(q => q.opening && q.receivedAtProvenance === "provider_response").length, raw.length * 2);
      const request = jointReviewRequest(packet, "gpt-6-luna", 7000);
      const actorSchema = request.text.format.schema.properties.players as { properties: Record<string, unknown> };
      assert.equal(Object.keys(actorSchema.properties).length, 2);
      assert.equal(digest(snapshot), before, "Live packaging cannot mutate an original native or locked source");
    }
    const wholeCalls = transport({ games: 2 }), wholeProvider = new BallDontLieMlbPropsClient("synthetic-only");
    const wholeCurrent = await wholeProvider.getPropOdds({ date: "2030-06-01", asOfTimestamp: at });
    const wholeOpening = await wholeProvider.getOpeningPropOdds({ gameIds: ["1", "2"], asOfTimestamp: at });
    assert.equal(wholeCurrent.length, raw.length * 4); assert.equal(wholeOpening.length, raw.length * 4);
    assert.equal(new Set(wholeCurrent.map(q => q.gameId)).size, 2); assert.equal(wholeCalls.length, 6);
    const bad: unknown[] = [null, [], {}, { data: null }, { data: {} },
      { data: [], meta: { next_cursor: "next" } }, { data: [], meta: { per_page: 1 } }, { data: [], meta: "malformed" },
      ...[{ next_cursor: "next" }, { nextCursor: 1 }, { pagination: {} }, { has_more: true }, { hasMore: true },
        { meta: { next_cursor: "next" } }, { meta: { next_cursor: { malformed: true } } }, { meta: { nextCursor: "next" } },
        { meta: { pagination: {} } }, { meta: { has_more: true } }, { meta: { hasMore: true } }, { meta: { has_more: "false" } },
        { meta: "malformed" }, { meta: [] }, { meta: { per_page: String(raw.length) } }, { meta: { per_page: null } },
        { meta: { per_page: -1 } }, { meta: { per_page: 1.5 } }, { meta: { per_page: Number.MAX_SAFE_INTEGER + 1 } },
        { meta: { per_page: raw.length - 1 } }, { meta: { per_page: raw.length + 1 } }].map(patch => ({ data: raw, ...patch }))];
    for (const endpoint of ["/odds/player_props", "/odds/player_props/opening"]) for (const body of bad) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json(body); };
      const client = new BdlClient("synthetic-only");
      await assert.rejects(client.fetchAll({ path: endpoint, maxPages: 20 }), /complete single-response contract/);
      assert.equal(calls, 1); assert.equal(client.getRequestCount(), 1, "Contract failure adds no page/retry");
    }
    // Provider error handling must never expose part of an invalid game as a
    // complete actor universe. An opening refusal stays unavailable to callers.
    for (const patch of [{ meta: { next_cursor: "next" } }, { meta: { per_page: raw.length + 1 } }]) {
      let calls = transport({ patch });
      await assert.rejects(new BallDontLieMlbPropsClient("synthetic-only").getPropOdds({ date: "2030-06-01", asOfTimestamp: at }), /complete single-response contract/);
      assert.equal(calls.length, 3);
      calls = transport({ target: "opening", patch });
      await assert.rejects(new BallDontLieMlbPropsClient("synthetic-only").getOpeningPropOdds({ gameIds: ["1"], asOfTimestamp: at }), /complete single-response contract/);
      assert.equal(calls.length, 1);
      // The first game is complete. A contradiction in the second cannot
      // return that first game as a silently complete reduced current slate.
      calls = transport({ games: 2, badGame: "2", patch });
      let downstream = 0;
      await assert.rejects((async () => {
        const current = await new BallDontLieMlbPropsClient("synthetic-only").getPropOdds({ date: "2030-06-01", asOfTimestamp: at });
        downstream++; nativeSnapshot(current, []); // No publication/model preparation may consume a partial return.
      })(), /complete single-response contract/);
      assert.equal(calls.length, 4); assert.equal(downstream, 0);
    }
    for (const status of [200, 404, 422]) {
      const calls = transport({ body: { data: [], meta: { per_page: 0 } }, ...(status === 200 ? {} : { status }) });
      const current = await new BallDontLieMlbPropsClient("synthetic-only").getPropOdds({ date: "2030-06-01", asOfTimestamp: at });
      assert.deepEqual(current, []); assert.equal(calls.length, 3);
      // No offered actors/quotes are manufactured from a successful empty or
      // unavailable response; the existing board's zero-source validator holds.
      const empty = nativeSnapshot(current, []);
      const validation = validateMlbPropsBoardData({ data: empty.data, sourceRows: current.length, mappedRows: 0, asOfTimestamp: at });
      assert.equal(validation.publishable, false); assert(validation.errors.includes("PROP_ODDS_UNAVAILABLE"));
      const openingCalls = transport({ target: "opening", body: { data: [], meta: { per_page: 0 } }, ...(status === 200 ? {} : { status }) });
      const opening = new BallDontLieMlbPropsClient("synthetic-only").getOpeningPropOdds({ gameIds: ["1"], asOfTimestamp: at });
      if (status === 422) await assert.rejects(opening, /HTTP 422/); else assert.deepEqual(await opening, []);
      assert.equal(openingCalls.length, 1);
    }
    for (const mode of [{ body: { data: [], meta: { per_page: 0 } } }, { status: 404 }, { status: 422 }]) {
      const calls = transport({ games: 2, badGame: "2", ...mode });
      const current = await new BallDontLieMlbPropsClient("synthetic-only").getPropOdds({ date: "2030-06-01", asOfTimestamp: at });
      assert.equal(current.length, raw.length * 2, "Ordinary optional empty/404/422 game failure keeps the established healthy-game behavior");
      assert(current.every(q => q.gameId === "balldontlie-game-1")); assert.equal(calls.length, 4);
    }
    // A neighboring genuinely paginated stats endpoint retains its two pages.
    const queries: string[] = [];
    globalThis.fetch = async url => { const u = new URL(String(url)); assert.equal(u.pathname, "/mlb/v1/stats"); queries.push(u.search);
      return Response.json(u.searchParams.has("cursor") ? { data: [{ id: 2 }], meta: { next_cursor: null, per_page: 100 } }
        : { data: [{ id: 1 }], meta: { next_cursor: 99, per_page: 100 } }); };
    assert.deepEqual(await new BdlClient("synthetic-only").fetchAll({ path: "/stats", query: { per_page: 100 } }), [{ id: 1 }, { id: 2 }]);
    assert.equal(queries.length, 2); assert(queries[1].includes("cursor=99"));
    console.log(`MLB response completeness passed: real BdlClient/provider -> two actors/all17 markets -> live source/request; current/opening exact clocks/IDs/quotes; ${bad.length} invalid envelopes per endpoint refused without pagination; empty/error source unavailable and neighboring stats pagination intact. All HTTP synthetic; no DB/count/AI calls.`);
  } finally {
    globalThis.Date = NativeDate; globalThis.fetch = originalFetch;
    if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
    for (const name of databaseEnv) {
      if (originalDatabaseEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalDatabaseEnv[name];
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
