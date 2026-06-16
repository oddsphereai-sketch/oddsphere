/**
 * Unit + apply-smoke tests for lib/services/postedLinesWriter.ts.
 * Run: npx tsx scripts/test-posted-lines-writer.ts
 */
import {
  mergePostedLines,
  pickStreamEntry,
  pickCronEntry,
  buildIncomingPostedLines,
  recordFirstPublishedLines,
  type PostedLines,
  type LineRowLite,
  type StreamRowLite,
} from "../lib/services/postedLinesWriter";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

const cron: LineRowLite[] = [
  { market_type: "moneyline", side: "home", sportsbook: "fliff", odds_american: -999 },
  { market_type: "moneyline", side: "home", sportsbook: "betmgm", odds_american: -132, line_value: null },
  { market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -135, line_value: null },
  { market_type: "total", side: "over", sportsbook: "draftkings", odds_american: -110, line_value: 8.5 },
  { market_type: "first_inning_total", side: "under", sportsbook: "draftkings", odds_american: -118, line_value: 0.5 },
];

// ── pickCronEntry: trusted book, rich metadata, excludes blocked ──
{
  const e = pickCronEntry(cron, "moneyline", "home", "t1");
  check("cron entry prefers pinnacle", e?.book === "pinnacle" && e?.odds_american === -135);
  check("cron entry source_kind rest_cron", e?.source_kind === "rest_cron");
  check("cron entry carries side", e?.side === "home");
  check("cron entry no row → null", pickCronEntry(cron, "spread", "home", "t1") === null);
}

// ── pickStreamEntry: live stream, source_kind current_stream ──
{
  const stream: StreamRowLite[] = [
    { market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -138, line_value: null, observed_at: "2026-06-16T16:50:00Z" },
  ];
  const e = pickStreamEntry(stream, "moneyline", "home", "t1");
  check("stream entry source_kind current_stream", e?.source_kind === "current_stream");
  check("stream entry observed_at from row", e?.observed_at === "2026-06-16T16:50:00Z");
  check("stream entry odds", e?.odds_american === -138);
}

// ── buildIncomingPostedLines: stream preferred over cron; NRFI→under ──
{
  const stream: StreamRowLite[] = [
    { market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -138, line_value: null, observed_at: "ts" },
  ];
  const inc = buildIncomingPostedLines({ mlWinner: "home", ouSide: "over", nrfi: true }, stream, cron, "t1");
  check("ML from stream (preferred)", inc.moneyline?.source_kind === "current_stream" && inc.moneyline?.odds_american === -138);
  check("total from cron (no stream)", inc.total?.source_kind === "rest_cron" && inc.total?.odds_american === -110);
  check("total carries line_value", inc.total?.line_value === 8.5);
  check("FI from cron, NRFI→under", inc.first_inning?.side === "under" && inc.first_inning?.odds_american === -118);
  check("no-pick markets omitted", buildIncomingPostedLines({ mlWinner: null, ouSide: null, nrfi: null }, stream, cron, "t1").total === undefined);
}

// ── mergePostedLines: set-if-null ──
{
  const existing: PostedLines = { moneyline: { side: "home", line_value: null, odds_american: -130, book: "x", observed_at: "old", source: "rest_cron", source_kind: "rest_cron" } };
  const incoming = buildIncomingPostedLines({ mlWinner: "home", ouSide: "over", nrfi: null }, [], cron, "t2");
  const m = mergePostedLines(existing, incoming);
  check("set-if-null keeps existing ML", m.posted_lines.moneyline?.odds_american === -130);
  check("set-if-null adds new total", m.posted_lines.total?.odds_american === -110);
  check("changed because total added", m.changed === true);
  check("no change when all present", mergePostedLines(existing, { moneyline: incoming.total }).changed === false);
}

// ── APPLY SMOKE (req 9): recordFirstPublishedLines writes sport_specific.posted_lines ──
class Builder {
  private isUpdate = false;
  private payload: unknown = null;
  constructor(private supa: MockSupa, private table: string) {}
  select() { return this; }
  is() { return this; }
  eq() { return this; }
  in() { return this; }
  range() { return this; }
  update(p: unknown) { this.isUpdate = true; this.payload = p; return this; }
  then(res: (v: { data: unknown; error: unknown }) => unknown) {
    if (this.isUpdate) { this.supa.updates.push({ table: this.table, payload: this.payload }); return res({ data: null, error: null }); }
    return res(this.supa.reads[this.table] ?? { data: [], error: null });
  }
}
class MockSupa {
  updates: Array<{ table: string; payload: unknown }> = [];
  constructor(public reads: Record<string, { data: unknown; error: unknown }>) {}
  from(table: string) { return new Builder(this, table); }
}

async function applySmoke() {
  const mock = new MockSupa({
    games: { data: [{ id: 10 }], error: null },
    game_predictions: { data: [{ id: 1, game_id: 10, locked_at: null, predicted_ml_winner: "home", predicted_ou_side: "over", predicted_nrfi: true, sport_specific: { listed_line: 8.5 } }], error: null },
    lines: { data: cron.map((l) => ({ ...l, game_id: 10 })), error: null },
    odds_current_stream: { data: [], error: null },
  });
  const res = await recordFirstPublishedLines({ supabase: mock as never, sport: "mlb", slateDate: "2026-06-16", apply: true, nowIso: "t" });
  check("apply: scanned 1 / updated 1", res.scanned === 1 && res.updated === 1);
  check("apply: one update issued", mock.updates.length === 1 && mock.updates[0].table === "game_predictions");
  const ss = (mock.updates[0]?.payload as { sport_specific?: { posted_lines?: PostedLines; listed_line?: number } })?.sport_specific;
  check("apply: posted_lines.moneyline written", ss?.posted_lines?.moneyline?.odds_american === -135);
  check("apply: posted_lines.total written", ss?.posted_lines?.total?.odds_american === -110);
  check("apply: posted_lines.first_inning written (NRFI→under)", ss?.posted_lines?.first_inning?.side === "under");
  check("apply: existing sport_specific.listed_line preserved", ss?.listed_line === 8.5);

  // Dry-run writes nothing.
  const mock2 = new MockSupa({
    games: { data: [{ id: 11 }], error: null },
    game_predictions: { data: [{ id: 2, game_id: 11, locked_at: null, predicted_ml_winner: "away", predicted_ou_side: null, predicted_nrfi: null, sport_specific: null }], error: null },
    lines: { data: [{ game_id: 11, market_type: "moneyline", side: "away", sportsbook: "draftkings", odds_american: 120, line_value: null }], error: null },
    odds_current_stream: { data: [], error: null },
  });
  const dry = await recordFirstPublishedLines({ supabase: mock2 as never, sport: "mlb", slateDate: "2026-06-16", apply: false, nowIso: "t" });
  check("dry-run: updated counted but NO write issued", dry.updated === 1 && mock2.updates.length === 0);
}

applySmoke().then(() => {
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
