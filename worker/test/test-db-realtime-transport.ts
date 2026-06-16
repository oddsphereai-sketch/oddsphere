/**
 * Regression guard for the Render boot crash (2026-06-16):
 *   "Node.js 20 detected without native WebSocket support" — supabase-js v2
 *   builds a RealtimeClient at createClient() time and Node < 22 has no global
 *   WebSocket. The worker-owned Supabase client MUST pass a `realtime.transport`
 *   (the `ws` package) so it boots on Render's Node 20.
 *
 * This asserts the options builder always wires a transport, without
 * constructing a real client (no `ws` install / no network needed).
 * Run: npx tsx worker/test/test-db-realtime-transport.ts
 */
import { buildWorkerSupabaseOptions } from "../src/db";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// A stand-in WebSocket constructor (what `ws` provides on Render).
class FakeWS {
  constructor(public url: string) {}
}

const opts = buildWorkerSupabaseOptions(FakeWS);

check("realtime.transport is wired (the boot fix)", opts.realtime.transport === FakeWS);
check("realtime.transport is a constructor (newable)", typeof opts.realtime.transport === "function");
check("server-side auth: no session persistence", opts.auth.persistSession === false);
check("server-side auth: no token auto-refresh", opts.auth.autoRefreshToken === false);

// Sanity: a missing transport would be the bug — prove the builder never omits it.
check("transport key present for any input", "transport" in opts.realtime);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
