import { randomUUID } from "node:crypto";
import {
  isNflDailyEdgePublicationEnabled,
  NFL_DAILY_EDGE_PUBLICATION_RELEASE,
} from "../../lib/config/nflDailyEdge";
import { acquireCronJobLeaseWithRetry } from "../../lib/cron/leaseRetry";
import {
  acquireCronJobLease,
  cronJobName,
  releaseCronJobLease,
} from "../../lib/cron/leases";
import {
  readCurrentNflMemberSnapshotWithPointer,
} from "../../lib/services/football/nflMemberSnapshotStore";
import {
  auditNflMemberSnapshot,
  buildNflPublishedMemberSnapshot,
  readCurrentNflPublishedMemberSnapshot,
  writeCurrentNflPublishedMemberSnapshot,
} from "../../lib/services/football/nflPublishedMemberSnapshotStore";

const apply = process.argv.includes("--apply");

async function main() {
  const current = await readCurrentNflMemberSnapshotWithPointer();
  const existing = await readCurrentNflPublishedMemberSnapshot();
  const candidate = buildNflPublishedMemberSnapshot({
    fixture: current.snapshot,
    sourceSnapshotSha256: current.pointer.sha256,
    existing,
  });
  const audit = auditNflMemberSnapshot({ fixture: candidate.fixture });
  const report = {
    mode: apply ? "apply" : "dry_run",
    publicationRelease: NFL_DAILY_EDGE_PUBLICATION_RELEASE,
    memberSnapshotRelease: candidate.fixture.memberSnapshotRelease,
    sourceSnapshotSha256: candidate.sourceSnapshotSha256,
    seasonPhase: candidate.fixture.tracking.seasonPhase,
    week: candidate.fixture.week.week,
    trackingEligible: candidate.fixture.tracking.trackingEligible,
    lockedGameIds: candidate.lockedGameIds,
    audit,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!audit.healthy) {
    throw new Error(`NFL publication readiness failed: ${audit.critical.join("; ")}`);
  }
  if (!apply) return;
  if (!isNflDailyEdgePublicationEnabled()) {
    throw new Error("NFL publication apply requires NFL_DAILY_EDGE_PUBLICATION_ENABLED=true.");
  }
  const runId = randomUUID();
  const jobName = cronJobName("prediction_pipeline", "nfl");
  const acquired = await acquireCronJobLeaseWithRetry({
    jobName,
    runId,
    leaseSeconds: 5 * 60,
    maxWaitMs: 20_000,
    retryIntervalMs: 2_000,
  }, { acquire: acquireCronJobLease });
  if (acquired.lease.mode !== "acquired") {
    throw new Error(`Required NFL prediction-pipeline lease was not acquired (${acquired.lease.mode}).`);
  }
  try {
    const write = await writeCurrentNflPublishedMemberSnapshot(candidate);
    if (!write.ok) throw new Error(`NFL member snapshot publication failed: ${write.error}`);
    const readback = await readCurrentNflPublishedMemberSnapshot();
    if (
      !readback ||
      readback.publicationRelease !== candidate.publicationRelease ||
      readback.sourceSnapshotSha256 !== candidate.sourceSnapshotSha256 ||
      readback.publishedAt !== candidate.publishedAt
    ) {
      throw new Error("NFL member snapshot publication readback mismatch.");
    }
    console.log(JSON.stringify({
      published: true,
      snapshotKey: write.snapshotKey,
      expiresAt: write.expiresAt,
      staleUntil: write.staleUntil,
      sourceSnapshotSha256: readback.sourceSnapshotSha256,
      lease: {
        jobName,
        runId,
        attempts: acquired.attempts,
        waitedMs: acquired.waitedMs,
      },
    }, null, 2));
  } finally {
    await releaseCronJobLease({ jobName, runId });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
