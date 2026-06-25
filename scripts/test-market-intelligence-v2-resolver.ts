import { resolveMarketReadV2, labelForMarketReadScore } from "../lib/services/marketIntelligenceV2/resolver";

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

const selectionKey = "game-1:moneyline:home";

check("score +4 label", labelForMarketReadScore(4) === "Strong Market Support");
check("score +2 label", labelForMarketReadScore(2) === "Market Support");
check("score +1 label", labelForMarketReadScore(1) === "Slight Market Support");
check("score 0 label", labelForMarketReadScore(0) === "Model-Led");
check("score -1 label", labelForMarketReadScore(-1) === "Slight Market Resistance");
check("score -3 label", labelForMarketReadScore(-3) === "Market Resistance");
check("score -5 label", labelForMarketReadScore(-5) === "Strong Market Resistance");

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    splitObservations: [
      {
        provider: "playbook",
        source_book: "consensus",
        source_type: "multi_book_consensus",
        market_type: "moneyline",
        selection_key: selectionKey,
        bets_pct: 0.57,
        money_pct: 0.53,
        books_used: 11,
        source_observed_at: null,
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        provider: "sharpapi",
        source_book: "betmgm",
        source_type: "retail_book",
        market_type: "moneyline",
        selection_key: selectionKey,
        bets_pct: 0.61,
        money_pct: null,
        books_used: null,
        source_observed_at: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
    ],
    priceObservations: [],
  });
  check("uncalibrated split evidence stays model-led", out.score === 0 && out.label === "Model-Led");
  check("consensus captured in evidence", out.evidence.playbookConsensus.betsPct === 0.57 && out.evidence.playbookConsensus.booksUsed === 11);
  check("BetMGM ticket-only captured as source-specific", out.evidence.sharpApiSourceSpecific.sources[0]?.sourceBook === "betmgm");
  check("member explanation does not expose provider disagreement", !/sharpapi|playbook|conflict|disagreement|provider/i.test(out.explanation), out.explanation);
}

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -110,
        line: null,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -135,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
      {
        sportsbook: "draftkings",
        sharp_book: false,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -108,
        line: null,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "draftkings",
        sharp_book: false,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -130,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("price move toward pick scores support", out.score >= 2 && out.label === "Market Support", `${out.score} ${out.label}`);
  check("price explanation is provider-neutral", !/sharpapi|playbook|provider|conflict|disagreement/i.test(out.explanation), out.explanation);
}

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -150,
        line: null,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -120,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("price move against pick scores resistance", out.score <= -2 && out.label === "Market Resistance", `${out.score} ${out.label}`);
}

console.log(`\nmarket-intelligence-v2-resolver: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
