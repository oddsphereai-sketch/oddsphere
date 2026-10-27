/** Pure cron-lease identity helpers. This module must remain free of DB/env imports. */
export function cronJobName(dataSource: string, sport: string | null): string {
  return sport ? `${dataSource}:${sport}` : dataSource;
}

export function resolveCronLeaseJobName(
  dataSource: string,
  sport: string | null,
  leaseGroup?: string,
): string {
  return cronJobName(leaseGroup ?? dataSource, sport);
}
