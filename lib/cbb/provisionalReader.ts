import { readCbbProvisionalSnapshot, type CbbProvisionalSnapshot } from "./provisionalLifecycle";
import type { cbbObservedPricePaths } from "./owlsMarketEvidence";
import type { cbbCurrentSplitEvidence } from "./owlsSplitEvidence";
import type { CbbGame, CbbMarket } from "./types";

export const CBB_PROVISIONAL_READER_RELEASE = "cbb_candidate_2026_10_29_r1_exact_locked_reader" as const;

type SplitEvidence = ReturnType<typeof cbbCurrentSplitEvidence>;
type PricePath = ReturnType<typeof cbbObservedPricePaths>[number];

/**
 * Private member-reader contract. It reads the exact candidate board; it never
 * derives a pick or grade from a market observation. A locked board outranks
 * every newer unlocked candidate and never inherits post-lock evidence.
 */
export function buildCbbProvisionalReader(args: {
  game: CbbGame;
  locked: CbbProvisionalSnapshot | null;
  unlocked: CbbProvisionalSnapshot | null;
  homeLogo: string | null;
  awayLogo: string | null;
  currentSplits?: SplitEvidence | null;
  currentPricePaths?: PricePath[];
}) {
  const snapshot = readCbbProvisionalSnapshot(args);
  if (!snapshot) return null;
  if (snapshot.gameId !== args.game.id || snapshot.startsAt !== args.game.date ||
    snapshot.board.gameId !== args.game.id || snapshot.board.rows.length !== 3 ||
    new Set(snapshot.board.rows.map(row => row.market)).size !== 3) {
    throw new Error("CBB reader game or market identity mismatch");
  }
  const board = snapshot.board;
  const score = board.score;
  if (![score.home, score.away, score.margin, score.total, score.homeWinProbability].every(Number.isFinite) ||
    Math.abs(score.home - score.away - score.margin) > 1e-8 ||
    Math.abs(score.home + score.away - score.total) > 1e-8) {
    throw new Error("CBB reader score is incoherent");
  }
  const locked = snapshot.lockedAt !== null;
  // We do not currently persist a market-evidence panel in the lock payload.
  // After lock, omit it rather than attach today's splits or movement to an
  // earlier public record.
  const splits = locked ? [] : args.currentSplits?.rows ?? [];
  const paths = locked ? [] : args.currentPricePaths ?? [];
  const markets = board.rows.map(row => {
    const market: CbbMarket = row.market;
    const side = row.selection === null ? null : market === "total"
      ? row.selection === "first" ? "Over" : "Under"
      : row.selection === "first" ? args.game.home_team.full_name : args.game.visitor_team.full_name;
    const selectedLine = row.line === null ? null : market === "spread" && row.selection === "second"
      ? -row.line : row.line;
    const marketSplits = splits.filter(split => split.market === market);
    const marketPaths = paths.filter(path => path.market === market);
    return {
      market, side, selectedLine, price: row.price, modelProbability: row.probability,
      pushProbability: row.pushProbability, expectedValue: row.expectedValue,
      grade: row.grade, gradeReason: row.reason, targetBook: row.targetBook,
      professionalReferenceState: row.referenceState,
      professionalReferences: row.professionalReferences,
      splits: marketSplits.map(split => ({ sourceBook: split.sourceBook, observedAt: split.observedAt,
        side: market === "total" ? split.selection === "first" ? "Over" : "Under"
          : split.selection === "first" ? args.game.home_team.full_name : args.game.visitor_team.full_name,
        pickedSide: split.selection === row.selection,
        ticketsPct: split.ticketsPct, moneyPct: split.moneyPct,
        moneyMinusTicketsPoints: split.moneyMinusTicketsPoints })),
      pricePaths: marketPaths.map(path => ({ book: path.book, windowStart: path.windowStart,
        windowEnd: path.windowEnd, observations: path.observations,
        distinctStates: path.distinctStates, changes: path.changes,
        trueOpeningKnown: path.trueOpeningKnown, causalLeadership: path.causalLeadership })),
    };
  });
  return {
    release: CBB_PROVISIONAL_READER_RELEASE, modelRelease: board.release,
    gameId: args.game.id, startsAt: snapshot.startsAt,
    home: { id: args.game.home_team.id, name: args.game.home_team.full_name,
      abbreviation: args.game.home_team.abbreviation, logoUrl: args.homeLogo },
    away: { id: args.game.visitor_team.id, name: args.game.visitor_team.full_name,
      abbreviation: args.game.visitor_team.abbreviation, logoUrl: args.awayLogo },
    status: locked ? "locked" as const : "open" as const,
    lockedAt: snapshot.lockedAt, capturedAt: snapshot.capturedAt,
    score: { home: score.home, away: score.away, margin: score.margin, total: score.total,
      homeWinProbability: score.homeWinProbability },
    predictionMarketReader: board.marketContext.predictionReader,
    marketEvidenceState: locked ? "not_stored_at_lock" as const : "current_observations" as const,
    markets,
  };
}
