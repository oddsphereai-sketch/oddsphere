/** Private process diagnostics only: no player, source, price or response data. */
export function reportNflWriterResourceStage(
  writerRelease: string,
  stage: "started" | "history_ready" | "collection_ready" | "context_ready" | "forecasts_ready"
    | "append_ready" | "member_ready" | "tracking_ready" | "boards_ready"
    | "source_callback_started" | "source_callback_ready" | "review_runtime_started" | "review_runtime_ready"
    | "final_snapshot_started" | "final_snapshot_ready" | "closing_ready" | "reference_cache_ready"
    | "observer_capture_ready" | "observer_closing_ready" | "settlement_ready" | "private_tracking_ready" | "finished",
  startedAtMs: number,
): void {
  const memory = process.memoryUsage();
  console.info("[nfl-writer-resource]", JSON.stringify({
    writerRelease, stage, elapsedMs: Math.max(0, Date.now() - startedAtMs),
    rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers,
  }));
}
