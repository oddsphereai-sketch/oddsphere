import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBalldontlieNflPreviewSlate } from "../../lib/services/football/balldontlieNflPreviewSlate";
import { fetchBalldontlieNflSlateAvailability } from "../../lib/services/football/balldontlieNflAvailability";

const INPUT_RELEASE = "nfl_preseason_current_provider_inputs_2026_08_19_r2" as const;

async function main() {
  const productWeekArg = process.argv.find((value) => value.startsWith("--product-week="));
  const productWeek = Number(productWeekArg?.split("=")[1] ?? "2");
  if (!Number.isInteger(productWeek) || productWeek < 1 || productWeek > 3) {
    throw new Error("--product-week must be 1, 2, or 3");
  }
  const slate = await fetchBalldontlieNflPreviewSlate({ season: 2026, productWeek });
  const availabilityRows = await fetchBalldontlieNflSlateAvailability(
    slate.games.map((game) => ({
      id: `nfl-${game.providerGameId}`,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      awayTeamId: game.away.id,
      homeTeamId: game.home.id,
    })),
  );
  if (availabilityRows === null) throw new Error("BALLDONTLIE preseason injury snapshot is unavailable.");
  const body = {
    inputRelease: INPUT_RELEASE,
    exportedAt: new Date().toISOString(),
    slate,
    availability: Object.fromEntries(availabilityRows.map((row) => [row.eventId, row])),
    requestBudget: {
      slateRequests: slate.providerRequests,
      injuryRequestsMaximum: 4,
    },
  };
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  const checksum = createHash("sha256").update(payload).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  await mkdir(root, { recursive: true });
  const filename = `nfl_preseason_2026_product_week_${productWeek}_${checksum.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), payload, "utf8");
  await writeFile(path.join(root, `nfl_preseason_2026_product_week_${productWeek}.latest.json`), `${JSON.stringify({
    inputRelease: INPUT_RELEASE,
    providerRelease: slate.release,
    exportedAt: body.exportedAt,
    season: slate.season,
    productWeek: slate.productWeek,
    providerWeek: slate.providerWeek,
    games: slate.games.length,
    availabilityGames: availabilityRows.length,
    requestBudget: body.requestBudget,
    filename,
    sha256: checksum,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ productWeek, providerWeek: slate.providerWeek, games: slate.games.length, availabilityGames: availabilityRows.length, filename, sha256: checksum, requestBudget: body.requestBudget }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
