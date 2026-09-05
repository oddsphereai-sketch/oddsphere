import { loadLatestMlbPropsBoardSnapshot } from "../../lib/mlb/props/boardSnapshotStore";
import {
  applyMlbPropsPriceConfidenceCeilings,
  MLB_PROPS_ACTIONABLE_PRICE_FLOOR,
  MLB_PROPS_BEST_ANGLE_PRICE_FLOOR,
} from "../../lib/mlb/props/priceConfidencePolicy";

function countByGrade(rows: Array<{ playGrade: string }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.playGrade] = (counts[row.playGrade] ?? 0) + 1;
    return counts;
  }, {});
}

async function main() {
  const slateDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const snapshot = await loadLatestMlbPropsBoardSnapshot(slateDate);
  if (!snapshot) throw new Error(`No MLB props snapshot found for ${slateDate}`);
  const before = snapshot.data.props;
  const after = applyMlbPropsPriceConfidenceCeilings(before);
  const changed = before.flatMap((row, index) => row.playGrade === after[index]?.playGrade
    ? []
    : [{
        id: row.id,
        player: row.player,
        market: row.market,
        side: row.side,
        price: row.odds,
        offerContract: row.offerContract ?? null,
        locked: row.lockStatus?.status === "locked",
        from: row.playGrade,
        to: after[index]?.playGrade ?? null,
      }]);
  console.log(JSON.stringify({
    mode: "select_only_identical_input_price_confidence_audit",
    slateDate,
    sourceSnapshotId: snapshot.snapshotId,
    sourceRelease: snapshot.modelContext?.modelReleaseId ?? null,
    sourceAsOf: snapshot.asOfTimestamp,
    policy: {
      bestAnglePriceFloor: MLB_PROPS_BEST_ANGLE_PRICE_FLOOR,
      actionablePriceFloor: MLB_PROPS_ACTIONABLE_PRICE_FLOOR,
      milestoneOffersUnchanged: true,
      lockedRowsUnchanged: true,
      stakesChanged: false,
    },
    rows: before.length,
    before: countByGrade(before),
    after: countByGrade(after),
    changes: changed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
