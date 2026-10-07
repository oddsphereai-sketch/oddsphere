import assert from "node:assert/strict";
import { supabase } from "../../lib/db/supabase";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { readNflForwardMemberSnapshot } from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";
import type { NflPreviewBookOdds } from "../../lib/services/football/balldontlieNflPreviewSlate";

type MarketKey = "moneyline" | "spread" | "total";

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function implied(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function selectedQuote(input: {
  book: NflPreviewBookOdds;
  market: MarketKey;
  side: "home" | "away" | "over" | "under";
  line: number | null;
}): { price: number; line: number | null } | null {
  if (input.market === "moneyline" && (input.side === "home" || input.side === "away")) {
    const pair = input.book.moneyline;
    return pair ? { price: input.side === "home" ? pair.homePrice : pair.awayPrice, line: null } : null;
  }
  if (input.market === "total" && (input.side === "over" || input.side === "under")) {
    const pair = input.book.total;
    if (!pair || input.line === null || Math.abs(pair.line - input.line) >= 0.01) return null;
    return { price: input.side === "over" ? pair.overPrice : pair.underPrice, line: pair.line };
  }
  if (input.market === "spread" && (input.side === "home" || input.side === "away")) {
    const pair = input.book.spread;
    if (!pair) return null;
    const line = input.side === "home" ? pair.homeLine : pair.awayLine;
    if (input.line === null || Math.abs(line - input.line) >= 0.01) return null;
    return { price: input.side === "home" ? pair.homePrice : pair.awayPrice, line };
  }
  return null;
}

function twoWayHold(book: NflPreviewBookOdds, market: MarketKey): number | null {
  const pair = market === "moneyline" ? book.moneyline : market === "spread" ? book.spread : book.total;
  if (!pair) return null;
  if (market === "moneyline") {
    const prices = pair as NonNullable<NflPreviewBookOdds["moneyline"]>;
    return implied(prices.homePrice) + implied(prices.awayPrice);
  }
  if (market === "spread") {
    const prices = pair as NonNullable<NflPreviewBookOdds["spread"]>;
    return implied(prices.homePrice) + implied(prices.awayPrice);
  }
  const prices = pair as NonNullable<NflPreviewBookOdds["total"]>;
  return implied(prices.overPrice) + implied(prices.underPrice);
}

async function main(): Promise<void> {
  const season = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
  const week = resolveNflForwardWeek({
    season,
    configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
  });
  const [evidence, member] = await Promise.all([
    readNflForwardEvidence({ client: supabase, season, week }),
    readNflForwardMemberSnapshot({ client: supabase, season, week }),
  ]);
  assert.ok(member, `missing NFL member snapshot for ${season} week ${week}`);
  const candidateFixture = buildNflWeekOneHeldMemberFixture(evidence);
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row);
  }

  const findings: Array<Record<string, unknown>> = [];
  for (const game of candidateFixture.snapshot.games) {
    const providerGameId = game.id.replace(/^nfl-/, "");
    const row = latest.get(providerGameId);
    assert.ok(row, `missing latest evidence for ${game.id}`);
    const books = row.payload.market.currentBooks;
    for (const book of books) {
      for (const market of ["moneyline", "spread", "total"] as const) {
        const hold = twoWayHold(book, market);
        if (hold !== null && (hold < 0.94 || hold > 1.20)) {
          findings.push({ severity: "source_pair", game: game.id, sportsbook: book.sportsbook, market, hold });
        }
      }
    }
    const mappings = [
      { slot: "moneyline" as const, market: "moneyline" as const },
      { slot: "first_inning" as const, market: "spread" as const },
      { slot: "total" as const, market: "total" as const },
    ];
    for (const mapping of mappings) {
      const card = game.markets[mapping.slot];
      assert.ok(card.pick, `${game.id} ${mapping.market} is missing its published pick`);
      const side = mapping.market === "moneyline" || mapping.market === "spread"
        ? (card.pick.startsWith(row.payload.game.home.abbreviation) ? "home" : "away")
        : (card.pick.toLowerCase().startsWith("over") ? "over" : "under");
      const line = mapping.market === "moneyline"
        ? null
        : Number(card.pick.match(/[-+]?\d+(?:\.\d+)?$/)?.[0]);
      const bookName = card.currentPriceSportsbook;
      const exactBook = books.find((book) => book.sportsbook === bookName);
      const exact = exactBook ? selectedQuote({ book: exactBook, market: mapping.market, side, line }) : null;
      const candidatePrices = books.flatMap((book) => {
        const quote = selectedQuote({ book, market: mapping.market, side, line });
        return quote ? [quote.price] : [];
      });
      const center = candidatePrices.length > 0
        ? median(candidatePrices.map(implied))
        : null;
      const mapped = exact !== null && exact.price === card.currentPriceAmerican;
      const outlier = center !== null && Math.abs(implied(card.currentPriceAmerican!) - center) > 0.08;
      if (!mapped || outlier) {
        findings.push({
          severity: !mapped ? "mapping" : "outlier",
          game: game.id,
          matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
          market: mapping.market,
          pick: card.pick,
          sportsbook: bookName,
          publishedPrice: card.currentPriceAmerican,
          exact,
          medianImpliedProbability: center,
        });
      }
    }
  }

  const liveEaglesJaguars = member.fixture.snapshot.games.find((game) => game.id === "nfl-1392281");
  const eaglesJaguars = candidateFixture.snapshot.games.find((game) => game.id === "nfl-1392281");
  const publishedChanges: Array<Record<string, unknown>> = [];
  for (const game of candidateFixture.snapshot.games) {
    const prior = member.fixture.snapshot.games.find((candidate) => candidate.id === game.id);
    if (!prior) {
      publishedChanges.push({ game: game.id, market: "game", before: null, after: "added" });
      continue;
    }
    const markets = [
      ["moneyline", prior.markets.moneyline, game.markets.moneyline],
      ["total", prior.markets.total, game.markets.total],
      ["spread", prior.markets.first_inning, game.markets.first_inning],
    ] as const;
    for (const [market, before, after] of markets) {
      if (before.pick === after.pick &&
          before.currentPriceAmerican === after.currentPriceAmerican &&
          before.currentPriceSportsbook === after.currentPriceSportsbook &&
          before.verdict.label === after.verdict.label) continue;
      publishedChanges.push({
        game: game.id,
        market,
        before: {
          pick: before.pick,
          price: before.currentPriceAmerican,
          sportsbook: before.currentPriceSportsbook,
          grade: before.verdict.label,
        },
        after: {
          pick: after.pick,
          price: after.currentPriceAmerican,
          sportsbook: after.currentPriceSportsbook,
          grade: after.verdict.label,
        },
      });
    }
  }
  console.log(JSON.stringify({
    season,
    week,
    captured_at: Math.max(...[...latest.values()].map((row) => Date.parse(row.capturedAt))),
    games: candidateFixture.snapshot.games.length,
    markets: candidateFixture.snapshot.games.length * 3,
    findings,
    published_changes: publishedChanges,
    live_eagles_jaguars: liveEaglesJaguars ? {
      moneyline: liveEaglesJaguars.markets.moneyline.pick,
      spread: liveEaglesJaguars.markets.first_inning.pick,
      total: liveEaglesJaguars.markets.total.pick,
    } : null,
    eagles_jaguars: eaglesJaguars ? {
      moneyline: {
        pick: eaglesJaguars.markets.moneyline.pick,
        price: eaglesJaguars.markets.moneyline.currentPriceAmerican,
        sportsbook: eaglesJaguars.markets.moneyline.currentPriceSportsbook,
      },
      spread: {
        pick: eaglesJaguars.markets.first_inning.pick,
        price: eaglesJaguars.markets.first_inning.currentPriceAmerican,
        sportsbook: eaglesJaguars.markets.first_inning.currentPriceSportsbook,
      },
      total: {
        pick: eaglesJaguars.markets.total.pick,
        price: eaglesJaguars.markets.total.currentPriceAmerican,
        sportsbook: eaglesJaguars.markets.total.currentPriceSportsbook,
      },
    } : null,
  }, null, 2));
}

void main();
