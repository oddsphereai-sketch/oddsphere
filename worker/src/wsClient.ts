/**
 * SharpAPI WebSocket client — connect/auth/subscribe/heartbeat/reconnect with
 * global_seq resume. Per docs.sharpapi.io/en/streaming/websocket.
 *
 * Testability: the socket factory and scheduler are injected, so the mock-WS
 * integration tests drive a fake socket through real reconnect/heartbeat logic
 * with no network and no real timers. The pure decision helpers (buildWsUrl,
 * backoffMs, classifyCloseCode) are exported and unit-tested directly.
 *
 * SECURITY: api_key lives in the URL query; the connect URL is NEVER logged
 * verbatim — callers log via redactSecrets (see config.ts).
 */

import { createRequire } from "node:module";
import { redactSecrets } from "./config";

/** Minimal socket surface we depend on (subset of the `ws` package + DOM WS). */
export interface WsLike {
  on(event: "open" | "message" | "close" | "error" | "pong", cb: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  terminate?(): void;
}

export type WsFactory = (url: string) => WsLike;

export interface Scheduler {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export const realScheduler: Scheduler = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export type BuildWsUrlOpts = {
  baseUrl: string; // wss://ws.sharpapi.io
  apiKey: string;
  channels: string[];
  sport: string;
  league: string;
  /** When resuming after a drop, pass the last seen global_seq. */
  fromSeq?: number | null;
};

/** Build the connect URL with query params. Pure. */
export function buildWsUrl(opts: BuildWsUrlOpts): string {
  const params = new URLSearchParams();
  params.set("api_key", opts.apiKey);
  if (opts.channels.length > 0) params.set("channels", opts.channels.join(","));
  if (opts.sport) params.set("sport", opts.sport);
  if (opts.league) params.set("league", opts.league);
  if (opts.fromSeq !== undefined && opts.fromSeq !== null) {
    params.set("resume", "true");
    params.set("from_seq", String(opts.fromSeq));
  }
  return `${opts.baseUrl}?${params.toString()}`;
}

/** Exponential backoff with jitter, capped. Pure (jitter injectable for tests). */
export function backoffMs(attempt: number, maxBackoffMs: number, rand: () => number = Math.random): number {
  const base = Math.min(maxBackoffMs, 1000 * 2 ** Math.max(0, attempt - 1));
  const jitter = base * 0.25 * rand();
  return Math.min(maxBackoffMs, Math.round(base + jitter));
}

export type CloseDisposition = "fatal" | "backoff_hard" | "reconnect";

/** Map a WS close code to a reconnect disposition. Pure. */
export function classifyCloseCode(code: number): CloseDisposition {
  if (code === 4001 || code === 4003) return "fatal"; // bad/missing key, no streaming access
  if (code === 4029) return "backoff_hard"; // too many connections — single-instance guard
  return "reconnect";
}

export type WsClientEvents = {
  onMessage: (raw: unknown) => void;
  onOpen: () => void;
  onClose: (code: number) => void;
  onReconnectScheduled: (delayMs: number, attempt: number) => void;
  onFatal: (code: number) => void;
  onHeartbeatTimeout: () => void;
};

export type WsClientOpts = {
  baseUrl: string;
  apiKey: string;
  channels: string[];
  sport: string;
  league: string;
  heartbeatMs: number;
  maxBackoffMs: number;
  socketFactory: WsFactory;
  scheduler?: Scheduler;
  log?: (line: string) => void;
  rand?: () => number;
};

/**
 * One persistent connection for a single (sport, league) subscription.
 * (Multiple subscriptions = multiple SharpWsClient instances; SharpAPI returns
 * 4029 on duplicate subscriptions, so callers must keep one instance per sub.)
 */
export class SharpWsClient {
  private readonly opts: WsClientOpts;
  private readonly sched: Scheduler;
  private readonly ev: WsClientEvents;
  private socket: WsLike | null = null;
  private stopped = false;
  private attempt = 0;
  private lastSeq: number | null = null;
  private lastActivity = 0;
  private heartbeatHandle: unknown = null;
  private reconnectHandle: unknown = null;

  constructor(opts: WsClientOpts, ev: WsClientEvents) {
    this.opts = opts;
    this.sched = opts.scheduler ?? realScheduler;
    this.ev = ev;
  }

  private log(line: string): void {
    this.opts.log?.(redactSecrets(line, [this.opts.apiKey]));
  }

  /** Latest global_seq observed (for resume + health). */
  get globalSeq(): number | null {
    return this.lastSeq;
  }

  /** Note a message's seq (called by the pipeline/owner as frames arrive). */
  noteSeq(seq: number | null): void {
    if (seq !== null && (this.lastSeq === null || seq > this.lastSeq)) this.lastSeq = seq;
    this.lastActivity = this.sched.now();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatHandle) this.sched.clearTimer(this.heartbeatHandle);
    if (this.reconnectHandle) this.sched.clearTimer(this.reconnectHandle);
    this.heartbeatHandle = null;
    this.reconnectHandle = null;
    try { this.socket?.close(1000, "worker stop"); } catch { /* noop */ }
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = buildWsUrl({
      baseUrl: this.opts.baseUrl,
      apiKey: this.opts.apiKey,
      channels: this.opts.channels,
      sport: this.opts.sport,
      league: this.opts.league,
      fromSeq: this.lastSeq,
    });
    this.log(`connecting ${url}`); // redacted by this.log
    const socket = this.opts.socketFactory(url);
    this.socket = socket;
    this.lastActivity = this.sched.now();

    socket.on("open", () => {
      this.attempt = 0;
      this.lastActivity = this.sched.now();
      this.ev.onOpen();
      this.scheduleHeartbeat();
    });
    socket.on("message", (data: unknown) => {
      this.lastActivity = this.sched.now();
      const raw = parseFrame(data);
      if (raw !== undefined) this.ev.onMessage(raw);
    });
    socket.on("pong", () => { this.lastActivity = this.sched.now(); });
    socket.on("error", () => { /* error precedes close; handled in close */ });
    socket.on("close", (code: unknown) => {
      const c = typeof code === "number" ? code : 1006;
      this.onClose(c);
    });
  }

  private onClose(code: number): void {
    if (this.heartbeatHandle) this.sched.clearTimer(this.heartbeatHandle);
    this.heartbeatHandle = null;
    this.socket = null;
    this.ev.onClose(code);
    if (this.stopped) return;

    const disposition = classifyCloseCode(code);
    if (disposition === "fatal") {
      this.log(`fatal close code ${code} — not reconnecting (check API key / streaming access)`);
      this.ev.onFatal(code);
      return;
    }
    this.attempt += 1;
    const extra = disposition === "backoff_hard" ? this.opts.maxBackoffMs : 0;
    const delay = Math.min(this.opts.maxBackoffMs, backoffMs(this.attempt, this.opts.maxBackoffMs, this.opts.rand) + extra);
    this.ev.onReconnectScheduled(delay, this.attempt);
    this.reconnectHandle = this.sched.setTimer(() => this.connect(), delay);
  }

  private scheduleHeartbeat(): void {
    if (this.stopped) return;
    this.heartbeatHandle = this.sched.setTimer(() => this.heartbeatTick(), this.opts.heartbeatMs);
  }

  private heartbeatTick(): void {
    if (this.stopped || this.socket === null) return;
    const idle = this.sched.now() - this.lastActivity;
    if (idle > this.opts.heartbeatMs * 2) {
      // No traffic for 2× the ping window — force a reconnect.
      this.ev.onHeartbeatTimeout();
      try { (this.socket.terminate ?? this.socket.close).call(this.socket); } catch { /* noop */ }
      this.onClose(1006);
      return;
    }
    try { this.socket.ping?.(); } catch { /* noop */ }
    this.scheduleHeartbeat();
  }
}

/** Parse a WS frame (Buffer/string) into JSON; undefined on parse failure. */
export function parseFrame(data: unknown): unknown {
  try {
    const text =
      typeof data === "string"
        ? data
        : data !== null && typeof data === "object" && "toString" in data
          ? String(data)
          : "";
    if (!text) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Default production socket factory — lazily requires `ws` so the package is
 * only needed at deploy time (tests inject their own factory). Returns a
 * WsLike. Uses createRequire so the dynamic dependency is resolved at runtime
 * without a static import that would couple the bundle.
 */
export function defaultSocketFactory(url: string): WsLike {
  const req = createRequire(import.meta.url);
  const WS = req("ws") as new (u: string) => WsLike;
  return new WS(url);
}
