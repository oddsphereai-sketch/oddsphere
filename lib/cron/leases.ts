import { supabase } from "../db/supabase";

export type CronLeaseAcquireResult =
  | {
      mode: "acquired";
      jobName: string;
      runId: string;
      leaseExpiresAt: string | null;
    }
  | {
      mode: "skipped_overlap";
      jobName: string;
      runId: string;
      existingRunId: string | null;
      leaseExpiresAt: string | null;
    }
  | {
      mode: "unavailable";
      jobName: string;
      runId: string;
      reason: string;
    };

function leaseUnavailable(message: string): boolean {
  return /function .*try_acquire_cron_job_lease.* does not exist|relation .*cron_job_leases.* does not exist|schema cache/i.test(message);
}

export function cronJobName(dataSource: string, sport: string | null): string {
  return sport ? `${dataSource}:${sport}` : dataSource;
}

export async function acquireCronJobLease(opts: {
  jobName: string;
  runId: string;
  leaseSeconds: number;
}): Promise<CronLeaseAcquireResult> {
  const { data, error } = await supabase.rpc("try_acquire_cron_job_lease", {
    p_job_name: opts.jobName,
    p_run_id: opts.runId,
    p_lease_seconds: opts.leaseSeconds,
  });

  if (error) {
    if (leaseUnavailable(error.message)) {
      return {
        mode: "unavailable",
        jobName: opts.jobName,
        runId: opts.runId,
        reason: error.message,
      };
    }
    throw new Error(`cron lease acquire failed for ${opts.jobName}: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.acquired === true) {
    return {
      mode: "acquired",
      jobName: opts.jobName,
      runId: opts.runId,
      leaseExpiresAt: row.lease_expires_at ?? null,
    };
  }

  return {
    mode: "skipped_overlap",
    jobName: opts.jobName,
    runId: opts.runId,
    existingRunId: row?.existing_run_id ?? null,
    leaseExpiresAt: row?.lease_expires_at ?? null,
  };
}

export async function releaseCronJobLease(opts: {
  jobName: string;
  runId: string;
}): Promise<void> {
  const { error } = await supabase.rpc("release_cron_job_lease", {
    p_job_name: opts.jobName,
    p_run_id: opts.runId,
  });
  if (error && !leaseUnavailable(error.message)) {
    throw new Error(`cron lease release failed for ${opts.jobName}: ${error.message}`);
  }
}
