import { effectiveTrackingPlayGrade } from "../lib/services/trackingAggregateService";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`);
    fail++;
  }
}

function record(overrides: Record<string, unknown> = {}): any {
  return {
    play_grade: null,
    best_angle: false,
    no_bet: false,
    snapshot_json: null,
    ...overrides,
  };
}

console.log("\n━━━ tracking locked grade tests ━━━\n");

check(
  "member_facing_at_lock grade beats raw play_grade",
  effectiveTrackingPlayGrade(record({
    play_grade: "lean",
    best_angle: false,
    snapshot_json: {
      member_facing_at_lock: { grade: "best_angle" },
    },
  })) === "best_angle",
);

check(
  "member_facing_at_lock grade beats legacy display override",
  effectiveTrackingPlayGrade(record({
    play_grade: "best_angle",
    best_angle: true,
    snapshot_json: {
      tracking_display_grade_override: "lean",
      member_facing_at_lock: { grade: "watchlist" },
    },
  })) === "watchlist",
);

check(
  "legacy display override remains fallback for pre-lock-snapshot rows",
  effectiveTrackingPlayGrade(record({
    play_grade: "best_angle",
    best_angle: true,
    snapshot_json: {
      tracking_display_grade_override: "lean",
    },
  })) === "lean",
);

check(
  "raw best_angle with best_angle=false still demotes to lean",
  effectiveTrackingPlayGrade(record({
    play_grade: "best_angle",
    best_angle: false,
  })) === "lean",
);

check(
  "lean rows remain lean without overrides",
  effectiveTrackingPlayGrade(record({
    play_grade: "lean",
    best_angle: false,
  })) === "lean",
);

check(
  "member_facing_at_lock preserves non-BA public grades",
  effectiveTrackingPlayGrade(record({
    play_grade: "lean",
    best_angle: false,
    snapshot_json: {
      member_facing_at_lock: { grade: "market_aligned" },
    },
  })) === "market_aligned",
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
