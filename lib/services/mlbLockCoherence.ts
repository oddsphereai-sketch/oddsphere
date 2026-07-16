type LockComparableRow = {
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
};

const FIELDS = [
  "pick",
  "side",
  "odds_american",
  "confidence",
  "play_grade",
  "best_angle",
  "no_bet",
] as const;

export function assessMlbLockCoherence(args: {
  gameIds: number[];
  expectedRows: LockComparableRow[];
  storedRows: LockComparableRow[];
}): {
  checked: number;
  coherentGameIds: number[];
  blockedGameIds: number[];
  errors: string[];
} {
  const coherentGameIds: number[] = [];
  const blockedGameIds: number[] = [];
  const errors: string[] = [];

  for (const gameId of args.gameIds) {
    const expected = args.expectedRows.filter((row) => row.game_id === gameId);
    const stored = args.storedRows.filter((row) => row.game_id === gameId);
    const expectedMarkets = [...new Set(expected.map((row) => row.market))].sort();
    const storedMarkets = [...new Set(stored.map((row) => row.market))].sort();
    const gameErrors: string[] = [];

    if (expected.length === 0) gameErrors.push("writer proposed no member records");
    if (JSON.stringify(expectedMarkets) !== JSON.stringify(storedMarkets)) {
      gameErrors.push(`market set differs expected=${expectedMarkets.join(",")} stored=${storedMarkets.join(",")}`);
    }

    for (const expectedRow of expected) {
      const storedRow = stored.find((row) => row.market === expectedRow.market);
      if (!storedRow) continue;
      for (const field of FIELDS) {
        if (storedRow[field] !== expectedRow[field]) {
          gameErrors.push(`${expectedRow.market}.${field} expected=${String(expectedRow[field])} stored=${String(storedRow[field])}`);
        }
      }
    }

    if (gameErrors.length === 0) {
      coherentGameIds.push(gameId);
    } else {
      blockedGameIds.push(gameId);
      errors.push(...gameErrors.map((error) => `game_id=${gameId}: ${error}`));
    }
  }

  return { checked: args.gameIds.length, coherentGameIds, blockedGameIds, errors };
}
