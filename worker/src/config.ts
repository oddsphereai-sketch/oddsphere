/**
 * Worker configuration + secret redaction.
 *
 * Config is loaded from env (12-factor) so the worker is host-portable
 * (Render now, Fly later — no host coupling). `loadConfig` takes an explicit
 * env object so it is unit-testable without touching process.env.
 *
 * SECURITY: the SharpAPI api_key is passed in the WS URL query string, so it
 * MUST be redacted from every log line. `redactSecrets` strips both the
 * `api_key=…` query param and any literal occurrence of the key value.
 */

export type Subscription = {
  /** SharpAPI sport vocab, e.g. "baseball" | "soccer". */
  sport: string;
  /** SharpAPI league, e.g. "mlb". */
  league: string;
};

export type WorkerConfig = {
  wsUrl: string; // e.g. wss://ws.sharpapi.io
  apiKey: string;
  channels: string[]; // v1: ["odds"]
  subscriptions: Subscription[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  internalBaseUrl: string; // Vercel base URL for the recompute route
  cronSecret: string;
  flags: {
    /** Master switch — when false the worker boots, logs, and idles (no connect). */
    workerEnabled: boolean;
    /** When false the worker NEVER calls the recompute route (records stream only). */
    recomputeActive: boolean;
    /** When true, recompute calls are dry-run (route writes nothing). Defaults true. */
    shadow: boolean;
    /**
     * When false (DEFAULT), the worker does NOT write the per-frame
     * `odds_events_raw` audit log for ACCEPTED/alternate ticks — that table is
     * never read by the app and was the dominant write load that saturated the
     * DB (2026-06-16 incident). odds_current_stream + line_movements (what the
     * app uses) are unaffected. Unresolved events are still logged (low volume,
     * resolution diagnostic). Flip on only for short debugging windows.
     */
    rawAuditEnabled: boolean;
  };
  heartbeatMs: number;
  maxBackoffMs: number;
};

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Build the typed config from an env map. Throws ONLY for the secrets required
 * to actually connect, and ONLY when the worker is enabled — so a disabled
 * worker (the default) can boot in any environment for health/idle without
 * secrets present.
 */
export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  const workerEnabled = bool(env.STREAM_WORKER_ENABLED, false);
  const recomputeActive = bool(env.STREAM_RECOMPUTE_ACTIVE, false);
  const shadow = bool(env.STREAM_RECOMPUTE_SHADOW, true);
  const rawAuditEnabled = bool(env.STREAM_RAW_AUDIT_ENABLED, false);

  const cfg: WorkerConfig = {
    wsUrl: env.SHARPAPI_WS_URL ?? "wss://ws.sharpapi.io",
    apiKey: env.SHARPAPI_KEY ?? "",
    channels: (env.STREAM_CHANNELS ?? "odds").split(",").map((s) => s.trim()).filter(Boolean),
    subscriptions: parseSubscriptions(env.STREAM_SUBSCRIPTIONS),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    internalBaseUrl: env.VERCEL_INTERNAL_BASE_URL ?? "",
    cronSecret: env.CRON_SECRET ?? "",
    flags: { workerEnabled, recomputeActive, shadow, rawAuditEnabled },
    heartbeatMs: Number(env.STREAM_HEARTBEAT_MS ?? "25000"),
    maxBackoffMs: Number(env.STREAM_MAX_BACKOFF_MS ?? "30000"),
  };

  if (workerEnabled) {
    const missing: string[] = [];
    if (!cfg.apiKey) missing.push("SHARPAPI_KEY");
    if (!cfg.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!cfg.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (recomputeActive && !cfg.internalBaseUrl) missing.push("VERCEL_INTERNAL_BASE_URL");
    if (recomputeActive && !cfg.cronSecret) missing.push("CRON_SECRET");
    if (cfg.subscriptions.length === 0) missing.push("STREAM_SUBSCRIPTIONS");
    if (missing.length > 0) {
      throw new Error(`Worker enabled but missing required config: ${missing.join(", ")}`);
    }
  }
  return cfg;
}

/** Parse "baseball:mlb,soccer:fifa_world_cup" → [{sport,league},…]. */
export function parseSubscriptions(raw: string | undefined): Subscription[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [sport, league] = pair.split(":").map((s) => s.trim());
      return { sport, league: league ?? "" };
    })
    .filter((s) => s.sport.length > 0);
}

/**
 * Redact secrets from a string for safe logging. Strips `api_key=…` query
 * params and any literal occurrence of each provided secret value.
 */
export function redactSecrets(input: string, secrets: string[] = []): string {
  let out = input.replace(/(api_key=)[^&\s]+/gi, "$1***REDACTED***");
  for (const s of secrets) {
    if (s && s.length >= 4) {
      out = out.split(s).join("***REDACTED***");
    }
  }
  return out;
}
