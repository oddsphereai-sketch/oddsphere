export type MarketIntelligenceMarketType = "moneyline" | "spread" | "total";
export type MarketIntelligenceSelectionSide = "home" | "away" | "over" | "under";

export type MarketSplitProvider = "playbook" | "sharpapi";
export type MarketSplitSourceBook =
  | "consensus"
  | "draftkings"
  | "circa"
  | "betmgm";
export type MarketSplitSourceType =
  | "multi_book_consensus"
  | "retail_book"
  | "sharp_adjacent_book";

export type MarketSplitObservationV2 = {
  canonical_event_id: string;
  canonical_market_id: string;
  league: string;
  market_type: MarketIntelligenceMarketType;
  selection_key: string;
  provider: MarketSplitProvider;
  source_book: MarketSplitSourceBook;
  source_type: MarketSplitSourceType;
  /** Normalized 0..1. Null means unavailable, never neutral. */
  bets_pct: number | null;
  /** Normalized 0..1. Null means unavailable, never neutral. */
  money_pct: number | null;
  market_line: number | null;
  market_price: number | null;
  books_used: number | null;
  provider_event_id: string | null;
  source_observed_at: string | null;
  fetched_at: string;
  source_timestamp_verified: boolean;
  minutes_to_start: number | null;
  raw_payload_hash: string;
  inserted_at?: string;
};

export type MarketPriceObservationV2 = {
  canonical_event_id: string;
  canonical_market_id: string;
  league: string;
  sportsbook: string;
  sharp_book: boolean;
  market_type: MarketIntelligenceMarketType;
  selection_key: string;
  line: number | null;
  american_price: number | null;
  decimal_price: number | null;
  no_vig_probability: number | null;
  provider_timestamp: string | null;
  fetched_at: string;
  minutes_to_start: number | null;
};

export type CanonicalObservationRejection = {
  provider: MarketSplitProvider | "sharpapi_odds";
  provider_event_id: string | null;
  market_type: MarketIntelligenceMarketType | null;
  selection_key: string | null;
  reason: string;
};
