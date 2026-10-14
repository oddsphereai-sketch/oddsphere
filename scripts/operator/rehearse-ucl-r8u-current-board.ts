import { buildUclDailyEdgePreview } from "../../lib/services/ucl/buildUclDailyEdgePreview";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";
import { readCurrentUclMemberSnapshot } from "../../lib/services/ucl/uclMemberSnapshotStore";

type Row = { identity: string; pick: string | null; verdict: string; actionable: boolean; locked: boolean };

function rows(response: NonNullable<Awaited<ReturnType<typeof readCurrentUclMemberSnapshot>>>): Row[] {
  return response.games.flatMap((game) => ([
    ["match_result", game.markets.moneyline],
    ["double_chance", game.soccerDoubleChanceMarket],
    ["total", game.markets.total],
    ["btts", game.markets.first_inning],
  ] as const).flatMap(([market, row]) => row ? [{
    identity: `${game.external_id}:${market}`,
    pick: row.pick,
    verdict: row.verdict.key,
    actionable: row.verdict.key === "lean" || row.verdict.key === "best_angle",
    locked: game.lockState === "locked" || Boolean(game.lockedAt),
  }] : []));
}

function counts(values: Row[]) {
  return values.reduce<Record<string, number>>((result, row) => {
    result[row.verdict] = (result[row.verdict] ?? 0) + 1;
    return result;
  }, {});
}

async function main() {
  const incumbent = await readCurrentUclMemberSnapshot();
  if (!incumbent) throw new Error("current UCL member snapshot missing");
  const slate = await buildUclSlate();
  const candidate = await buildUclDailyEdgePreview(slate);
  const before = rows(incumbent);
  const after = rows(candidate);
  const beforeById = new Map(before.map((row) => [row.identity, row]));
  const paired = after.flatMap((row) => beforeById.has(row.identity) ? [{ before: beforeById.get(row.identity)!, after: row }] : []);
  const unlocked = paired.filter((row) => !row.before.locked);
  console.log(JSON.stringify({
    mode: "read_only_zero_write_current_board",
    releases: { model: slate.modelRelease, calibration: slate.calibrationRelease },
    fixtures: candidate.games.length,
    marketRows: after.length,
    held: candidate.games.filter((game) => game.holdReason).length,
    before: { counts: counts(before), actionable: before.filter((row) => row.actionable).length },
    after: { counts: counts(after), actionable: after.filter((row) => row.actionable).length },
    unlockedImpact: {
      rows: unlocked.length,
      promotions: unlocked.filter((row) => !row.before.actionable && row.after.actionable),
      demotions: unlocked.filter((row) => row.before.actionable && !row.after.actionable),
      sideChanges: unlocked.filter((row) => row.before.pick !== row.after.pick),
    },
    games: candidate.games.map((game) => ({
      id: game.external_id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      lockState: game.lockState,
      projected: game.projected,
      matchResult: { pick: game.markets.moneyline.pick, probability: game.markets.moneyline.modelTrustPct, verdict: game.markets.moneyline.verdict.key, price: game.markets.moneyline.currentPriceAmerican },
      total: { pick: game.markets.total.pick, verdict: game.markets.total.verdict.key },
      btts: { pick: game.markets.first_inning.pick, verdict: game.markets.first_inning.verdict.key },
    })),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
