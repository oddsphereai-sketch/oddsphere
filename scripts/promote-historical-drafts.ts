/**
 * scripts/promote-historical-drafts.ts — one-shot post-deploy helper.
 *
 * V8 (Phase 6.3a) backfilled every existing games row to slate_status='draft'.
 * Once member-facing filters land in 6.4/6.5 (WHERE slate_status IN
 * ('published', 'final')) those drafts would black-hole the seed slate.
 *
 * Daniel runs this once after 6.3d deploys, with the cutoff set to whatever
 * date "everything older should be considered published in retrospect"
 * means for the current data — typically tomorrow's date.
 *
 * Usage:
 *   npm run promote-drafts -- 2026-12-31
 *
 * Idempotent — re-running finds zero remaining drafts before the cutoff and
 * exits with promoted=0.
 */

import { promoteHistoricalDrafts } from "../lib/services/slatePublishService";
import type { Sport } from "../lib/types/domain/Sport";

function parseArgs(): { cutoff: string; sport: Sport | undefined } {
  const cutoff = process.argv[2];
  const sport = process.argv[3];
  if (!cutoff) {
    console.error(
      "Usage: npm run promote-drafts -- YYYY-MM-DD [sport]\n" +
        "Promotes every games row with slate_status='draft' AND slate_date < YYYY-MM-DD to 'published'.\n" +
        "Optional sport arg scopes the promotion (e.g. 'mlb'). Omit to promote across all sports."
    );
    process.exit(2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    console.error(`Invalid date "${cutoff}". Expected YYYY-MM-DD.`);
    process.exit(2);
  }
  return { cutoff, sport: (sport as Sport | undefined) ?? undefined };
}

async function main() {
  const { cutoff, sport } = parseArgs();
  const scope = sport ? `${sport} drafts` : "all sports' drafts";
  console.log(
    `Promoting ${scope} with slate_date < ${cutoff} → published...`
  );

  const result = await promoteHistoricalDrafts(cutoff, sport);

  if (result.promoted === 0) {
    console.log("  no drafts to promote — already done.");
  } else {
    console.log(`  promoted ${result.promoted} game rows.`);
    console.log("  audit row written to admin_audit_log.");
  }
}

main().catch((e) => {
  console.error("\n❌ promote-historical-drafts failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
