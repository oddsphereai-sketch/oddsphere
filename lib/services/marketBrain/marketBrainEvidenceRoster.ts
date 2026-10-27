import {
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_REGISTRY,
  type MarketBrainActiveProductKey,
} from "./marketBrainProductRegistry";

export const MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE =
  "market_brain_evidence_roster_2026_10_27_r2_complete_product_inventory" as const;

export const MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS = Object.freeze([
  "absolute_handle",
  "ticket_count",
  "bet_size_distribution",
  "book_limits",
  "move_origin",
  "suspension_lifecycle",
  "private_order_flow",
] as const);

export type MarketBrainTrueProviderBlindSpot = typeof MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS[number];

export type MarketBrainExpectedFeed = Readonly<{
  provider: string;
  feed: string;
  participant: string | null;
  phases: readonly ("provider_opening" | "current")[];
  expectation: "required" | "opportunistic";
  replayMode: "raw_replayable" | "normalized_only";
}>;

export type MarketBrainExpectedParticipant = Readonly<{
  provider: string;
  participant: string;
  expectation: "required" | "opportunistic";
}>;

export type MarketBrainEvidenceRoster = Readonly<{
  release: typeof MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE;
  product: MarketBrainActiveProductKey;
  coverageStatus: "not_started" | "partial" | "complete";
  coveredEvidenceFamilies: readonly string[];
  unresolvedEvidenceFamilies: readonly string[];
  feeds: readonly MarketBrainExpectedFeed[];
  priceParticipants: readonly MarketBrainExpectedParticipant[];
  trueProviderBlindSpots: readonly MarketBrainTrueProviderBlindSpot[];
}>;

export const NFL_MARKET_BRAIN_EVIDENCE_ROSTER: MarketBrainEvidenceRoster = Object.freeze({
  release: MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE,
  product: "nfl_daily_edge",
  coverageStatus: "partial",
  coveredEvidenceFamilies: Object.freeze(["two_sided_prices", "same_book_chronology"]),
  unresolvedEvidenceFamilies: Object.freeze([
    "identified_splits", "public_splits", "availability", "weather",
  ]),
  feeds: Object.freeze([
    feed("balldontlie", "opening_odds", null, ["provider_opening"], "required", "raw_replayable"),
    feed("balldontlie", "current_odds", null, ["current"], "required", "raw_replayable"),
    feed("sharpapi", "main_odds", "circa", ["current"], "required", "raw_replayable"),
    feed("sharpapi", "main_odds", "pinnacle", ["current"], "required", "raw_replayable"),
  ]),
  priceParticipants: Object.freeze([
    participant("balldontlie", "fanduel", "opportunistic"),
    participant("balldontlie", "draftkings", "opportunistic"),
    participant("balldontlie", "caesars", "opportunistic"),
    participant("balldontlie", "betmgm", "opportunistic"),
    participant("balldontlie", "fanatics", "opportunistic"),
    participant("balldontlie", "betrivers", "opportunistic"),
    participant("sharpapi", "circa", "required"),
    participant("sharpapi", "pinnacle", "required"),
  ]),
  trueProviderBlindSpots: MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS,
});

export const MARKET_BRAIN_EVIDENCE_ROSTERS: Readonly<Record<
  MarketBrainActiveProductKey,
  MarketBrainEvidenceRoster
>> = Object.freeze(Object.fromEntries(MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.map((product) => [
  product,
  product === "nfl_daily_edge" ? NFL_MARKET_BRAIN_EVIDENCE_ROSTER : pendingRoster(product),
])) as unknown as Record<MarketBrainActiveProductKey, MarketBrainEvidenceRoster>);

export function assertMarketBrainEvidenceRoster(roster: MarketBrainEvidenceRoster): void {
  const feedKeys = roster.feeds.map((row) => [row.provider, row.feed, row.participant ?? "*"].join("|"));
  const participantKeys = roster.priceParticipants.map((row) => `${row.provider}|${row.participant}`);
  if (roster.release !== MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE ||
    new Set(feedKeys).size !== feedKeys.length || new Set(participantKeys).size !== participantKeys.length ||
    new Set([...roster.coveredEvidenceFamilies, ...roster.unresolvedEvidenceFamilies]).size !==
      roster.coveredEvidenceFamilies.length + roster.unresolvedEvidenceFamilies.length ||
    (roster.coverageStatus === "not_started" &&
      (roster.coveredEvidenceFamilies.length > 0 || roster.feeds.length > 0 || roster.priceParticipants.length > 0)) ||
    (roster.coverageStatus !== "not_started" &&
      (roster.coveredEvidenceFamilies.length === 0 || roster.feeds.length === 0 || roster.priceParticipants.length === 0)) ||
    (roster.coverageStatus === "complete" && roster.unresolvedEvidenceFamilies.length > 0) ||
    roster.feeds.some((row) => row.phases.length === 0) ||
    MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS.some((blindSpot) =>
      !roster.trueProviderBlindSpots.includes(blindSpot))) {
    throw new Error(`Market Brain evidence roster is incomplete or ambiguous: ${roster.product}`);
  }
}

export function assertCompleteMarketBrainEvidenceRosterRegistry(): void {
  const keys = Object.keys(MARKET_BRAIN_EVIDENCE_ROSTERS).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...MARKET_BRAIN_ACTIVE_PRODUCT_KEYS].sort())) {
    throw new Error("Market Brain evidence roster registry does not cover every active product.");
  }
  for (const product of MARKET_BRAIN_ACTIVE_PRODUCT_KEYS) {
    const roster = MARKET_BRAIN_EVIDENCE_ROSTERS[product];
    assertMarketBrainEvidenceRoster(roster);
    const declared = [...MARKET_BRAIN_PRODUCT_REGISTRY[product].expectedEvidenceFamilies].sort();
    const accounted = [...roster.coveredEvidenceFamilies, ...roster.unresolvedEvidenceFamilies].sort();
    if (JSON.stringify(declared) !== JSON.stringify(accounted)) {
      throw new Error(`Market Brain evidence-family inventory diverged: ${product}`);
    }
    if (MARKET_BRAIN_PRODUCT_REGISTRY[product].adapterState !== "not_started" &&
      roster.coverageStatus === "not_started") {
      throw new Error(`Started Market Brain adapter has no evidence roster: ${product}`);
    }
  }
}

function pendingRoster(product: MarketBrainActiveProductKey): MarketBrainEvidenceRoster {
  return Object.freeze({
    release: MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE,
    product,
    coverageStatus: "not_started" as const,
    coveredEvidenceFamilies: Object.freeze([]),
    unresolvedEvidenceFamilies: Object.freeze([
      ...MARKET_BRAIN_PRODUCT_REGISTRY[product].expectedEvidenceFamilies,
    ]),
    feeds: Object.freeze([]),
    priceParticipants: Object.freeze([]),
    trueProviderBlindSpots: MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS,
  });
}

function feed(
  provider: string,
  name: string,
  participantName: string | null,
  phases: MarketBrainExpectedFeed["phases"],
  expectation: MarketBrainExpectedFeed["expectation"],
  replayMode: MarketBrainExpectedFeed["replayMode"],
): MarketBrainExpectedFeed {
  return Object.freeze({ provider, feed: name, participant: participantName,
    phases: Object.freeze([...phases]), expectation, replayMode });
}

function participant(
  provider: string,
  name: string,
  expectation: MarketBrainExpectedParticipant["expectation"],
): MarketBrainExpectedParticipant {
  return Object.freeze({ provider, participant: name, expectation });
}
