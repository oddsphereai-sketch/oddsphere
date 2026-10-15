import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";

export const NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE =
  "nfl_player_props_reference_offer_store_2026_10_15_r3_snapshot_schema" as const;
export const NFL_PLAYER_PROPS_REFERENCE_OFFER_MAXIMUM = 2_500 as const;
export const NFL_PLAYER_PROPS_REFERENCE_OFFER_MAXIMUM_JSON_BYTES = 4_000_000 as const;

type ReferenceOfferSnapshot = Readonly<{
  release: typeof NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE;
  season: number;
  week: number;
  updatedAt: string;
  offers: readonly NflPlayerPropsExactOffer[];
}>;

export async function readNflPlayerPropsReferenceOffers(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<ReferenceOfferSnapshot | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", key(args.season, args.week))
    .maybeSingle();
  if (error) throw new Error(`NFL props reference-offer read failed: ${error.message}`);
  return parse(data?.payload, args.season, args.week);
}

export async function writeNflPlayerPropsReferenceOffers(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  updatedAt: string;
  offers: readonly NflPlayerPropsExactOffer[];
}): Promise<void> {
  const snapshot: ReferenceOfferSnapshot = {
    release: NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
    season: args.season,
    week: args.week,
    updatedAt: args.updatedAt,
    offers: [...args.offers],
  };
  validate(snapshot);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (bytes > NFL_PLAYER_PROPS_REFERENCE_OFFER_MAXIMUM_JSON_BYTES) {
    throw new Error(`NFL props reference-offer snapshot exceeds ${NFL_PLAYER_PROPS_REFERENCE_OFFER_MAXIMUM_JSON_BYTES} bytes.`);
  }
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: key(args.season, args.week),
    kind: "daily_edge",
    sport: "nfl",
    slate_date: null,
    payload: snapshot,
    payload_version: NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
    source: NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE,
    generated_at: args.updatedAt,
    expires_at: new Date(Date.parse(args.updatedAt) + 14 * 24 * 3_600_000).toISOString(),
    stale_until: new Date(Date.parse(args.updatedAt) + 14 * 24 * 3_600_000).toISOString(),
    updated_at: args.updatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NFL props reference-offer write failed: ${error.message}`);
}

function parse(value: unknown, season: number, week: number): ReferenceOfferSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as ReferenceOfferSnapshot;
  if (snapshot.release !== NFL_PLAYER_PROPS_REFERENCE_OFFER_STORE_RELEASE
    || snapshot.season !== season || snapshot.week !== week) return null;
  validate(snapshot);
  return snapshot;
}

function validate(snapshot: ReferenceOfferSnapshot): void {
  if (!Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error("NFL props reference-offer timestamp is invalid.");
  if (!Array.isArray(snapshot.offers) || snapshot.offers.length > NFL_PLAYER_PROPS_REFERENCE_OFFER_MAXIMUM) {
    throw new Error("NFL props reference-offer count is invalid.");
  }
  for (const offer of snapshot.offers) {
    const book = offer.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (book !== "pinnacle" && book !== "novig") throw new Error("NFL props reference-offer source is invalid.");
    if (!offer.exactPriceComplete || !offer.gradeEligibleMarket) throw new Error("NFL props reference-offer is incomplete.");
    if (!Number.isFinite(Date.parse(offer.observedAt))) throw new Error("NFL props reference-offer observation time is invalid.");
  }
}

function key(season: number, week: number): string {
  return `nfl::player-props-reference-offers::${season}::${week}`;
}
