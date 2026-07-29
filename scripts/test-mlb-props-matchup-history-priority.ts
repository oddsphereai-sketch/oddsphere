import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  selectMlbPropsMatchupHistoryCandidates,
  type MlbPropsMatchupHistoryCandidate,
} from "../lib/mlb/props/matchupHistoryPriority";

type Candidate = MlbPropsMatchupHistoryCandidate<{ player: string }>;

const candidates: Candidate[] = [
  {
    key: "expired-best",
    value: { player: "Expired Best Angle" },
    actionablePriority: 3,
    gameStartTime: "2026-07-29T17:00:00.000Z",
    upcoming: false,
  },
  {
    key: "upcoming-watch",
    value: { player: "Upcoming Watchlist" },
    actionablePriority: 1,
    gameStartTime: "2026-07-30T00:00:00.000Z",
    upcoming: true,
  },
  {
    key: "upcoming-lean",
    value: { player: "Upcoming Lean" },
    actionablePriority: 2,
    gameStartTime: "2026-07-30T01:00:00.000Z",
    upcoming: true,
  },
  {
    key: "upcoming-best-late",
    value: { player: "Upcoming Best Late" },
    actionablePriority: 3,
    gameStartTime: "2026-07-30T02:00:00.000Z",
    upcoming: true,
  },
  {
    key: "upcoming-best-early",
    value: { player: "Upcoming Best Early" },
    actionablePriority: 3,
    gameStartTime: "2026-07-30T01:30:00.000Z",
    upcoming: true,
  },
];

const selected = selectMlbPropsMatchupHistoryCandidates(candidates, 4);
assert.deepEqual(
  selected.map((candidate) => candidate.key),
  ["upcoming-best-early", "upcoming-best-late", "upcoming-lean", "upcoming-watch"],
);
assert.equal(selectMlbPropsMatchupHistoryCandidates(candidates, 0).length, 0);
assert.deepEqual(
  selectMlbPropsMatchupHistoryCandidates([...candidates].reverse(), 4).map((candidate) => candidate.key),
  selected.map((candidate) => candidate.key),
  "selection must not depend on provider row order",
);

const reader = readFileSync("app/mlb/props/components/PlayerPropsDashboard.tsx", "utf8");
assert.ok(!reader.includes("Official batter-versus-pitcher totals are loading for this probable matchup."));
assert.ok(reader.includes("Direct batter-versus-pitcher history is not available in this research snapshot."));

console.log("PASS MLB props matchup-history priority: upcoming actionable pairs are bounded and deterministic");
