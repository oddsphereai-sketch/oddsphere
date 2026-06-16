/**
 * Unit tests for lib/streaming/movementTriggers.ts — meaningful-movement engine.
 * Run: npx tsx scripts/test-movement-triggers.ts
 */
import { evaluateMovement, DEFAULT_TRIGGER_CONFIG, type MovementInput } from "../lib/streaming/movementTriggers";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

const base: MovementInput = {
  marketType: "moneyline",
  prevOddsAmerican: null, nextOddsAmerican: null,
  prevNoVigProb: null, nextNoVigProb: null,
  prevPoint: null, nextPoint: null,
  pickSide: null, movedSide: "home",
  activeGrade: null,
  wasAvailable: true, isAvailable: true,
  minutesToStart: 600, // outside attention window
};
const ev = (o: Partial<MovementInput>) => evaluateMovement({ ...base, ...o });

// ML cents
check("ML 15c fires ml_cents", ev({ prevOddsAmerican: -110, nextOddsAmerican: -125 }).reasons.includes("ml_cents"));
check("ML 5c does NOT fire (noise)", !ev({ prevOddsAmerican: -110, nextOddsAmerican: -115 }).fire);
check("ML exactly 10c fires (boundary)", ev({ prevOddsAmerican: -110, nextOddsAmerican: -120 }).reasons.includes("ml_cents"));

// no-vig pp
check("novig 2.5pp fires", ev({ prevNoVigProb: 0.50, nextNoVigProb: 0.525 }).reasons.includes("novig_pp"));
check("novig 1pp does NOT fire (normal)", !ev({ prevNoVigProb: 0.50, nextNoVigProb: 0.51 }).fire);
check("novig exactly 2.0pp fires (boundary)", ev({ prevNoVigProb: 0.50, nextNoVigProb: 0.52 }).reasons.includes("novig_pp"));

// totals point + key number
const t = ev({ marketType: "total", prevPoint: 8.5, nextPoint: 9.0 });
check("total 0.5 move fires point_move", t.reasons.includes("point_move"));
check("total 8.5→9.0 crosses key number", t.reasons.includes("key_number"));
check("total 0.1 move does NOT fire", !ev({ marketType: "total", prevPoint: 8.5, nextPoint: 8.6 }).fire);

// moved against active Best Angle (picked side, price lengthens → implied prob falls → against)
const ba = ev({ pickSide: "home", movedSide: "home", activeGrade: "best_angle", prevOddsAmerican: -150, nextOddsAmerican: -130 });
check("moved against active Best Angle fires", ba.reasons.includes("moved_against_best_angle"));
check("moved against Best Angle magnitude = 1", ba.magnitude === 1);

// moved toward active Lean (picked side, price shortens → implied prob rises → toward)
const lean = ev({ pickSide: "over", movedSide: "over", activeGrade: "lean", prevOddsAmerican: +110, nextOddsAmerican: -105 });
check("moved toward active Lean fires", lean.reasons.includes("moved_toward_lean"));

// move on the OTHER side does not trigger pick-relative reasons
const other = ev({ pickSide: "home", movedSide: "away", activeGrade: "best_angle", prevOddsAmerican: -150, nextOddsAmerican: -130 });
check("move on other side: no moved_against_best_angle", !other.reasons.includes("moved_against_best_angle"));

// availability flips
check("became unavailable fires", ev({ wasAvailable: true, isAvailable: false }).reasons.includes("became_unavailable"));
check("became available fires", ev({ wasAvailable: false, isAvailable: true }).reasons.includes("became_available"));

// attention window lowers thresholds (8c fires inside window, not outside)
check("ML 8c does NOT fire outside attention window", !ev({ prevOddsAmerican: -110, nextOddsAmerican: -118 }).fire);
const att = ev({ minutesToStart: 120, prevOddsAmerican: -110, nextOddsAmerican: -118 });
check("ML 8c fires inside attention window", att.reasons.includes("ml_cents") && att.reasons.includes("attention_window"));

// attention window bounds: never below T-60
check("minutesToStart 50 (post-T60) NOT attention", !ev({ minutesToStart: 50, prevOddsAmerican: -110, nextOddsAmerican: -118 }).fire);

// no movement at all → no fire
check("flat everything → no fire", !ev({}).fire);

// config is the documented default
check("default mlCents=10", DEFAULT_TRIGGER_CONFIG.mlCents === 10);
check("default noVigPp=2.0", DEFAULT_TRIGGER_CONFIG.noVigPp === 2.0);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
