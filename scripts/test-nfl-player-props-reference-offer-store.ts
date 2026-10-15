import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
  readNflPlayerPropsReferenceOffers,
  writeNflPlayerPropsReferenceOffers,
} from "../lib/services/football/nflPlayerPropsReferenceOfferStore";
import {
  NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
  type NflPlayerPropsExactOffer,
} from "../lib/services/football/nflPlayerPropsMarketBoard";

const updatedAt = "2026-10-15T16:06:45.106Z";
const expiresAt = "2026-10-29T16:06:45.106Z";
const offer: NflPlayerPropsExactOffer = {
  release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
  offerKey: "game-1:player-1:passing_attempts:35.5:pinnacle",
  canonicalGameId: "game-1",
  provider: "sharpapi",
  providerEventId: "provider-game-1",
  providerPlayerId: "player-1",
  playerName: "Exact Quarterback",
  playerTeam: "BUF",
  sportsbook: "pinnacle",
  market: "passing_attempts",
  offerType: "over_under",
  line: 35.5,
  overPrice: -110,
  underPrice: -110,
  yesPrice: null,
  overNoVigProbability: 0.5,
  underNoVigProbability: 0.5,
  observedAt: updatedAt,
  fetchedAt: updatedAt,
  openingObservedAt: null,
  openingLine: null,
  openingOverPrice: null,
  openingUnderPrice: null,
  openingYesPrice: null,
  scheduledStart: "2026-10-18T17:00:00.000Z",
  lockAt: "2026-10-18T16:00:00.000Z",
  state: "unlocked",
  exactPriceComplete: true,
  gradeEligibleMarket: true,
  healthHolds: [],
};

async function main(): Promise<void> {
  let storedPayload: unknown = null;
  let write: Record<string, unknown> | null = null;
  const client = {
    from(table: string) {
      assert.equal(table, "lab_response_snapshots");
      const query = {
        select(columns: string) {
          assert.equal(columns, "payload");
          return query;
        },
        eq(column: string, value: string) {
          assert.equal(column, "snapshot_key");
          assert.equal(value, "nfl::player-props-reference-offers::2026::6");
          return query;
        },
        async maybeSingle() {
          return { data: storedPayload === null ? null : { payload: storedPayload }, error: null };
        },
        async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          assert.equal(options.onConflict, "snapshot_key");
          write = row;
          storedPayload = row.payload;
          return { error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  await writeNflPlayerPropsReferenceOffers({ client, season: 2026, week: 6, updatedAt, offers: [offer] });
  const persisted = write as unknown as Record<string, unknown>;
  assert.ok(persisted);
  assert.deepEqual({
    snapshot_key: persisted.snapshot_key,
    kind: persisted.kind,
    sport: persisted.sport,
    slate_date: persisted.slate_date,
    payload_version: persisted.payload_version,
    source: persisted.source,
    generated_at: persisted.generated_at,
    expires_at: persisted.expires_at,
    stale_until: persisted.stale_until,
    updated_at: persisted.updated_at,
  }, {
    snapshot_key: "nfl::player-props-reference-offers::2026::6",
    kind: "daily_edge",
    sport: "nfl",
    slate_date: null,
    payload_version: NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
    source: NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
    generated_at: updatedAt,
    expires_at: expiresAt,
    stale_until: expiresAt,
    updated_at: updatedAt,
  }, "the cache writer satisfies every required lab_response_snapshots column");

  const roundTrip = await readNflPlayerPropsReferenceOffers({ client, season: 2026, week: 6 });
  assert.equal(roundTrip?.release, NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE);
  assert.deepEqual(roundTrip?.offers, [offer]);

  const failingClient = {
    from() {
      return {
        async upsert() {
          return { error: { message: "database unavailable" } };
        },
      };
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    writeNflPlayerPropsReferenceOffers({
      client: failingClient, season: 2026, week: 6, updatedAt, offers: [offer],
    }),
    /NFL props reference-offer write failed: database unavailable/,
  );
}

main()
  .then(() => console.log("NFL player props reference-offer store tests passed."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
