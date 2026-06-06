/**
 * Push 4 — tests for game lifecycle helpers.
 */

import {
  deriveLifecycle,
  isFinalStatus,
  isLiveStatus,
  isVoidStatus,
  isUpcomingStatus,
} from "../lib/services/gameLifecycle";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ Status classifiers ━━━");
check("'final' is final", isFinalStatus("final"));
check("'STATUS_FINAL' is final", isFinalStatus("STATUS_FINAL"));
check("'STATUS_FINAL_OT' is final", isFinalStatus("STATUS_FINAL_OT"));
check("null is not final", !isFinalStatus(null));
check("'in_progress' is live", isLiveStatus("in_progress"));
check("'live' is live", isLiveStatus("live"));
check("'STATUS_IN_PROGRESS' is live", isLiveStatus("STATUS_IN_PROGRESS"));
check("'postponed' is void", isVoidStatus("postponed"));
check("'canceled' is void", isVoidStatus("canceled"));
check("'cancelled' is void", isVoidStatus("cancelled"));
check("'scheduled' is upcoming", isUpcomingStatus("scheduled"));
check("'STATUS_SCHEDULED' is upcoming", isUpcomingStatus("STATUS_SCHEDULED"));

console.log("\n━━━ deriveLifecycle ━━━");
const NOW = new Date("2026-06-06T17:30:00Z").getTime();
{
  // Upcoming (scheduled + start in future)
  const l = deriveLifecycle({
    status: "STATUS_SCHEDULED",
    gameDateIso: "2026-06-06T20:10:00Z",
    nowMs: NOW,
  });
  check("scheduled + future start → upcoming", l === "upcoming");
}
{
  // live_locked (status=scheduled but start time passed = provider slow)
  const l = deriveLifecycle({
    status: "STATUS_SCHEDULED",
    gameDateIso: "2026-06-06T17:00:00Z",
    nowMs: NOW,
  });
  check("scheduled + past start → live_locked (provider slow)", l === "live_locked");
}
{
  // Live status overrides time
  const l = deriveLifecycle({
    status: "in_progress",
    gameDateIso: null,
    nowMs: NOW,
  });
  check("in_progress → live_locked", l === "live_locked");
}
{
  const l = deriveLifecycle({
    status: "STATUS_FINAL",
    gameDateIso: null,
    nowMs: NOW,
  });
  check("final without grade → final", l === "final");
}
{
  const l = deriveLifecycle({
    status: "STATUS_FINAL",
    gameDateIso: null,
    hasGrade: true,
    nowMs: NOW,
  });
  check("final + hasGrade=true → graded", l === "graded");
}
{
  const l = deriveLifecycle({
    status: "postponed",
    gameDateIso: null,
    nowMs: NOW,
  });
  check("postponed → void", l === "void");
}
{
  const l = deriveLifecycle({
    status: null,
    gameDateIso: null,
    nowMs: NOW,
  });
  check("null status, null date → upcoming (safe default)", l === "upcoming");
}
{
  // Unknown future status
  const l = deriveLifecycle({
    status: "SOMETHING_NEW",
    gameDateIso: "2030-01-01T00:00:00Z",
    nowMs: NOW,
  });
  check("unknown status + future start → upcoming", l === "upcoming");
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All game lifecycle tests passed.");
