/**
 * Stream pipeline integration test — drives the full flow through real adapter,
 * trigger engine, and debouncer with mock writer/resolver/recompute. No
 * network, no DB. Asserts: blocked-book drop, unresolved handling, dedup
 * throttle, snapshot:complete gating, movement logging, trigger→debounce→
 * recompute, recompute suppressed when flag OFF, moved-against-Best-Angle.
 * Run: npx tsx worker/test/test-pipeline.ts
 */
import { StreamPipeline, hashEvent, type PickProvider } from "../src/pipeline";
import { HealthTracker } from "../src/health";
import { MovementDebouncer } from "../../lib/streaming/debounce";
import type { StreamWriter, RawEventRow, CurrentRow, MovementRow, HealthPatch } from "../src/streamTypes";
import type { GameResolver, ResolvedGame } from "../src/gameResolver";
import type { RecomputeClient, RecomputeRequest } from "../src/recomputeClient";
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
class MockRecompute implements RecomputeClient {
  requests: RecomputeRequest[] = [];
  async requestRecompute(req: RecomputeRequest) { this.requests.push(req); return { ok: true, status: 200 }; }
}

const FUTURE_GAME_DATE = "2030-01-01T00:00:00Z"; // far future → outside attention window
// Resolver: resolves to a fixed MLB game unless the event id says UNRESOLVED.
const resolver: GameResolver = async (ev: NormalizedOddsEvent): Promise<ResolvedGame | null> => {
  if (ev.providerEventId === "UNRESOLVED") return null;
  return { id: 777, externalId: 555, sport: "mlb", slateDate: "2026-06-16", gameDate: FUTURE_GAME_DATE };
};

function oddsFrame(rows: Record<string, unknown>[], type = "odds:update", seq = 1): unknown {
  return { type, sport: "baseball", league: "mlb", global_seq: seq, data: rows };
}
function mlRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    event_id: "evt1", sportsbook: "draftkings", market_type: "moneyline", selection_type: "home",
    odds_american: -110, home_team: "New York Yankees", away_team: "Boston Red Sox",
    timestamp: "2026-06-16T18:00:00Z", ...over,
  };
}

function makePipeline(opts: { recomputeActive: boolean; pickProvider?: PickProvider }) {
  const writer = new MockWriter();
  const recompute = new MockRecompute();
  const debouncer = new MovementDebouncer({ cooldownMs: 90_000, coalesceWindowMs: 7_000 });
  const health = new HealthTracker("sharpapi_ws", "mlb", () => "2026-06-16T18:00:00Z");
  let t = 1_000_000;
  const pipeline = new StreamPipeline({
    resolveGame: resolver, writer, health, debouncer, recompute,
    recomputeActive: opts.recomputeActive, shadow: true,
    pickProvider: opts.pickProvider,
    now: () => t,
  });
  return { writer, recompute, debouncer, health, pipeline, setNow: (v: number) => { t = v; }, getNow: () => t };
}

async function main() {
// ── blocked book dropped (no writes) ──
{
  const { writer, pipeline } = makePipeline({ recomputeActive: true });
  await pipeline.handleMessage(oddsFrame([mlRow({ sportsbook: "fliff" })]));
  check("blocked book → no raw write", writer.raw.length === 0);
  check("blocked book → no current", writer.current.length === 0);
}

// ── unresolved game → raw status unresolved, no current ──
{
  const { writer, pipeline } = makePipeline({ recomputeActive: true });
  await pipeline.handleMessage(oddsFrame([mlRow({ event_id: "UNRESOLVED" })]));
  check("unresolved → 1 raw row", writer.raw.length === 1);
  check("unresolved → status unresolved", writer.raw[0].status === "unresolved");
  check("unresolved → game_id null", writer.raw[0].game_id === null);
  check("unresolved → no current", writer.current.length === 0);
}

// ── first price records raw+current, no movement, no trigger pre-ready ──
{
  const { writer, debouncer, pipeline } = makePipeline({ recomputeActive: true });
  await pipeline.handleMessage(oddsFrame([mlRow()]));
  check("first price → 1 raw accepted", writer.raw.length === 1 && writer.raw[0].status === "accepted");
  check("first price → 1 current", writer.current.length === 1);
  check("first price → no movement row", writer.movements.length === 0);
  check("pre-ready → nothing registered", debouncer.pendingCount() === 0);
}

// ── dedup: identical consecutive price dropped ──
{
  const { writer, pipeline } = makePipeline({ recomputeActive: true });
  await pipeline.handleMessage(oddsFrame([mlRow()]));
  await pipeline.handleMessage(oddsFrame([mlRow()])); // identical
  check("dedup → still 1 raw row", writer.raw.length === 1);
}

// ── meaningful move after ready → movement + trigger + debounce + recompute ──
{
  const { writer, recompute, pipeline, getNow } = makePipeline({ recomputeActive: true });
  await pipeline.handleMessage(oddsFrame([mlRow()])); // first @ -110 (pre-ready)
  await pipeline.handleMessage({ type: "snapshot:complete" });
  check("snapshot:complete → ready", pipeline.isReady());
  await pipeline.handleMessage(oddsFrame([mlRow({ odds_american: -125 })], "odds:update", 2)); // +15c
  check("move → movement row written", writer.movements.length === 1);
  check("movement delta_cents = -15", writer.movements[0].delta_cents === -15);
  const flush1 = await pipeline.flush(getNow() + 7_000); // past coalesce window
  check("flush → recompute called once", recompute.requests.length === 1);
  check("recompute sport=mlb", recompute.requests[0].sport === "mlb");
  check("recompute date=2026-06-16", recompute.requests[0].date === "2026-06-16");
  check("recompute games=[555]", JSON.stringify(recompute.requests[0].gameExternalIds) === JSON.stringify([555]));
  check("recompute shadow=true", recompute.requests[0].shadow === true);
  check("flush summary recomputed 1", flush1.gamesRecomputed === 1);
}

// ── recompute SUPPRESSED when flag OFF (no live writes) ──
{
  const { recompute, pipeline, getNow } = makePipeline({ recomputeActive: false });
  await pipeline.handleMessage(oddsFrame([mlRow()]));
  await pipeline.handleMessage({ type: "snapshot:complete" });
  await pipeline.handleMessage(oddsFrame([mlRow({ odds_american: -125 })], "odds:update", 2));
  const flush = await pipeline.flush(getNow() + 7_000);
  check("flag OFF → no recompute call", recompute.requests.length === 0);
  check("flag OFF → flush recomputed 0", flush.gamesRecomputed === 0);
}

// ── moved-against active Best Angle fires via pickProvider ──
{
  const pickProvider: PickProvider = () => ({ pickSide: "home", activeGrade: "best_angle" });
  const { writer, recompute, pipeline, getNow } = makePipeline({ recomputeActive: true, pickProvider });
  await pipeline.handleMessage(oddsFrame([mlRow({ odds_american: -150 })])); // home -150
  await pipeline.handleMessage({ type: "snapshot:complete" });
  await pipeline.handleMessage(oddsFrame([mlRow({ odds_american: -130 })], "odds:update", 2)); // home lengthens → against
  check("moved-against-BA → movement direction against", writer.movements[0].direction_vs_pick === "against");
  await pipeline.flush(getNow() + 7_000);
  check("moved-against-BA → recompute fired", recompute.requests.length === 1);
}

// ── hashEvent deterministic + excludes any key material ──
{
  const ev: NormalizedOddsEvent = {
    kind: "update", providerEventId: "e", sport: "baseball", league: "mlb",
    homeRaw: "NYY", awayRaw: "BOS", homeAbbrev: "NYY", awayAbbrev: "BOS",
    sportsbook: "draftkings", isBlockedBook: false, marketType: "moneyline", side: "home",
    lineValue: null, oddsAmerican: -110, oddsDecimal: null, impliedProbability: null,
    providerTs: "t", globalSeq: 1, isAlternate: false,
  };
  check("hashEvent deterministic", hashEvent(ev) === hashEvent({ ...ev }));
  check("hashEvent changes with price", hashEvent(ev) !== hashEvent({ ...ev, oddsAmerican: -120 }));
  check("hashEvent is hex sha256 (64 chars)", /^[0-9a-f]{64}$/.test(hashEvent(ev)));
}

}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
