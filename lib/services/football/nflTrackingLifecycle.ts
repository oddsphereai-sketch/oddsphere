import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { footballTrackingEligibility } from "./footballTrackingPolicy";

export const NFL_TRACKING_LIFECYCLE_RELEASE =
  "nfl_tracking_lifecycle_shadow_2026_08_20_r2" as const;

export type NflTrackedMarket = "moneyline" | "spread" | "total";

export type NflTrackingProposal = {
  lifecycleRelease: typeof NFL_TRACKING_LIFECYCLE_RELEASE;
  sport: "nfl";
  season: 2026;
  seasonPhase: "preseason" | "regular" | "postseason";
  week: number;
  gameId: string;
  providerGameId: number;
  awayTeam: string;
  homeTeam: string;
  gameStartAt: string;
  lockedAt: string;
  market: NflTrackedMarket;
  pick: string;
  line: number | null;
  priceAmerican: number;
  modelProbability: number;
  marketProbability: number;
  playGrade: string;
  projectionRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  trackingEligible: boolean;
  appendToExistingLifetime: boolean;
  trackingReason: string;
};

export type NflTrackingSettlement = {
  gameId: string;
  market: NflTrackedMarket;
  outcome: "win" | "loss" | "push" | "void";
  finalAwayScore: number;
  finalHomeScore: number;
};

export function buildNflTrackingProposals(args: {
  snapshot: DailyEdgeResponse;
  seasonPhase: "preseason" | "regular" | "postseason";
  week: number;
  lockedAt: string | Readonly<Record<string, string>>;
  modelApproved: boolean;
  officialRegistryLaunched: boolean;
  projectionRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
}): NflTrackingProposal[] {
  if (args.snapshot.sport !== "nfl") throw new Error("NFL tracking lifecycle received a non-NFL snapshot.");
  if (args.snapshot.games.length === 0) throw new Error("NFL tracking lock received an empty weekly card.");
  const rows = args.snapshot.games.flatMap((game) => {
    const start = game.gameStartAt ?? null;
    if (!start || !Number.isFinite(Date.parse(start))) throw new Error(`NFL game ${game.id} is missing a valid start time.`);
    const lockedAt = typeof args.lockedAt === "string" ? args.lockedAt : args.lockedAt[game.id];
    const lockedAtMs = Date.parse(lockedAt ?? "");
    if (!lockedAt || !Number.isFinite(lockedAtMs)) {
      throw new Error(`NFL game ${game.id} is missing an actual ISO lock timestamp.`);
    }
    const lockedBeforeKickoff = lockedAtMs < Date.parse(start);
    return [
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "moneyline", game.markets.moneyline),
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "total", game.markets.total),
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "spread", game.markets.first_inning),
    ].map((row) => {
      const eligibility = footballTrackingEligibility({
        seasonPhase: args.seasonPhase,
        modelApproved: args.modelApproved,
        officialRegistryLaunched: args.officialRegistryLaunched,
        predictionLocked: lockedBeforeKickoff,
      });
      return {
        ...row,
        lifecycleRelease: NFL_TRACKING_LIFECYCLE_RELEASE,
        sport: "nfl" as const,
        season: 2026 as const,
        seasonPhase: args.seasonPhase,
        week: args.week,
        lockedAt,
        projectionRelease: args.projectionRelease,
        calibrationRelease: args.calibrationRelease,
        decisionRelease: args.decisionRelease,
        trackingEligible: eligibility.eligible,
        appendToExistingLifetime: eligibility.appendToExistingLifetime,
        trackingReason: eligibility.reason,
      };
    });
  });
  const expectedRows = args.snapshot.games.length * 3;
  if (rows.length !== expectedRows || new Set(rows.map((row) => `${row.gameId}:${row.market}`)).size !== expectedRows) {
    throw new Error(`NFL tracking lifecycle must produce exactly three unique markets per game; expected ${expectedRows}.`);
  }
  return rows;
}

export function settleNflTrackingProposal(
  row: NflTrackingProposal,
  final: { awayScore: number; homeScore: number; status: "final" | "canceled" | "postponed" },
): NflTrackingSettlement {
  if (final.status !== "final") {
    return settlement(row, "void", final.awayScore, final.homeScore);
  }
  const away = Number(final.awayScore);
  const home = Number(final.homeScore);
  if (!Number.isFinite(away) || !Number.isFinite(home)) return settlement(row, "void", away, home);
  if (row.market === "moneyline") {
    if (away === home) return settlement(row, "push", away, home);
    const winner = home > away ? row.homeTeam : row.awayTeam;
    return settlement(row, normalizeTeam(row.pick) === normalizeTeam(winner) ? "win" : "loss", away, home);
  }
  if (row.market === "total") {
    if (row.line === null) return settlement(row, "void", away, home);
    const difference = away + home - row.line;
    if (difference === 0) return settlement(row, "push", away, home);
    const over = /^over\b/i.test(row.pick);
    return settlement(row, (over ? difference > 0 : difference < 0) ? "win" : "loss", away, home);
  }
  if (row.line === null) return settlement(row, "void", away, home);
  const selectedHome = normalizeTeam(row.pick) === normalizeTeam(row.homeTeam);
  const selectedScore = selectedHome ? home : away;
  const opponentScore = selectedHome ? away : home;
  const difference = selectedScore + row.line - opponentScore;
  return settlement(row, difference === 0 ? "push" : difference > 0 ? "win" : "loss", away, home);
}

function proposal(
  gameId: string,
  providerGameId: number,
  awayTeam: string,
  homeTeam: string,
  gameStartAt: string,
  market: NflTrackedMarket,
  value: MarketEdgeDto,
) {
  if (
    !value.pick ||
    value.priceAmerican === null ||
    value.modelProb === null ||
    value.marketFairProb === null
  ) {
    throw new Error(`NFL tracking proposal is incomplete for ${gameId}/${market}.`);
  }
  return {
    gameId,
    providerGameId,
    awayTeam,
    homeTeam,
    gameStartAt,
    market,
    pick: value.pick,
    line: value.line,
    priceAmerican: value.priceAmerican,
    modelProbability: value.modelProb,
    marketProbability: value.marketFairProb,
    playGrade: value.verdict.label,
  };
}

function settlement(row: NflTrackingProposal, outcome: NflTrackingSettlement["outcome"], away: number, home: number): NflTrackingSettlement {
  return { gameId: row.gameId, market: row.market, outcome, finalAwayScore: away, finalHomeScore: home };
}

function normalizeTeam(value: string): string {
  return value.trim().split(/\s+/)[0]!.toUpperCase();
}
