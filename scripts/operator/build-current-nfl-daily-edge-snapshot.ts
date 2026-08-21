import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFootballPreviewFixture,
  resolveNflPreviewWeek,
} from "../../app/dev/football-preview/footballPreviewFixture";
import {
  NFL_MEMBER_SNAPSHOT_RELEASE,
  type NflMemberSnapshot,
} from "../../lib/services/football/nflMemberSnapshotStore";
import { loadNflPreseasonLocalSlate } from "../../lib/services/football/nflLocalShadowSlate";
import {
  loadNflRegularLocalSlate,
  loadNflRegularPipelinePreseasonSlate,
} from "../../lib/services/football/nflRegularLocalSlate";

const phase = process.argv.find((value) => value.startsWith("--phase="))?.slice("--phase=".length) ?? "preseason";
const week = Number(process.argv.find((value) => value.startsWith("--week="))?.slice("--week=".length) ?? (phase === "preseason" ? 2 : 1));
if (phase !== "preseason" && phase !== "regular") throw new Error("--phase must be preseason or regular");
if (!Number.isInteger(week)) throw new Error("--week must be an integer");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const fixture = phase === "preseason"
    ? await buildPreseason(week)
    : await buildRegular(week);
  const storedAt = new Date().toISOString();
  const payload: NflMemberSnapshot = {
    ...fixture,
    memberSnapshotRelease: NFL_MEMBER_SNAPSHOT_RELEASE,
    storedAt,
  };
  if (payload.snapshot.games.length === 0) {
    throw new Error("NFL member snapshot cannot contain an empty weekly slate.");
  }
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const checksum = sha256(bytes);
  const filename = `nfl_daily_edge_2026_${phase}_week_${week}_${checksum.slice(0, 16)}.json`;
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  await writeFile(path.join(root, filename), bytes);
  const pointer = {
    memberSnapshotRelease: NFL_MEMBER_SNAPSHOT_RELEASE,
    filename,
    sha256: checksum,
    seasonPhase: phase,
    week,
    storedAt,
  };
  await writeFile(path.join(root, `nfl_daily_edge.${phase}.json`), `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, "nfl_daily_edge.current.json"), `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    memberSnapshotRelease: NFL_MEMBER_SNAPSHOT_RELEASE,
    seasonPhase: phase,
    week,
    games: payload.snapshot.games.length,
    predictions: payload.snapshot.games.length * 3,
    filename,
    sha256: checksum,
  }, null, 2));
}

async function buildPreseason(productWeek: number) {
  const [loaded, phaseComparison] = await Promise.all([
    loadNflRegularPipelinePreseasonSlate(productWeek),
    loadNflPreseasonLocalSlate(productWeek),
  ]);
  if (loaded.providerSlate.fetchedAt !== phaseComparison.providerSlate.fetchedAt) {
    throw new Error("NFL preseason model snapshots do not share one provider observation.");
  }
  return buildFootballPreviewFixture({
    providerSlate: loaded.providerSlate,
    shadowSlate: loaded.localSlate,
    phaseComparisonSlate: phaseComparison.localSlate,
    availability: loaded.availability,
    priceHistoryByGame: loaded.priceHistoryByGame,
    previousWeek: null,
    nextWeek: null,
  });
}

async function buildRegular(regularWeek: number) {
  const loaded = await loadNflRegularLocalSlate(regularWeek);
  const start = loaded.providerSlate.games[0]?.scheduledStart ?? "2026-09-10T00:00:00.000Z";
  return buildFootballPreviewFixture({
    providerSlate: loaded.providerSlate,
    shadowSlate: loaded.localSlate,
    availability: loaded.availability,
    priceHistoryByGame: loaded.priceHistoryByGame,
    consensusSplitsByGame: loaded.consensusSplitsByGame,
    seasonPhase: "regular",
    weekOverride: {
      week: regularWeek,
      providerWeek: regularWeek,
      label: `Regular Season Week ${regularWeek}`,
      startDate: start.slice(0, 10),
    },
    previousWeek: regularWeek > 1 ? regularWeek - 1 : null,
    nextWeek: regularWeek < 18 ? regularWeek + 1 : null,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
