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

function isSafeStoredOnlyMarket(rows: LockComparableRow[]): boolean {
  // The first-inning writer intentionally omits a row from `proposed` when
  // fresh data cannot support a current prediction. An existing member row
  // may still truthfully remain as a held Toss-Up. That fail-closed row should
  // freeze with the game instead of blocking otherwise coherent ML/total
  // records. Never tolerate an extra actionable or picked market here.
  return rows.length === 1
    && rows[0]?.market === "first_inning"
    && rows[0]?.no_bet === true
    && (rows[0]?.pick === null || rows[0]?.pick === "Toss-Up");
}

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
    const missingMarkets = expectedMarkets.filter((market) => !storedMarkets.includes(market));
    if (missingMarkets.length > 0) {
      gameErrors.push(`missing stored markets=${missingMarkets.join(",")} expected=${expectedMarkets.join(",")} stored=${storedMarkets.join(",")}`);
    }
    for (const market of storedMarkets.filter((value) => !expectedMarkets.includes(value))) {
      const storedOnlyRows = stored.filter((row) => row.market === market);
      if (!isSafeStoredOnlyMarket(storedOnlyRows)) {
        gameErrors.push(`unexpected stored market=${market} is not a held first-inning Toss-Up`);
      }
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
