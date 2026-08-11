import {
  selectMarketIntelligenceSnapshotV2,
  type MarketIntelligenceSnapshotV2Row,
} from "../lib/services/marketIntelligenceV2/snapshotSelector";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

function row(id: number, overrides: Partial<MarketIntelligenceSnapshotV2Row> = {}): MarketIntelligenceSnapshotV2Row {
  return {
    id,
    canonical_event_id: "game-1",
    canonical_market_id: "game-1:moneyline",
    selection_key: "game-1:moneyline:home",
    league: "mlb",
    market_type: "moneyline",
    resolver_version: "test",
    score: 1,
    label: "Slight Market Support",
    explanation: "Market-maker pricing is showing slight support for our projection.",
    evidence_json: {},
    generated_at: "2026-06-25T13:00:00Z",
    evidence_as_of: "2026-06-25T13:00:00Z",
    event_start_time: "2026-06-25T16:00:00Z",
    recommendation_snapshot_id: null,
    recommendation_locked_at: null,
    selected_side: "home",
    selected_line: null,
    selected_price: -120,
    validity_status: "valid_directional",
    ...overrides,
  };
}

{
  const selected = selectMarketIntelligenceSnapshotV2({
    rows: [
      row(1, { generated_at: "2026-06-25T13:00:00Z" }),
      row(2, { generated_at: "2026-06-25T14:00:00Z" }),
      row(3, { generated_at: "2026-06-25T15:30:00Z", validity_status: "insufficient_evidence" }),
    ],
    mode: { kind: "unlocked", responseAsOf: "2026-06-25T14:30:00Z" },
    canonicalEventId: "game-1",
    marketType: "moneyline",
    selectionKey: "game-1:moneyline:home",
  });
  check("unlocked selects latest valid at or before response as-of", selected?.id === 2, String(selected?.id));
}

{
  const selected = selectMarketIntelligenceSnapshotV2({
    rows: [
      row(1, { generated_at: "2026-06-25T13:00:00Z", evidence_as_of: "2026-06-25T13:00:00Z", recommendation_snapshot_id: 7 }),
      row(2, { generated_at: "2026-06-25T14:30:00Z", evidence_as_of: "2026-06-25T14:30:00Z", recommendation_snapshot_id: 7 }),
      row(3, { generated_at: "2026-06-25T15:30:00Z", evidence_as_of: "2026-06-25T15:30:00Z", recommendation_snapshot_id: 7 }),
    ],
    mode: { kind: "locked", recommendationLockedAt: "2026-06-25T14:45:00Z", recommendationSnapshotId: 7 },
    canonicalEventId: "game-1",
    marketType: "moneyline",
    selectionKey: "game-1:moneyline:home",
  });
  check("locked selects latest snapshot whose evidence is at or before lock", selected?.id === 2, String(selected?.id));
}

{
  const selected = selectMarketIntelligenceSnapshotV2({
    rows: [
      row(1, { generated_at: "2026-06-25T16:01:00Z", evidence_as_of: "2026-06-25T15:55:00Z" }),
      row(2, { generated_at: "2026-06-25T15:59:00Z", evidence_as_of: "2026-06-25T16:01:00Z" }),
    ],
    mode: { kind: "unlocked", responseAsOf: "2026-06-25T16:30:00Z" },
    canonicalEventId: "game-1",
    marketType: "moneyline",
    selectionKey: "game-1:moneyline:home",
  });
  check("post-start generation is allowed only when evidence is pre-start", selected?.id === 1, String(selected?.id));
}

{
  const selected = selectMarketIntelligenceSnapshotV2({
    rows: [
      row(1, {
        generated_at: "2026-06-25T14:50:00Z",
        evidence_as_of: "2026-06-25T14:40:00Z",
        recommendation_snapshot_id: 7,
      }),
    ],
    mode: { kind: "locked", recommendationLockedAt: "2026-06-25T14:45:00Z", recommendationSnapshotId: 7 },
    canonicalEventId: "game-1",
    marketType: "moneyline",
    selectionKey: "game-1:moneyline:home",
  });
  check("locked rejects post-lock generated snapshots even when evidence is pre-lock", selected === null, String(selected?.id));
}

console.log(`\nmarket-intelligence-v2-selector: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
