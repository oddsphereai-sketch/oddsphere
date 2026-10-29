import assert from "node:assert/strict";
import { mapNbaConsumerLineHistoryRows } from "../lib/services/nba/nbaConsumerMemberLineHistory";

const rows = mapNbaConsumerLineHistoryRows({
  externalIdByDbId: new Map([[10, 1001]]),
  rows: [
    { id: 1, game_id: 10, market_type: "spread", sportsbook: "FanDuel", side: "home", line_value: -1.5, odds_american: -104, recorded_at: "2026-10-29T11:46:20.000Z" },
    { id: 2, game_id: 10, market_type: "spread", sportsbook: "FanDuel", side: "away", line_value: 1.5, odds_american: -118, recorded_at: "2026-10-29T11:46:20.000Z" },
    { id: 3, game_id: 10, market_type: "spread", sportsbook: "FanDuel", side: "home", line_value: -1.5, odds_american: -104, recorded_at: "2026-10-29T11:56:20.000Z" },
    { id: 4, game_id: 10, market_type: "spread", sportsbook: "FanDuel", side: "away", line_value: 1.5, odds_american: -118, recorded_at: "2026-10-29T11:56:20.000Z" },
    { id: 5, game_id: 10, market_type: "spread", sportsbook: "Circa", side: "home", line_value: 0, odds_american: -110, recorded_at: "2026-10-29T11:56:20.000Z" },
    { id: 6, game_id: 999, market_type: "spread", sportsbook: "FanDuel", side: "home", line_value: -1.5, odds_american: -104, recorded_at: "2026-10-29T11:56:20.000Z" },
  ],
});

assert.equal(rows.size, 1);
assert.equal(rows.get(1001)?.length, 4, "keeps both sides of both real FanDuel observations");
assert.ok(rows.get(1001)?.every((row) => row.sportsbook === "FanDuel"));
assert.ok(rows.get(1001)?.every((row) => row.sharpBook === false));
assert.ok(rows.get(1001)?.every((row) => row.selectionKey.startsWith("consumer_history:spread:")));
assert.deepEqual(
  rows.get(1001)?.filter((row) => row.selectionKey.endsWith(":home")).map((row) => row.providerTimestamp),
  ["2026-10-29T11:46:20.000Z", "2026-10-29T11:56:20.000Z"],
);

console.log("PASS NBA consumer member line-history mapping");
