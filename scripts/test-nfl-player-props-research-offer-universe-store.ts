import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropMarket } from "../lib/services/football/nflPlayerPropsContract";
import {
  NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
  type NflPlayerPropsExactOffer,
} from "../lib/services/football/nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsResearchOfferUniverseRows,
  captureNflPlayerPropsResearchOfferUniverse,
  captureNflPlayerPropsResearchOfferUniverseSafely,
  decodeNflPlayerPropsResearchOfferUniverseHistory,
  encodeNflPlayerPropsResearchOfferUniverseHistory,
  mergeNflPlayerPropsResearchOfferUniverseRows,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
  nflPlayerPropsResearchOfferUniverseKey,
  type NflPlayerPropsResearchOfferUniverseHistory,
} from "../lib/services/football/nflPlayerPropsResearchOfferUniverseStore";

const start = "2026-10-18T20:00:00.000Z";
const lock = "2026-10-18T19:00:00.000Z";
const t24 = "2026-10-17T20:30:00.000Z";
const t6 = "2026-10-18T14:30:00.000Z";
const t60 = "2026-10-18T19:10:00.000Z";

function offer(args: {
  market: NflPlayerPropMarket;
  line?: number;
  player?: string;
  book?: string;
  complete?: boolean;
  openingLine?: number;
  observedAt?: string;
  fetchedAt?: string;
}): NflPlayerPropsExactOffer {
  const line = args.line ?? 1.5;
  const player = args.player ?? "Test Player";
  const book = args.book ?? "DraftKings";
  const milestone = args.market === "anytime_td" || args.market === "first_td";
  const complete = args.complete ?? true;
  return {
    release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
    offerKey: ["balldontlie", "game-1", "player-1", book, args.market, line].join("|"),
    canonicalGameId: "game-1",
    provider: "balldontlie",
    providerEventId: "provider-game-1",
    providerPlayerId: "player-1",
    playerName: player,
    playerTeam: "BUF",
    sportsbook: book,
    market: args.market,
    offerType: milestone ? "milestone" : "over_under",
    line,
    overPrice: milestone ? null : -110,
    underPrice: milestone || !complete ? null : -110,
    yesPrice: milestone ? 225 : null,
    overNoVigProbability: milestone || !complete ? null : 0.5,
    underNoVigProbability: milestone || !complete ? null : 0.5,
    observedAt: args.observedAt ?? "2026-10-17T20:25:00.000Z",
    fetchedAt: args.fetchedAt ?? "2026-10-17T20:25:01.000Z",
    openingObservedAt: "2026-10-16T12:00:00.000Z",
    openingLine: args.openingLine ?? line,
    openingOverPrice: milestone ? null : -105,
    openingUnderPrice: milestone ? null : -115,
    openingYesPrice: milestone ? 250 : null,
    scheduledStart: start,
    lockAt: lock,
    state: "unlocked",
    exactPriceComplete: milestone || complete,
    gradeEligibleMarket: false,
    healthHolds: complete ? [] : ["incomplete_exact_side_prices"],
  };
}

const sixMarkets = NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.map((market, index) => offer({
  market,
  line: market === "passing_tds" ? 1.5 : 10.5 + index,
  complete: market !== "kicking_points",
}));
const alternateLongestPass = offer({ market: "longest_pass", line: 12.5, openingLine: 11.5 });
const supportedProductionMarket = offer({ market: "passing_yards", line: 249.5 });
const input = [...sixMarkets, alternateLongestPass, supportedProductionMarket];

const builtT24 = buildNflPlayerPropsResearchOfferUniverseRows({
  offers: input,
  evaluatedAt: t24,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.deepEqual([...new Set(builtT24.rows.map((row) => row.market))].sort(),
  [...NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS].sort());
assert.equal(builtT24.health.inputOffers, 8);
assert.equal(builtT24.health.eligibleOffers, 7);
assert.equal(builtT24.health.completeOffers, 6);
assert.equal(builtT24.rows.filter((row) => row.landmark === "t24").length, 7,
  "every declared offer and alternate line is retained at T-24");
assert.equal(builtT24.rows.filter((row) => row.landmark === "provider_opening").length, 6,
  "the shared Longest Pass opening is deduplicated across current alternate lines");
assert.equal(builtT24.rows.length, 13);
assert.equal(builtT24.rows.some((row) => row.market === "passing_yards"), false,
  "existing production markets are outside this additive research archive");
const incomplete = builtT24.rows.find((row) => row.market === "kicking_points" && row.landmark === "t24");
assert.equal(incomplete?.exactPriceComplete, false);
assert.deepEqual(incomplete?.healthHolds, ["incomplete_exact_side_prices"]);

const builtT6 = buildNflPlayerPropsResearchOfferUniverseRows({
  offers: input.map((row) => ({
    ...row,
    observedAt: "2026-10-18T14:25:00.000Z",
    fetchedAt: "2026-10-18T14:25:01.000Z",
  })),
  evaluatedAt: t6,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(builtT6.rows.filter((row) => row.landmark === "t6").length, 7);

const atLockInput = input.map((row) => ({
  ...row,
  observedAt: "2026-10-18T18:58:00.000Z",
  fetchedAt: "2026-10-18T18:58:01.000Z",
}));
const builtT60 = buildNflPlayerPropsResearchOfferUniverseRows({
  offers: atLockInput,
  evaluatedAt: t60,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(builtT60.rows.length, 7);
assert.ok(builtT60.rows.every((row) => row.landmark === "t60_lock"));
assert.ok(builtT60.rows.every((row) => row.observedAt <= lock));

const staleT60 = buildNflPlayerPropsResearchOfferUniverseRows({
  offers: atLockInput.map((row) => ({
    ...row,
    observedAt: "2026-10-18T10:00:00.000Z",
    fetchedAt: "2026-10-18T10:00:01.000Z",
  })),
  evaluatedAt: t60,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(staleT60.rows.length, 0, "a stale quote cannot become immutable T-60 research evidence");

const afterKickoff = buildNflPlayerPropsResearchOfferUniverseRows({
  offers: input,
  evaluatedAt: "2026-10-18T20:01:00.000Z",
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(afterKickoff.rows.length, 0, "no research offer is appended after kickoff");

const once = mergeNflPlayerPropsResearchOfferUniverseRows({ previous: [], current: builtT24.rows });
const twice = mergeNflPlayerPropsResearchOfferUniverseRows({ previous: once.rows, current: builtT24.rows });
assert.equal(once.added, 13);
assert.equal(twice.added, 0);
assert.equal(twice.preserved, 13);
const changed = { ...builtT24.rows[0]!, overPrice: 500 };
const conflict = mergeNflPlayerPropsResearchOfferUniverseRows({ previous: builtT24.rows, current: [changed] });
assert.equal(conflict.conflicts, 1);
assert.equal(conflict.rows.find((row) => row.rowKey === changed.rowKey)?.overPrice, builtT24.rows[0]?.overPrice,
  "the first landmark record cannot be rewritten by a conflicting replay");

const history: NflPlayerPropsResearchOfferUniverseHistory = {
  kind: "nfl_player_props_research_offer_universe_v1",
  schema: "nfl_props_research_offer_universe_v1",
  captureRelease: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
  season: 2026,
  week: 7,
  createdAt: t24,
  updatedAt: t24,
  boundaryPolicy: "opening_t24_t6_t60_first_observation_immutable",
  rowLimit: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
  rows: builtT24.rows,
};
const envelope = encodeNflPlayerPropsResearchOfferUniverseHistory(history);
assert.ok(envelope.uncompressedBytes < NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES);
assert.ok(envelope.compressedBytes < NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES);
assert.deepEqual(decodeNflPlayerPropsResearchOfferUniverseHistory(envelope), history);
assert.equal(decodeNflPlayerPropsResearchOfferUniverseHistory({ ...envelope, checksum: "corrupt" }), null);
assert.throws(() => encodeNflPlayerPropsResearchOfferUniverseHistory({
  ...history,
  rows: Array.from({ length: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS + 1 }, () => builtT24.rows[0]!),
}), /row limit/);

async function persistence(): Promise<void> {
  let stored: unknown = null;
  let writes = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "lab_response_snapshots");
      const query = {
        select() { return query; },
        eq(_column: string, key: string) {
          assert.equal(key, nflPlayerPropsResearchOfferUniverseKey(2026, 7));
          return query;
        },
        async maybeSingle() {
          return { data: stored === null ? null : { payload: stored }, error: null };
        },
        async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          assert.equal(row.snapshot_key, nflPlayerPropsResearchOfferUniverseKey(2026, 7));
          assert.equal(row.kind, "daily_edge");
          assert.equal(row.source, "writer-release");
          assert.equal(options.onConflict, "snapshot_key");
          stored = row.payload;
          writes += 1;
          return { error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  const first = await captureNflPlayerPropsResearchOfferUniverse({
    client, season: 2026, week: 7, offers: input, evaluatedAt: t24,
    maximumLockQuoteAgeHours: 6, writerRelease: "writer-release",
  });
  assert.equal(first.written, true);
  assert.equal(first.rowsAdded, 13);
  assert.equal(writes, 1);
  const replay = await captureNflPlayerPropsResearchOfferUniverse({
    client, season: 2026, week: 7, offers: input, evaluatedAt: t24,
    maximumLockQuoteAgeHours: 6, writerRelease: "writer-release",
  });
  assert.equal(replay.written, false);
  assert.equal(replay.rowsAdded, 0);
  assert.equal(writes, 1, "an idempotent replay cannot write the database again");

  const isolated = await captureNflPlayerPropsResearchOfferUniverseSafely(async () => {
    throw new Error("research archive unavailable");
  });
  assert.equal(isolated.written, false);
  assert.equal(isolated.error, "research archive unavailable");
}

assert.doesNotMatch(
  readFileSync("lib/services/football/nflPlayerPropsResearchOfferUniverseStore.ts", "utf8"),
  /fetch\(|collectNflPlayerPropsObservations|ballDontLieApiKey|sharpApiKey|buildNflPlayerPropsRuntimeBoard/,
  "the isolated research archive cannot collect providers or score a model",
);
const writerSource = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
assert.ok(writerSource.indexOf("await writeNflPlayerPropsSnapshot")
  < writerSource.lastIndexOf("captureNflPlayerPropsResearchOfferUniverseSafely"),
"the additive research archive cannot precede the authoritative member snapshot write");
assert.ok(writerSource.indexOf("settleNflPlayerPropsRecords({")
  < writerSource.lastIndexOf("captureNflPlayerPropsResearchOfferUniverseSafely"),
"the additive archive cannot delay lock/closing/settlement authority");
assert.match(writerSource, /offers: \[\.\.\.offers, \.\.\.sourceAwareReferenceOffers\],\n\s+evaluatedAt: args\.now/,
  "the research archive reuses the already-built retail and current-cycle reference exact-offer boards");

persistence()
  .then(() => console.log("NFL player props research offer-universe store tests passed."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
