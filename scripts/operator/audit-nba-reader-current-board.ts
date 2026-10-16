/** Read-only release and decision audit for the live NBA member pipeline. */

import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";

const dates = process.argv.slice(2);
if (dates.length === 0) {
  throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");
}

async function main(): Promise<void> {
const slates = [];
for (const date of dates) {
  const { nbaDto } = await buildNbaDailyEdgePipeline(date);
  slates.push({
    date,
    games: nbaDto.games.map((game) => {
      const audit = game.grounding_audit as {
        release?: string;
        market_reader?: {
          release?: string;
          evidenceStatus?: string;
          evidenceErrors?: string[];
          reads?: Record<string, { status?: string; side?: string | null; reason?: string }>;
        };
        market_reader_decision?: unknown;
      } | null;
      return {
        gameExternalId: game.game_external_id,
        matchup: `${game.away_abbr}@${game.home_abbr}`,
        finalScore: game.projection,
        picks: {
          moneyline: game.intelligence.ml.pick_side,
          spread: game.intelligence.spread.pick_side,
          total: game.intelligence.total.pick_side,
        },
        marketMarriageRelease: audit?.release ?? null,
        readerRelease: audit?.market_reader?.release ?? null,
        readerEvidenceStatus: audit?.market_reader?.evidenceStatus ?? null,
        readerEvidenceErrors: audit?.market_reader?.evidenceErrors ?? [],
        reads: audit?.market_reader?.reads === undefined
          ? null
          : Object.fromEntries(Object.entries(audit.market_reader.reads).map(([market, read]) => [
            market,
            {
              status: read.status ?? null,
              side: read.side ?? null,
              reason: read.reason ?? null,
            },
          ])),
        decision: audit?.market_reader_decision ?? null,
      };
    }),
  });
}

const games = slates.flatMap((slate) => slate.games);
const markets = ["moneyline", "spread", "total"] as const;
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  readOnly: true,
  dates,
  summary: {
    games: games.length,
    completeEvidence: games.filter((game) => game.readerEvidenceStatus === "complete").length,
    decisionsPresent: games.filter((game) => game.decision !== null).length,
    qualifiedReads: Object.fromEntries(markets.map((market) => [
      market,
      games.filter((game) => game.reads?.[market]?.status === "qualified").length,
    ])),
  },
  slates,
}, null, 2));
}

void main();
