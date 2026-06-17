/**
 * Local probe — runs the trackingRefreshService for sport='nhl' as a
 * dry-run to verify the NHL branch wires cleanly through the existing
 * sport loop. Read-only.
 */

import { supabase } from "../../lib/db/supabase";
import { runTrackingRefresh } from "../../lib/services/trackingRefreshService";

async function main() {
  const summary = await runTrackingRefresh({
    supabase,
    sport: "nhl",
    dates: ["2026-06-09"],
    apply: false,
  });
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
