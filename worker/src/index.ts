/**
 * Worker entrypoint — boot + supervise.
 *
 * Default-OFF: when STREAM_WORKER_ENABLED is not "true" the process boots,
 * logs, and idles (no connection, no writes) — safe to deploy before go-live.
 * When enabled it opens one SharpWsClient per subscription, feeds frames to a
 * shared pipeline, and periodically flushes debounced triggers + health.
 *
 * The worker NEVER mutates predictions; it records stream data and (only when
 * STREAM_RECOMPUTE_ACTIVE) asks the authenticated Vercel route to recompute.
 */

import { loadConfig, redactSecrets, type WorkerConfig } from "./config";
import { SharpWsClient, defaultSocketFactory } from "./wsClient";
import { makeSupabase, makeStreamWriter, makeResolverDb } from "./db";
import { makeGameResolver } from "./gameResolver";
import { makeRecomputeClient } from "./recomputeClient";
import { MovementDebouncer } from "../../lib/streaming/debounce";
import { HealthTracker } from "./health";
import { StreamPipeline } from "./pipeline";
import { readGlobalSeq } from "../../lib/providers/real_api/ws/sharpApiWsAdapter";

const FLUSH_INTERVAL_MS = 2_000;
const HEALTH_FLUSH_INTERVAL_MS = 15_000;

function log(cfg: WorkerConfig, line: string): void {
  console.log(redactSecrets(`[stream-worker] ${line}`, [cfg.apiKey, cfg.cronSecret]));
}

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);

  if (!cfg.flags.workerEnabled) {
    log(cfg, "STREAM_WORKER_ENABLED is off — idling (no connection, no writes).");
    // Keep the process alive so the host doesn't crash-loop a disabled worker.
    setInterval(() => { /* idle */ }, 60_000);
    return;
  }

  log(cfg, `starting — subs=${cfg.subscriptions.map((s) => `${s.sport}:${s.league}`).join(",")} recomputeActive=${cfg.flags.recomputeActive} shadow=${cfg.flags.shadow}`);

  const supa = makeSupabase(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const writer = makeStreamWriter(supa);
  const resolveGame = makeGameResolver(makeResolverDb(supa));
  const debouncer = new MovementDebouncer();
  const recompute = cfg.flags.recomputeActive
    ? makeRecomputeClient({ baseUrl: cfg.internalBaseUrl, cronSecret: cfg.cronSecret, log: (l) => log(cfg, l) })
    : null;

  const clients: SharpWsClient[] = [];
  const trackers: HealthTracker[] = [];

  for (const sub of cfg.subscriptions) {
    const health = new HealthTracker("sharpapi_ws", sub.sport);
    trackers.push(health);
    const pipeline = new StreamPipeline({
      resolveGame,
      writer,
      health,
      debouncer,
      recompute,
      recomputeActive: cfg.flags.recomputeActive,
      shadow: cfg.flags.shadow,
      rawAuditEnabled: cfg.flags.rawAuditEnabled,
      log: (l) => log(cfg, l),
    });

    const client = new SharpWsClient(
      {
        baseUrl: cfg.wsUrl,
        apiKey: cfg.apiKey,
        channels: cfg.channels,
        sport: sub.sport,
        league: sub.league,
        heartbeatMs: cfg.heartbeatMs,
        maxBackoffMs: cfg.maxBackoffMs,
        socketFactory: defaultSocketFactory,
        log: (l) => log(cfg, l),
      },
      {
        onMessage: (raw) => {
          client.noteSeq(readGlobalSeq(raw));
          void pipeline.handleMessage(raw);
        },
        onOpen: () => { health.onConnect(); log(cfg, `connected ${sub.sport}:${sub.league}`); },
        onClose: (code) => { health.onDisconnect(); log(cfg, `closed ${sub.sport}:${sub.league} code=${code}`); },
        onReconnectScheduled: (delay, attempt) => { health.onReconnect(); log(cfg, `reconnect ${sub.sport} in ${delay}ms (attempt ${attempt})`); },
        onFatal: (code) => { health.onError(); log(cfg, `FATAL ${sub.sport} code=${code} — check API key / streaming access`); },
        onHeartbeatTimeout: () => { health.onError(); log(cfg, `heartbeat timeout ${sub.sport} — forcing reconnect`); },
      },
    );
    clients.push(client);

    // Per-subscription flush loop.
    setInterval(() => { void pipeline.flush(); }, FLUSH_INTERVAL_MS);
  }

  // Periodic health flush.
  setInterval(() => { for (const t of trackers) void t.flush(writer); }, HEALTH_FLUSH_INTERVAL_MS);

  for (const c of clients) c.start();

  const shutdown = () => {
    log(cfg, "shutting down");
    for (const c of clients) c.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error("[stream-worker] fatal boot error:", e);
  process.exit(1);
});
