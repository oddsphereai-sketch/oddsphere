/**
 * Regression guard for the alternate-line pollution bug (2026-06-16):
 * SharpAPI sends alternate totals/spreads that share (game, market, book, side)
 * with the main line. Before the fix they overwrote odds_current_stream and the
 * summarizer logged fake "movement" (e.g. total 9.0 → 11.0 = +2.0).
 *
 * Proves: alternate lines (flagged OR detected by a > MAX_MAIN_LINE_STEP point
 * jump) are appended to odds_events_raw (is_alternate=true) but NEVER overwrite
 * the main current snapshot and NEVER create a movement row.
 * Run: npx tsx worker/test/test-alt-line-guard.ts
 */
import { StreamPipeline } from "../src/pipeline";
import { HealthTracker } from "../src/health";
import { MovementDebouncer } from "../../lib/streaming/debounce";
import type { StreamWriter, RawEventRow, CurrentRow, MovementRow, HealthPatch } from "../src/streamTypes";
import type { GameResolver, ResolvedGame } from "../src/gameResolver";
import type { NormalizedOddsEvent } from "../../lib/providers/real_api/ws/sharpApiWsAdapter";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

class MockWriter implements StreamWriter {
  raw: RawEventRow[] = []; current: CurrentRow[] = []; movements: MovementRow[] = []; health: HealthPatch[] = [];
  async writeRawEvents(r: RawEventRow[]) { this.raw.push(...r); }
  async upsertCurrents(r: CurrentRow[]) { this.current.push(...r); }
  async writeMovements(r: MovementRow[]) { this.movements.push(...r); }
  async upsertHealth(p: HealthPatch) { this.health.push(p); }
}
const resolver: GameResolver = async (): Promise<ResolvedGame | null> =>
  ({ id: 777, externalId: 555, sport: "mlb", slateDate: "2026-06-16", gameDate: "2030-01-01T00:00:00Z" });

function makePipeline() {
  const writer = new MockWriter();
  const pipeline = new StreamPipeline({
    resolveGame: resolver, writer,
    health: new HealthTracker("sharpapi_ws", "mlb", () => "2026-06-16T18:00:00Z"),
    debouncer: new MovementDebouncer(), recompute: null, recomputeActive: false, shadow: true,
    rawAuditEnabled: true, // this suite verifies the odds_events_raw audit rows
    now: () => 1_000_000,
  });
  return { writer, pipeline };
}
let seq = 1;
function row(over: Record<string, unknown>): Record<string, unknown> {
  return { event_id: "evt1", sportsbook: "draftkings", home_team: "New York Yankees", away_team: "Boston Red Sox", timestamp: "2026-06-16T18:00:00Z", ...over };
}
function frame(rows: Record<string, unknown>[]): unknown {
  return { type: "odds:update", sport: "baseball", league: "mlb", global_seq: seq++, data: rows };
}
const lastCurrent = (w: MockWriter, market: string, side: string): CurrentRow | undefined =>
  [...w.current].reverse().find((c) => c.market_type === market && c.side === side);

async function main() {
  // ── TEST 6: two total line_values (8.5 main, 11.0 alt) must not overwrite ──
  // Unflagged 11.0 caught by the point-jump guard; flagged 11.0 caught by flag.
  for (const flagged of [false, true]) {
    const { writer, pipeline } = makePipeline();
    await pipeline.handleMessage({ type: "snapshot:complete" });
    await pipeline.handleMessage(frame([row({ market_type: "total", selection_type: "under", line: 8.5, odds_american: -110 })]));
    await pipeline.handleMessage(frame([row({ market_type: "total", selection_type: "under", line: 9.0, odds_american: -110 })])); // real +0.5 main move
    await pipeline.handleMessage(frame([row({ market_type: "total", selection_type: "under", line: 11.0, odds_american: -110, ...(flagged ? { is_alternate: true } : {}) })])); // alt

    const cur = lastCurrent(writer, "total", "under");
    check(`[alt total ${flagged ? "flagged" : "jump"}] current stays main 9.0 (not 11.0)`, cur?.line_value === 9.0);
    check(`[alt total ${flagged ? "flagged" : "jump"}] no movement jumps to 11.0`, !writer.movements.some((m) => m.next_line_value === 11.0));
    check(`[alt total ${flagged ? "flagged" : "jump"}] real 8.5→9.0 move logged`, writer.movements.some((m) => m.prev_line_value === 8.5 && m.next_line_value === 9.0));
    check(`[alt total ${flagged ? "flagged" : "jump"}] 11.0 in raw as is_alternate`, writer.raw.some((r) => r.line_value === 11.0 && r.is_alternate === true));
    check(`[alt total ${flagged ? "flagged" : "jump"}] all movements within ±1.0 step`, writer.movements.every((m) => m.prev_line_value == null || m.next_line_value == null || Math.abs((m.next_line_value) - (m.prev_line_value)) <= 1.0));
  }

  // ── TEST 7: spread alternates (-1.5 flagged, +3.5 jump) → no fake crossed-key ──
  {
    const { writer, pipeline } = makePipeline();
    await pipeline.handleMessage({ type: "snapshot:complete" });
    await pipeline.handleMessage(frame([row({ market_type: "spread", selection_type: "away", line: 1.5, odds_american: -110 })])); // main runline
    await pipeline.handleMessage(frame([row({ market_type: "spread", selection_type: "away", line: -1.5, odds_american: -110, is_alternate: true })])); // flagged alt
    await pipeline.handleMessage(frame([row({ market_type: "spread", selection_type: "away", line: 3.5, odds_american: -110 })])); // jump alt (2.0 > 1.0)

    const cur = lastCurrent(writer, "spread", "away");
    check("[alt spread] current stays main 1.5", cur?.line_value === 1.5);
    check("[alt spread] no movement crossed a key number", !writer.movements.some((m) => m.crossed_key_number === true));
    check("[alt spread] no movement to alt -1.5 / 3.5", !writer.movements.some((m) => m.next_line_value === -1.5 || m.next_line_value === 3.5));
    check("[alt spread] both alts in raw as is_alternate", writer.raw.filter((r) => r.market_type === "spread" && r.is_alternate === true).length === 2);
  }

  // ── Sanity: ML (no line) is unaffected — main movement still flows ──
  {
    const { writer, pipeline } = makePipeline();
    await pipeline.handleMessage({ type: "snapshot:complete" });
    await pipeline.handleMessage(frame([row({ market_type: "moneyline", selection_type: "home", odds_american: -110 })]));
    await pipeline.handleMessage(frame([row({ market_type: "moneyline", selection_type: "home", odds_american: -125 })]));
    check("[ML] main movement still logged", writer.movements.some((m) => m.market_type === "moneyline" && m.delta_cents === -15));
  }
}

main().then(() => {
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
