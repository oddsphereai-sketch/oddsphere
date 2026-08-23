import assert from "node:assert/strict";
import { nflSelectedBetGrade } from "../app/lab/lib/nflReaderPresentation";

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
  { label: "Held", className: "text-amber-200" },
);

console.log("NFL reader selected-market Bet grade presentation: Lean, No Play, and Held passed");
