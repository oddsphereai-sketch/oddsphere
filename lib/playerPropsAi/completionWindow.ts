import { PROPS_AI_PART_CONCURRENCY, PROPS_AI_MIN_REVIEW_WINDOW_MS } from "./releases";

/** Reserve a complete bounded generation wave plus publication time, before claiming money. */
export function propsAiCompletionWindowMs(parts: number): number {
  if (!Number.isInteger(parts) || parts < 1 || parts > 16) throw new Error("Invalid review part count");
  return Math.max(PROPS_AI_MIN_REVIEW_WINDOW_MS, Math.ceil(parts / PROPS_AI_PART_CONCURRENCY) * 90_000 + 30_000);
}

/** One bounded pool shared by all games in the existing sport writer. */
export function propsAiGenerationPool(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error("Invalid generation concurrency");
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function slot<T>(run: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await run(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
