import assert from "node:assert/strict";

import { computePlayGrade } from "../lib/automodel/playGrade";
import { mapPlaybookSplitsToSharpSignalRecords } from "../lib/providers/playbook/playbookPublicSplitsMapper";
import type { PlaybookSplitGame } from "../lib/providers/playbook/types";
import { classifyEvidence } from "../lib/services/signalEvidenceClassifier";
import { deriveMarketSignal } from "../lib/services/marketSignalDerivationService";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
}

const computedAt = "2026-06-24T12:00:00.000Z";

const playbookRow: PlaybookSplitGame = {
  gameId: "wnba-phx-ind-2026-06-24",
  league: "wnba",
  startTime: "2026-06-24T23:30:00.000Z",
  homeTeamName: "Indiana Fever",
  awayTeamName: "Phoenix Mercury",
  splits: {
    moneyline: {
      bets: { homePercent: 70, awayPercent: 30 },
      money: { homePercent: 68, awayPercent: 32 },
      source: { booksUsed: 11 },
    },
  },
};

const mapped = mapPlaybookSplitsToSharpSignalRecords({
  sport: "wnba",
  rows: [playbookRow],
  gameExternalIdByKey: new Map([["PHX@IND", 1001]]),
  computedAt,
});

const homeMl = mapped.records.find((r) => r.market_type === "moneyline" && r.side === "home");
assert.ok(homeMl, "expected mapped WNBA home moneyline split");

check("Playbook split maps public bet pct", homeMl.public_betting_pct === 70);
check("Playbook split maps public money pct", homeMl.public_money_pct === 68);
check("Playbook split never becomes +EV", homeMl.is_plus_ev === false);
check("Playbook split never gets fair probability", homeMl.pinnacle_fair_probability === null);
check("Playbook split never becomes steam", homeMl.has_steam_move === false);
check("Playbook split never becomes RLM", homeMl.has_reverse_line_movement === false);
check("Playbook split never gets RLM direction", homeMl.rlm_direction === null);

const publicSmokeSignal = deriveMarketSignal("home", homeMl);
check("Public-heavy flat-money Playbook split can become public_smoke context", publicSmokeSignal === "public_smoke");

const evidence = classifyEvidence("home", homeMl);
check("Playbook split has no EV evidence", evidence.ev === null);
check("Playbook split has no steam evidence", evidence.steam === null);
check("Playbook split has no RLM evidence", evidence.rlm === null);
check("Playbook split can carry aligned public smoke evidence", evidence.publicSmoke?.aligned === true);

const neutralBestAngle = computePlayGrade({
  modelProb: 0.6,
  marketProb: 0.55,
  americanOdds: -105,
  dataQualityTier: "high",
  provisional: false,
  isHeld: false,
  minBestAngleEdgePct: 2,
  minBestAngleConfidencePct: 55,
  sharpAgreement: "neutral",
});
check("Neutral sharp context can leave a valid Best Angle intact", neutralBestAngle.grade === "best_angle");

const opposedBestAngle = computePlayGrade({
  modelProb: 0.6,
  marketProb: 0.55,
  americanOdds: -105,
  dataQualityTier: "high",
  provisional: false,
  isHeld: false,
  minBestAngleEdgePct: 2,
  minBestAngleConfidencePct: 55,
  sharpAgreement: "opposes",
});
check("True opposing sharp agreement blocks Best Angle", opposedBestAngle.grade !== "best_angle");
check("Opposing sharp agreement still leaves the model pick as a lean when edge is real", opposedBestAngle.grade === "lean");

console.log("provider-signal-boundaries: all assertions passed");
