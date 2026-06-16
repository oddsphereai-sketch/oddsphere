/**
 * In-memory stream-health counters for one (provider, sport). Periodically
 * flushed to the stream_health table. Powers the "is the stream live or are we
 * on cron fallback" check that gates enabling live recomputes.
 */

import type { StreamWriter, HealthPatch } from "./streamTypes";

export class HealthTracker {
  private connected = false;
  private lastConnectAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastGlobalSeq: number | null = null;
  private messages = 0;
  private writes = 0;
  private recomputes = 0;
  private errors = 0;
  private reconnects = 0;

  constructor(
    private readonly provider: string,
    private readonly sport: string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  onConnect(): void {
    this.connected = true;
    this.lastConnectAt = this.nowIso();
  }
  onDisconnect(): void {
    this.connected = false;
  }
  onHeartbeat(): void {
    this.lastHeartbeatAt = this.nowIso();
  }
  onMessage(seq: number | null): void {
    this.messages += 1;
    this.lastMessageAt = this.nowIso();
    if (seq !== null && (this.lastGlobalSeq === null || seq > this.lastGlobalSeq)) {
      this.lastGlobalSeq = seq;
    }
  }
  onWrite(n = 1): void {
    this.writes += n;
  }
  onRecompute(): void {
    this.recomputes += 1;
  }
  onError(): void {
    this.errors += 1;
  }
  onReconnect(): void {
    this.reconnects += 1;
  }

  snapshot(): HealthPatch {
    return {
      provider: this.provider,
      sport: this.sport,
      connected: this.connected,
      last_connect_at: this.lastConnectAt ?? undefined,
      last_heartbeat_at: this.lastHeartbeatAt ?? undefined,
      last_message_at: this.lastMessageAt ?? undefined,
      last_global_seq: this.lastGlobalSeq,
      messages_total: this.messages,
      writes_total: this.writes,
      recompute_calls: this.recomputes,
      error_count: this.errors,
      reconnect_count: this.reconnects,
    };
  }

  async flush(writer: StreamWriter): Promise<void> {
    await writer.upsertHealth(this.snapshot());
  }
}
