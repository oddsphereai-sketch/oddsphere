import { deriveGrade } from "../lib/services/gradeDerivationService";
import {
  deriveMarketSignal,
  deriveMlbMarketSignalFromSides,
  type MarketSignalSource,
} from "../lib/services/marketSignalDerivationService";
import {
  classifyEvidence,
  classifyEvidenceFromSides,
} from "../lib/services/signalEvidenceClassifier";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`PASS: ${label}`);
}

function signal(overrides: Partial<MarketSignalSource>): MarketSignalSource {
  return {
    side: "home",
    is_plus_ev: false,
    ev_pct: null,
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: null,
    public_money_pct: null,
    ...overrides,
  };
}

const pickedOpposed = signal({ side: "home", public_betting_pct: 70, public_money_pct: 50 });
const oppositeSupported = signal({ side: "away", public_betting_pct: 30, public_money_pct: 50 });
const pickedSupported = signal({ side: "home", public_betting_pct: 45, public_money_pct: 65 });

const signedOptions = { signedSharpDivergence: true } as const;
check("picked-side money below tickets is market resistance", deriveMarketSignal("home", pickedOpposed, signedOptions) === "market_resistance");
check("complementary opposite-side row resolves to the same resistance verdict", deriveMarketSignal("home", oppositeSupported, signedOptions) === "market_resistance");
check("picked-side money above tickets confirms the model side", deriveMarketSignal("home", pickedSupported, signedOptions) === "market_confirmed");

const opposedEvidence = classifyEvidence("home", pickedOpposed, signedOptions);
const supportedEvidence = classifyEvidence("home", pickedSupported, signedOptions);
check("signed divergence marks picked-side opposing money as unaligned", opposedEvidence.sharpDivergence?.aligned === false);
check("signed divergence marks picked-side supporting money as aligned", supportedEvidence.sharpDivergence?.aligned === true);

const opposingEv = signal({ side: "away", is_plus_ev: true, ev_pct: 5.5 });
const merged = classifyEvidenceFromSides("home", pickedSupported, opposingEv, signedOptions);
check("side-aware merger preserves aligned split evidence", merged.sharpDivergence?.aligned === true);
check("side-aware merger preserves opposing EV evidence", merged.ev?.aligned === false);
check("opposing side evidence cannot be overwritten by picked-side confirmation", deriveMlbMarketSignalFromSides("home", pickedSupported, opposingEv, signedOptions) === "market_resistance");

const promotionGrade = deriveGrade({ kind: "game", modelEdgePct: 2, marketSignal: "market_confirmed", evidence: supportedEvidence });
check("strong aligned signed divergence can promote to sharp confirmed", promotionGrade.grade === "sharp_confirmed");

const veryStrongOpposition = classifyEvidence("home", signal({ side: "home", public_betting_pct: 75, public_money_pct: 45 }), signedOptions);
const demotionGrade = deriveGrade({ kind: "game", modelEdgePct: 3, marketSignal: "market_resistance", evidence: veryStrongOpposition });
check("very strong opposing signed divergence demotes to sharp conflict", demotionGrade.grade === "sharp_conflict");

check(
  "shared default remains unchanged for props and non-moneyline markets",
  deriveMarketSignal("home", pickedOpposed) === "market_neutral" &&
    classifyEvidence("home", pickedOpposed).sharpDivergence?.aligned === true,
);

console.log(`\n${passed} MLB signed-market-evidence checks passed.`);
