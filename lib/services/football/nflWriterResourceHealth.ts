/** Private process diagnostics only: no player, source, price or response data. */
export function reportNflWriterResourceStage(
  writerRelease: string,
  stage: "started" | "history_ready" | "collection_ready" | "context_ready" | "forecasts_ready",
  startedAtMs: number,
): void {
  const memory = process.memoryUsage();
  console.info("[nfl-writer-resource]", JSON.stringify({
    writerRelease, stage, elapsedMs: Math.max(0, Date.now() - startedAtMs),
    rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers,
  }));
}
