import { readFile, writeFile } from "node:fs/promises";
import {
  buildNflPlayerPropsExactBoard,
} from "../../lib/services/football/nflPlayerPropsMarketBoard";
import type { NflPlayerPropsObservationSnapshot } from "../../lib/services/football/nflPlayerPropsContract";

async function main(): Promise<void> {
  const paths = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  if (paths.length === 0) throw new Error("Pass one or more persisted NFL props observation snapshots.");
  const evaluatedAt = process.argv.find((value) => value.startsWith("--evaluated-at="))?.slice(15) ?? new Date().toISOString();
  const outputPath = process.argv.find((value) => value.startsWith("--output="))?.slice(9) ?? null;
  const snapshots = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as NflPlayerPropsObservationSnapshot));
  const offers = buildNflPlayerPropsExactBoard({ snapshots, evaluatedAt });
  const gradeEligible = offers.filter((offer) => offer.gradeEligibleMarket && offer.healthHolds.length === 0);
  const byMarket = Object.fromEntries([...new Set(offers.map((offer) => offer.market))].sort().map((market) => [market, {
    offers: offers.filter((offer) => offer.market === market).length,
    gradeEligible: gradeEligible.filter((offer) => offer.market === market).length,
    players: new Set(gradeEligible.filter((offer) => offer.market === market).map((offer) => offer.playerName.toLowerCase())).size,
    books: [...new Set(gradeEligible.filter((offer) => offer.market === market).map((offer) => offer.sportsbook))].sort(),
  }]));
  if (outputPath) await writeFile(outputPath, `${JSON.stringify({ evaluatedAt, offers }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    release: offers[0]?.release ?? null,
    evaluatedAt,
    snapshots: snapshots.length,
    games: new Set(offers.map((offer) => offer.canonicalGameId)).size,
    offers: offers.length,
    gradeEligibleOffers: gradeEligible.length,
    unlocked: offers.filter((offer) => offer.state === "unlocked").length,
    locked: offers.filter((offer) => offer.state === "locked").length,
    currentWithOpening: offers.filter((offer) => offer.openingObservedAt !== null).length,
    byMarket,
    holds: Object.fromEntries([...new Set(offers.flatMap((offer) => offer.healthHolds))].sort().map((hold) => [hold, offers.filter((offer) => offer.healthHolds.includes(hold)).length])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
