import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlaybookLineGame, PlaybookSplitGame } from "@/lib/providers/playbook/types";
import type {
  NflPreviewBookOdds,
  NflPreviewGame,
  NflRegularProviderSlate,
} from "./balldontlieNflPreviewSlate";

export const NFL_REGULAR_MARKET_EVIDENCE_RELEASE =
  "nfl_regular_market_evidence_2026_08_20_r2" as const;

export type NflRegularConsensusMarket = "moneyline" | "spread" | "total";

export type NflRegularConsensusSplit = {
  provider: "playbook";
  providerGameId: string;
  capturedAt: string;
  booksUsed: number | null;
  homeMoneyPct: number | null;
  awayMoneyPct: number | null;
  homeBetsPct: number | null;
  awayBetsPct: number | null;
  overMoneyPct: number | null;
  underMoneyPct: number | null;
  overBetsPct: number | null;
  underBetsPct: number | null;
};

export type NflRegularConsensusLine = {
  provider: "playbook";
  providerGameId: string;
  capturedAt: string;
  sourceTier: string | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  total: number | null;
};

export type NflRegularMarketEvidence = {
  evidenceRelease: typeof NFL_REGULAR_MARKET_EVIDENCE_RELEASE;
  season: 2026;
  week: number;
  capturedAt: string;
  scheduleRelease: string;
  games: NflPreviewGame[];
  currentOddsByGame: Record<string, NflPreviewBookOdds>;
  providerOpeningOddsByGame: Record<string, NflPreviewBookOdds>;
  priceHistoryByGame: Record<string, NflPreviewBookOdds[]>;
  consensusLinesByGame: Record<string, NflRegularConsensusLine>;
  consensusSplitsByGame: Record<string, Record<NflRegularConsensusMarket, NflRegularConsensusSplit>>;
  coverage: {
    games: number;
    currentNamedBookPairs: number;
    providerOpenings: number;
    operationalOpenings: number;
    minimumNamedBookObservations: number;
    consensusLines: number;
    consensusSplits: number;
  };
  requestBudget: {
    balldontlie: number;
    playbook: 2;
    total: number;
  };
};

type EvidencePointer = {
  evidenceRelease: typeof NFL_REGULAR_MARKET_EVIDENCE_RELEASE;
  filename: string;
  sha256: string;
  season: 2026;
  week: number;
  capturedAt: string;
};

export async function readCurrentNflRegularMarketEvidence(
  week: number,
): Promise<{ payload: NflRegularMarketEvidence; pointer: EvidencePointer }> {
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const pointer = JSON.parse(await readFile(
    path.join(root, `nfl_regular_2026_week_${week}.market-evidence.latest.json`),
    "utf8",
  )) as EvidencePointer;
  if (
    pointer.evidenceRelease !== NFL_REGULAR_MARKET_EVIDENCE_RELEASE ||
    pointer.season !== 2026 ||
    pointer.week !== week ||
    typeof pointer.filename !== "string" ||
    typeof pointer.sha256 !== "string"
  ) {
    throw new Error("Invalid NFL regular market-evidence pointer.");
  }
  const bytes = await readFile(path.join(root, pointer.filename));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== pointer.sha256) throw new Error("NFL regular market-evidence checksum mismatch.");
  const payload = JSON.parse(bytes.toString("utf8")) as NflRegularMarketEvidence;
  const gameIds = payload.games.map((game) => game.providerGameId);
  if (
    payload.evidenceRelease !== NFL_REGULAR_MARKET_EVIDENCE_RELEASE ||
    payload.season !== 2026 ||
    payload.week !== week ||
    payload.coverage.games !== gameIds.length ||
    gameIds.some((gameId) => !payload.currentOddsByGame[gameId]) ||
    gameIds.some((gameId) => (payload.priceHistoryByGame[gameId]?.length ?? 0) === 0)
  ) {
    throw new Error("NFL regular market-evidence contract mismatch.");
  }
  return { payload, pointer };
}

export function matchPlaybookRows<T extends PlaybookLineGame | PlaybookSplitGame>(
  games: NflPreviewGame[],
  rows: T[],
): Record<string, T> {
  const matched: Record<string, T> = {};
  for (const game of games) {
    const candidates = rows.filter((row) =>
      sameTeam(row.homeTeamName, game.home.name) &&
      sameTeam(row.awayTeamName, game.away.name) &&
      startsNear(row.startTime ?? row.startTimeEst, game.scheduledStart)
    );
    if (candidates.length !== 1) {
      throw new Error(
        `Playbook NFL identity match failed for ${game.away.abbreviation}@${game.home.abbreviation}; matches=${candidates.length}.`,
      );
    }
    matched[game.providerGameId] = candidates[0]!;
  }
  return matched;
}

export function overlayNflRegularMarketEvidence(
  slate: NflRegularProviderSlate,
  evidence: NflRegularMarketEvidence,
): NflRegularProviderSlate {
  const expected = slate.games.map((game) => game.providerGameId).sort().join("|");
  const observed = evidence.games.map((game) => game.providerGameId).sort().join("|");
  if (slate.season !== evidence.season || slate.providerWeek !== evidence.week || expected !== observed) {
    throw new Error("NFL provider slate and market-evidence identities do not match.");
  }
  return {
    ...slate,
    fetchedAt: evidence.capturedAt,
    currentOddsByGame: evidence.currentOddsByGame,
    openingOddsByGame: evidence.providerOpeningOddsByGame,
    providerRequests: evidence.requestBudget.balldontlie,
  };
}

function sameTeam(first: unknown, second: unknown): boolean {
  if (typeof first !== "string" || typeof second !== "string") return false;
  return normalizedTeam(first) === normalizedTeam(second);
}

function normalizedTeam(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function startsNear(first: unknown, second: string): boolean {
  if (typeof first !== "string") return false;
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  return Number.isFinite(firstTime) && Number.isFinite(secondTime) && Math.abs(firstTime - secondTime) <= 12 * 60 * 60_000;
}
