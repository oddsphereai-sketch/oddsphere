/** Read-only release and decision audit for the live NBA member pipeline. */

import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";

const dates = process.argv.slice(2);
const compact = dates.includes("--compact");
const slateDates = dates.filter((value) => value !== "--compact");
if (slateDates.length === 0) {
  throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");
}

async function main(): Promise<void> {
const slates = [];
for (const date of slateDates) {
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
          reads?: Record<string, { status?: string; side?: string | null; reason?: string; trails?: unknown[]; flows?: unknown[] }>;
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
              trails: read.trails?.length ?? 0,
              flows: read.flows?.length ?? 0,
            },
          ])),
        decision: audit?.market_reader_decision ?? null,
      };
    }),
  });
}

const games = slates.flatMap((slate) => slate.games);
const markets = ["moneyline", "spread", "total"] as const;
const report = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  dates: slateDates,
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
};
console.log(JSON.stringify(compact ? {
  ...report.summary,
  dates: report.dates,
  marketMarriageReleases: [...new Set(games.map((game) => game.marketMarriageRelease))],
  effects: {
    winnerFlips: games.filter((game) => (game.decision as { effects?: { moneyline?: string } } | null)
      ?.effects?.moneyline === "flipped_by_validated_spread_score").length,
    spreadFlips: games.filter((game) => (game.decision as { effects?: { spread?: string } } | null)
      ?.effects?.spread === "flipped_by_validated_spread_read").length,
    totalFlips: games.filter((game) => (game.decision as { effects?: { total?: string } } | null)
      ?.effects?.total === "flipped_by_validated_total_read").length,
  },
  reasons: Object.fromEntries(markets.map((market) => [market, Object.fromEntries(
    [...new Set(games.map((game) => game.reads?.[market]?.reason ?? "missing"))].sort().map((reason) => [
      reason,
      games.filter((game) => (game.reads?.[market]?.reason ?? "missing") === reason).length,
    ]),
  )])),
  evidenceRows: Object.fromEntries(markets.map((market) => [market, {
    trails: games.reduce((sum, game) => sum + Number(game.reads?.[market]?.trails ?? 0), 0),
    flows: games.reduce((sum, game) => sum + Number(game.reads?.[market]?.flows ?? 0), 0),
  }])),
} : report, null, 2));
}

void main();
