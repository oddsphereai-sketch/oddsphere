/**
 * Worker config loading + secret redaction.
 * Run: npx tsx worker/test/test-config-redaction.ts
 */
import { loadConfig, parseSubscriptions, redactSecrets } from "../src/config";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// Disabled worker boots with no secrets (default OFF).
{
  const cfg = loadConfig({});
  check("default workerEnabled=false", cfg.flags.workerEnabled === false);
  check("default recomputeActive=false", cfg.flags.recomputeActive === false);
  check("default shadow=true", cfg.flags.shadow === true);
  check("default wsUrl", cfg.wsUrl === "wss://ws.sharpapi.io");
  check("default channels=[odds]", cfg.channels.length === 1 && cfg.channels[0] === "odds");
}

// Enabled worker without secrets throws.
{
  let threw = false;
  try { loadConfig({ STREAM_WORKER_ENABLED: "true" }); } catch { threw = true; }
  check("enabled without secrets throws", threw);
}

// Enabled worker with required config loads.
{
  const cfg = loadConfig({
    STREAM_WORKER_ENABLED: "true",
    SHARPAPI_KEY: "k_live_abc",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "svc_role_xyz",
    STREAM_SUBSCRIPTIONS: "baseball:mlb",
  });
  check("enabled loads", cfg.flags.workerEnabled === true);
  check("subscriptions parsed", cfg.subscriptions.length === 1 && cfg.subscriptions[0].sport === "baseball");
}

// recomputeActive requires base url + cron secret.
{
  let threw = false;
  try {
    loadConfig({
      STREAM_WORKER_ENABLED: "true", STREAM_RECOMPUTE_ACTIVE: "true",
      SHARPAPI_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "s",
      STREAM_SUBSCRIPTIONS: "baseball:mlb",
    });
  } catch { threw = true; }
  check("recomputeActive without base url/secret throws", threw);
}

// parseSubscriptions
{
  const subs = parseSubscriptions("baseball:mlb, soccer:fifa_world_cup");
  check("parse 2 subs", subs.length === 2);
  check("parse sport/league", subs[1].sport === "soccer" && subs[1].league === "fifa_world_cup");
  check("parse empty → []", parseSubscriptions(undefined).length === 0);
}

// Redaction: api_key query param + literal secret values.
{
  const url = "wss://ws.sharpapi.io?api_key=SUPERSECRET123&channels=odds&sport=baseball";
  const red = redactSecrets(url, ["SUPERSECRET123"]);
  check("api_key value redacted", !red.includes("SUPERSECRET123"));
  check("api_key param masked", red.includes("api_key=***REDACTED***"));
  check("non-secret kept", red.includes("channels=odds"));
}
{
  const line = "recompute non-2xx auth Bearer cron_secret_value status=401";
  const red = redactSecrets(line, ["cron_secret_value"]);
  check("cron secret redacted", !red.includes("cron_secret_value"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
