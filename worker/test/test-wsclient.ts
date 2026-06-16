/**
 * WS client — pure helpers + reconnect/heartbeat/fatal flow driven by a fake
 * socket + fake scheduler (no network, no real timers).
 * Run: npx tsx worker/test/test-wsclient.ts
 */
import {
  buildWsUrl,
  backoffMs,
  classifyCloseCode,
  parseFrame,
  SharpWsClient,
  type WsLike,
  type Scheduler,
} from "../src/wsClient";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// ── pure helpers ──
{
  const url = buildWsUrl({ baseUrl: "wss://ws.sharpapi.io", apiKey: "K", channels: ["odds"], sport: "baseball", league: "mlb" });
  check("url has api_key", url.includes("api_key=K"));
  check("url has channels", url.includes("channels=odds"));
  check("url has sport+league", url.includes("sport=baseball") && url.includes("league=mlb"));
  check("url no resume by default", !url.includes("resume="));
  const resumed = buildWsUrl({ baseUrl: "wss://ws.sharpapi.io", apiKey: "K", channels: ["odds"], sport: "baseball", league: "mlb", fromSeq: 42 });
  check("resume url has from_seq", resumed.includes("resume=true") && resumed.includes("from_seq=42"));
}
{
  check("backoff attempt1=1000", backoffMs(1, 30000, () => 0) === 1000);
  check("backoff attempt2=2000", backoffMs(2, 30000, () => 0) === 2000);
  check("backoff attempt3=4000", backoffMs(3, 30000, () => 0) === 4000);
  check("backoff capped at max", backoffMs(20, 30000, () => 0) === 30000);
  check("backoff monotonic with jitter", backoffMs(3, 30000, () => 1) >= backoffMs(2, 30000, () => 0));
}
{
  check("4001 fatal", classifyCloseCode(4001) === "fatal");
  check("4003 fatal", classifyCloseCode(4003) === "fatal");
  check("4029 backoff_hard", classifyCloseCode(4029) === "backoff_hard");
  check("1006 reconnect", classifyCloseCode(1006) === "reconnect");
}
{
  check("parseFrame json", JSON.stringify(parseFrame('{"a":1}')) === JSON.stringify({ a: 1 }));
  check("parseFrame garbage → undefined", parseFrame("not json") === undefined);
}

// ── fake socket + scheduler ──
class FakeSocket implements WsLike {
  handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  pinged = 0;
  closed = false;
  on(e: string, cb: (...a: unknown[]) => void) { (this.handlers[e] ??= []).push(cb); }
  send() { /* noop */ }
  close(code?: number) { this.closed = true; this.emit("close", code ?? 1000); }
  ping() { this.pinged++; }
  terminate() { this.closed = true; }
  emit(e: string, ...a: unknown[]) { (this.handlers[e] ?? []).forEach((f) => f(...a)); }
}
class FakeScheduler implements Scheduler {
  t = 0;
  private timers: { id: number; fn: () => void; due: number }[] = [];
  private nextId = 1;
  setTimer(fn: () => void, ms: number) { const id = this.nextId++; this.timers.push({ id, fn, due: this.t + ms }); return id; }
  clearTimer(h: unknown) { this.timers = this.timers.filter((x) => x.id !== h); }
  now() { return this.t; }
  advance(ms: number) {
    this.t += ms;
    let due = this.timers.filter((x) => x.due <= this.t).sort((a, b) => a.due - b.due);
    while (due.length > 0) {
      const next = due.shift()!;
      this.timers = this.timers.filter((x) => x.id !== next.id);
      next.fn();
      due = this.timers.filter((x) => x.due <= this.t).sort((a, b) => a.due - b.due);
    }
  }
}

function makeClient(sched: FakeScheduler, sockets: FakeSocket[], events: Record<string, number>, logs: string[]) {
  return new SharpWsClient(
    {
      baseUrl: "wss://ws.sharpapi.io", apiKey: "SECRETKEY", channels: ["odds"],
      sport: "baseball", league: "mlb", heartbeatMs: 1000, maxBackoffMs: 30000,
      socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
      scheduler: sched, rand: () => 0, log: (l) => logs.push(l),
    },
    {
      onMessage: () => { events.message = (events.message ?? 0) + 1; },
      onOpen: () => { events.open = (events.open ?? 0) + 1; },
      onClose: () => { events.close = (events.close ?? 0) + 1; },
      onReconnectScheduled: () => { events.reconnect = (events.reconnect ?? 0) + 1; },
      onFatal: () => { events.fatal = (events.fatal ?? 0) + 1; },
      onHeartbeatTimeout: () => { events.hbtimeout = (events.hbtimeout ?? 0) + 1; },
    },
  );
}

// Reconnect after a non-fatal close.
{
  const sched = new FakeScheduler(); const sockets: FakeSocket[] = []; const events: Record<string, number> = {}; const logs: string[] = [];
  const client = makeClient(sched, sockets, events, logs);
  client.start();
  check("1 socket on start", sockets.length === 1);
  sockets[0].emit("open");
  check("onOpen fired", events.open === 1);
  sockets[0].emit("close", 1006);
  check("onClose fired", events.close === 1);
  check("reconnect scheduled", events.reconnect === 1);
  sched.advance(1000); // backoff for attempt1 = 1000ms
  check("reconnected → 2 sockets", sockets.length === 2);
  client.stop();
}

// Fatal close does NOT reconnect.
{
  const sched = new FakeScheduler(); const sockets: FakeSocket[] = []; const events: Record<string, number> = {}; const logs: string[] = [];
  const client = makeClient(sched, sockets, events, logs);
  client.start();
  sockets[0].emit("open");
  sockets[0].emit("close", 4001); // bad key
  check("onFatal fired", events.fatal === 1);
  check("no reconnect scheduled on fatal", (events.reconnect ?? 0) === 0);
  sched.advance(60000);
  check("no new socket after fatal", sockets.length === 1);
  client.stop();
}

// Heartbeat: ping is sent; idle 2× window → heartbeat timeout + reconnect.
{
  const sched = new FakeScheduler(); const sockets: FakeSocket[] = []; const events: Record<string, number> = {}; const logs: string[] = [];
  const client = makeClient(sched, sockets, events, logs);
  client.start();
  sockets[0].emit("open"); // schedules heartbeat at +1000
  sched.advance(1000); // activity recent → ping, reschedule
  check("ping sent on heartbeat tick", sockets[0].pinged >= 1);
  sched.advance(3000); // no activity for >2× window → timeout
  check("heartbeat timeout fired", (events.hbtimeout ?? 0) >= 1);
  client.stop();
}

// API key never appears in logs (redaction).
{
  const sched = new FakeScheduler(); const sockets: FakeSocket[] = []; const events: Record<string, number> = {}; const logs: string[] = [];
  const client = makeClient(sched, sockets, events, logs);
  client.start();
  check("logs produced", logs.length >= 1);
  check("API key never in logs", logs.every((l) => !l.includes("SECRETKEY")));
  check("connect log redacted api_key", logs.some((l) => l.includes("api_key=***REDACTED***")));
  client.stop();
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
