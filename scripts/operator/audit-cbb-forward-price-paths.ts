/** Private, read-only CBB price-path census. No prediction or production writes. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { cbbObservedPricePaths, normalizeCbbOwlsCurrent } from "../../lib/cbb/owlsMarketEvidence";
import type { CbbGame } from "../../lib/cbb/types";
import type { RawOwlsOddsResponse } from "../../lib/providers/owls/owlsSharpBookOdds";

const directory = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const archivePattern = /^owls-cbb-current-\d+\.json$/;
const sharpBooks = new Set(["pinnacle", "ps3838", "circa"]);
const markets = ["moneyline", "spread", "total"] as const;

async function main() {
  const scheduleText = await readFile(resolve(directory, "games-2026.json"), "utf8");
  const schedule = JSON.parse(scheduleText) as { data: CbbGame[] };
  if (!Array.isArray(schedule.data)) throw new Error("CBB schedule is missing");
  const files = (await readdir(directory)).filter(name => archivePattern.test(name)).sort();
  if (!files.length) throw new Error("No immutable CBB current-odds receipts found");
  const captures = await Promise.all(files.map(async file => {
    const text = await readFile(resolve(directory, file), "utf8");
    const capture = JSON.parse(text) as { fetchedAt: string; body: RawOwlsOddsResponse };
    const fetchedAt = Date.parse(capture.fetchedAt);
    if (!Number.isFinite(fetchedAt) || capture.body?.success === false) throw new Error(`Invalid CBB receipt ${file}`);
    return { file, sha256: createHash("sha256").update(text).digest("hex"), ...capture, fetchedAtMs: fetchedAt };
  }));
  captures.sort((a, b) => a.fetchedAtMs - b.fetchedAtMs);
  const latest = captures.at(-1)!;
  const splitText = await readFile(resolve(directory, "owls-cbb-splits.json"), "utf8").catch(() => null);
  const splits = splitText ? JSON.parse(splitText) as {
    fetchedAt: string; body: { data?: unknown[]; meta?: { total_games?: number; status?: string; partial_reason?: string } };
  } : null;
  const horizon = latest.fetchedAtMs + 7 * 86400000;
  const games = schedule.data.filter(game => game.status === "pre" && game.home_team.conference_id &&
    game.visitor_team.conference_id && Date.parse(game.date) > latest.fetchedAtMs && Date.parse(game.date) <= horizon);
  const matched = games.flatMap(game => {
    const quotes = captures.flatMap(capture => capture.fetchedAtMs < Date.parse(game.date)
      ? normalizeCbbOwlsCurrent(game, capture.body, capture.fetchedAt, capture.fetchedAt).quotes : []);
    if (!quotes.length) return [];
    const paths = cbbObservedPricePaths(quotes, "__none__");
    const latestQuotes = normalizeCbbOwlsCurrent(game, latest.body, latest.fetchedAt, latest.fetchedAt).quotes;
    const currentBooks = Object.fromEntries(markets.map(market => [market,
      [...new Set(latestQuotes.filter(quote => quote.market === market).map(quote => quote.sportsbook))].sort()]));
    return [{ gameId: game.id, startsAt: game.date, home: game.home_team.full_name, away: game.visitor_team.full_name,
      snapshotsWithQuotes: captures.filter(capture => capture.fetchedAtMs < Date.parse(game.date) &&
        normalizeCbbOwlsCurrent(game, capture.body, capture.fetchedAt, capture.fetchedAt).quotes.length > 0).length,
      currentBooks, currentSharpBooks: [...new Set(latestQuotes.filter(quote => sharpBooks.has(quote.sportsbook))
        .map(quote => quote.sportsbook))].sort(),
      paths: paths.map(path => ({ book: path.book, market: path.market, observations: path.observations,
        distinctStates: path.distinctStates, windowStart: path.windowStart, windowEnd: path.windowEnd,
        first: path.changes[0] ?? null, last: path.changes.at(-1) ?? null, trueOpeningKnown: false })),
    }];
  });
  console.log(JSON.stringify({ scope: "private_forward_observation_audit", productionWrites: 0,
    scheduleHash: createHash("sha256").update(scheduleText).digest("hex"),
    receipts: captures.map(({ file, sha256, fetchedAt }) => ({ file, sha256, fetchedAt })),
    splitReceipt: splits ? { fetchedAt: splits.fetchedAt, sha256: createHash("sha256").update(splitText!).digest("hex"),
      games: splits.body.meta?.total_games ?? splits.body.data?.length ?? null,
      status: splits.body.meta?.status ?? null, partialReason: splits.body.meta?.partial_reason ?? null } : null,
    latestReceiptAt: latest.fetchedAt, scheduledDiGames: games.length, gamesWithVerifiedQuotes: matched.length,
    gamesWithCurrentSharpBooks: matched.filter(game => game.currentSharpBooks.length > 0).length,
    gamesWithObservedChanges: matched.filter(game => game.paths.some(path => path.distinctStates > 1)).length,
    games: matched }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "CBB path audit failed"); process.exitCode = 1; });
