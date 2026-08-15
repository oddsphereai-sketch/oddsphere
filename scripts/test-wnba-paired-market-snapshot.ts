import assert from "node:assert/strict";
import {
  buildWnbaPairedMarketSnapshot,
  resolveWnbaExactPairedMarketEvidence,
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
} from "../lib/services/wnba/buildWnbaPredictionRecords";

assert.equal(
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
  "wnba_prediction_record_contract_v3_paired_market_snapshot_2026_08_15",
);

const moneyline = buildWnbaPairedMarketSnapshot({
  market: "moneyline",
  selectedSide: "home",
  selectedLine: null,
  selectedOddsAmerican: -150,
  oppositeOddsAmerican: 135,
  selectedNoVigProbability: 0.5850622407,
  pairedBookCount: 4,
});
assert.equal(moneyline.opposite_side, "away");
assert.equal(moneyline.opposite_line, null);
assert.equal(moneyline.opposite_odds_american, 135);
assert.equal(moneyline.paired_book_count, 4);
assert.ok(moneyline.selected_no_vig_probability !== null);
assert.ok(Math.abs(moneyline.selected_no_vig_probability - 0.5850622407) < 1e-9);

const spread = buildWnbaPairedMarketSnapshot({
  market: "spread",
  selectedSide: "away",
  selectedLine: 4.5,
  selectedOddsAmerican: -108,
  oppositeOddsAmerican: -112,
  selectedNoVigProbability: 0.49,
  pairedBookCount: 2,
});
assert.equal(spread.opposite_side, "home");
assert.equal(spread.opposite_line, -4.5);
assert.ok(spread.selected_no_vig_probability !== null);

const missingOpposite = buildWnbaPairedMarketSnapshot({
  market: "total",
  selectedSide: "under",
  selectedLine: 161.5,
  selectedOddsAmerican: -110,
  oppositeOddsAmerican: null,
  selectedNoVigProbability: null,
  pairedBookCount: 0,
});
assert.equal(missingOpposite.opposite_side, "over");
assert.equal(missingOpposite.opposite_line, 161.5);
assert.equal(missingOpposite.selected_no_vig_probability, null);

const exactEvidence = resolveWnbaExactPairedMarketEvidence({
  market: "spread",
  selectedSide: "away",
  selectedLine: 4.5,
  rows: [
    { market_type: "spread", side: "away", line_value: 4.5, odds_american: -110, sportsbook: "a" },
    { market_type: "spread", side: "home", line_value: -4.5, odds_american: -110, sportsbook: "a" },
    { market_type: "spread", side: "away", line_value: 4.5, odds_american: -108, sportsbook: "b" },
    { market_type: "spread", side: "home", line_value: -4.5, odds_american: -105, sportsbook: "b" },
    { market_type: "spread", side: "home", line_value: -4.5, odds_american: 120, sportsbook: "unpaired" },
    { market_type: "spread", side: "away", line_value: 5.5, odds_american: 200, sportsbook: "wrong-line" },
    { market_type: "spread", side: "home", line_value: -5.5, odds_american: 200, sportsbook: "wrong-line" },
  ],
});
assert.equal(exactEvidence.pairedBookCount, 2);
assert.equal(exactEvidence.oppositeOddsAmerican, 120);
assert.ok(exactEvidence.selectedNoVigProbability !== null);
assert.ok(exactEvidence.selectedNoVigProbability > 0.49 && exactEvidence.selectedNoVigProbability < 0.51);

console.log("WNBA paired market snapshot tests passed");
