import assert from "node:assert/strict";
import { nflSelectedBetGrade } from "../app/lab/lib/nflReaderPresentation";

assert.deepEqual(
  nflSelectedBetGrade({ held: false, verdict: { key: "watchlist", label: "Watchlist" } }),
  { label: "Watchlist", className: "text-amber-300" },
);
assert.deepEqual(
  nflSelectedBetGrade({ held: false, verdict: { key: "lean", label: "Lean" } }),
  { label: "Lean", className: "text-sky-300" },
);
assert.deepEqual(
  nflSelectedBetGrade({ held: false, verdict: { key: "no_play", label: "No Play" } }),
  { label: "No Play", className: "text-gray-400" },
);
assert.deepEqual(
  nflSelectedBetGrade({ held: true, verdict: { key: "no_play", label: "No Play" } }),
  { label: "No Play", className: "text-gray-400" },
);

console.log("NFL reader selected-market Bet grade presentation: Lean, Watchlist, and No Play passed");
