import {setImmediate as nextEventLoopTurn} from 'node:timers/promises';

export const NFL_COOPERATIVE_FORECAST_ROWS_RELEASE =
  'nfl_cooperative_forecast_rows_2026_11_26_r1_ordered_yield' as const;

/** Preserve the existing synchronous per-game calculation and order, while
 * allowing the same leased route's in-flight props I/O to make progress.
 * This does not preempt a calculation, create a writer or perform provider/storage I/O. */
export async function collectNflForecastRows<T, R>(
  plans: readonly T[], build: (plan: T) => readonly R[],
): Promise<R[]> {
  const rows: R[] = [];
  for (const plan of plans) {
    await nextEventLoopTurn();
    rows.push(...build(plan));
  }
  return rows;
}
