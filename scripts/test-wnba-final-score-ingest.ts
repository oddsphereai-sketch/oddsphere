import { isValidWnbaFinalScore } from "../lib/services/wnba/ingestWnbaFinalScores";

const cases: Array<[unknown, unknown, boolean, string]> = [
  [88, 75, true, "normal final"],
  [0, 0, false, "postponement placeholder"],
  [null, null, false, "missing scores"],
  [88, null, false, "partial score"],
];

for (const [home, away, expected, label] of cases) {
  const actual = isValidWnbaFinalScore(home, away);
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

console.log("WNBA final-score ingest guard: 4/4 pass");
