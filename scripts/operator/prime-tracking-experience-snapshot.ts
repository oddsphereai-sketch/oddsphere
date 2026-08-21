/**
 * Pre-cutover member Tracking snapshot primer.
 *
 * The default mode assembles and validates the member-safe aggregate without
 * writing it. `--apply` publishes it through the same writer used by the
 * tracking refresh cron so the first member request never owns a cold build.
 */
import { buildTrackingFoundationSnapshotBody } from "../../lib/services/trackingFoundationSnapshot";
import { refreshTrackingFoundationResponseSnapshot } from "../../lib/services/labResponseSnapshotWriter";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const startedAt = Date.now();
  const body = await buildTrackingFoundationSnapshotBody();

  const required = ["overall", "bySportMarket", "yesterday", "thisWeek", "recentPicks", "recentlySettled"];
  const missing = required.filter((key) => body[key] === undefined || body[key] === null);
  if (missing.length > 0) throw new Error(`Tracking snapshot is missing: ${missing.join(", ")}`);
  if (body.tablesInitialized !== true) throw new Error("Tracking tables are not initialized.");

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    generatedAt: body.generatedAt ?? null,
    durationMs: Date.now() - startedAt,
    requiredSections: required.length,
    missingSections: missing.length,
  }, null, 2));
  if (!apply) {
    console.log("Dry run passed. No snapshot was written. Re-run with --apply only at approved cutover.");
    return;
  }

  const write = await refreshTrackingFoundationResponseSnapshot({ source: "tracking_experience_cutover" });
  if (!write.ok) throw new Error(write.error ?? "Tracking snapshot write failed.");
  console.log(`Tracking member snapshot primed (${write.snapshotKey}).`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
