export type PlayGradeLabel = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";

export type MarketReadStatus =
  | "aligned"
  | "mixed"
  | "resistance"
  | "consensus_support"
  | "consensus_resistance"
  | "no_clear_signal"
  | "insufficient_data";

export type SplitSideDisplay = {
  side: "home" | "draw" | "away" | "over" | "under" | "yes" | "no";
  label: string;
  moneyPct: number | null;
  betsPct: number | null;
  observedAt?: string | null;
  /** When the collector last verified this source value, if different from its last-change time. */
  freshnessCheckedAt?: string | null;
  /** Source-specific collection cadence plus scheduling grace. Defaults to the shared split TTL. */
  staleAfterMinutes?: number;
  isStale?: boolean;
};

export type MarketSplitDisplaySection = {
  label: "Consensus Splits" | "DraftKings Splits" | "BetMGM Splits" | "Sharp Book Splits" | "Sharp Book Signal";
  rows: SplitSideDisplay[];
  signal: string | null;
  lastUpdated: string | null;
};

export type ResolvedMarketRead = {
  status: MarketReadStatus;
  label: "Market Support" | "Market Resistance" | "Mixed" | "Consensus Support" | "Consensus Resistance" | "No Clear Signal";
  copy: string;
  tone: "emerald" | "amber" | "gray";
};

export type MarketDecision = {
  pick: string | null;
  modelProbability: number | null;
  marketImplied: number | null;
  edgePp: number | null;
  price: number | null;
  projectedScore?: { away: number; home: number } | null;
  consensusSplits: MarketSplitDisplaySection | null;
  sharpBookSplits: MarketSplitDisplaySection | null;
  lineMovement: "support" | "resistance" | "neutral" | null;
  resolvedMarketRead: ResolvedMarketRead;
  sourceConflict: boolean;
  playGrade: PlayGradeLabel;
  quickRead: string;
  supportingEvidence: string[];
  riskNote: string;
  renderedQuickReadCopy?: string | null;
  renderedSupportingEvidenceCopy?: string | null;
  renderedRiskCopy?: string | null;
  reasonCodes: string[];
};

export type RecommendationDecision = {
  sport: string;
  slateDate: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  markets: {
    moneyline?: MarketDecision;
    total?: MarketDecision;
    spread?: MarketDecision;
    firstInning?: MarketDecision;
    doubleChance?: MarketDecision;
    btts?: MarketDecision;
  };
  sourceState: {
    consensusSplitsAvailable: boolean;
    sharpBookSplitsAvailable: boolean;
    staleSources: string[];
    missingExpectedSources: string[];
    sourceConflict: boolean;
  };
  audit: {
    deterministicStatus: "pass" | "warn" | "block";
    aiStatus?: "pass" | "warn" | "block" | "skipped";
    payloadHash: string;
    lastAuditedAt?: string;
    canPublish: boolean;
  };
};
