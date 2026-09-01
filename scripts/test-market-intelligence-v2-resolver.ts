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
    selectedLine: null,
    selectedPrice: -118,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -118,
        no_vig_probability: 0.55,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
      {
        sportsbook: "draftkings",
        sharp_book: false,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -110,
        no_vig_probability: 0.52,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
    asOf: "2026-06-25T14:00:00Z",
  });
  check("unified exact-line price map is available", out.evidence.sharpRetailPriceMap.status === "available");
  check("unified price gap preserves selected-side direction", Math.abs((out.evidence.sharpRetailPriceMap.probabilityGap ?? 0) - 0.03) < 1e-9);
  check("price-map evidence is behavior-neutral until a sport model consumes it", out.score === 0 && out.label === "Model-Led");
}

{
  const out = resolveMarketReadV2({
    marketType: "total",
    selectionKey: "game-1:total:over",
    selectedLine: 47.5,
    selectedPrice: -110,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "total",
        selection_key: "game-1:total:over",
        american_price: -110,
        no_vig_probability: 0.51,
        line: 47.5,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
      {
        sportsbook: "fanduel",
        sharp_book: false,
        market_type: "total",
        selection_key: "game-1:total:over",
        american_price: -110,
        no_vig_probability: 0.53,
        line: 48.5,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("different point lines cannot form a unified price comparison", out.evidence.sharpRetailPriceMap.status === "missing_retail");
}

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: -118,
    splitObservations: [
      {
        provider: "playbook",
        source_book: "consensus",
        source_type: "multi_book_consensus",
        market_type: "moneyline",
        selection_key: selectionKey,
          bets_pct: 0.57,
          money_pct: 0.53,
        market_line: null,
        market_price: -118,
        split_line_basis: "paired_same_ingestion",
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
        market_line: null,
        market_price: -120,
        split_line_basis: "provider_explicit",
          books_used: null,
        source_observed_at: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
    ],
      priceObservations: [],
    });
    check("uncalibrated split-only evidence returns no market read", out.score === 0 && out.label === null && out.validityStatus === "insufficient_evidence", `${out.label} ${out.validityStatus}`);
    check("consensus captured in evidence", out.evidence.playbookConsensus.betsPct === 0.57 && out.evidence.playbookConsensus.booksUsed === 11);
  check("Playbook line basis preserved", out.evidence.playbookConsensus.lineBasis === "paired_same_ingestion");
    check("BetMGM ticket-only captured as source-specific", out.evidence.sharpApiSourceSpecific.sources[0]?.sourceBook === "betmgm");
    check("missing price evidence has no member explanation", out.explanation === null);
  check("split scores stay zero without normalization", out.evidence.trace.playbookScore === 0 && out.evidence.trace.sharpApiSplitScore === 0);
  }

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: -130,
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
      check("price explanation is provider-neutral", out.explanation !== null && !/sharpapi|playbook|provider|conflict|disagreement/i.test(out.explanation), out.explanation ?? undefined);
  check("valid directional status returned", out.validityStatus === "valid_directional");
  check("moneyline null selected line stays valid", !out.evidence.trace.qualityGates.includes("missing_selected_line"));
  }

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: -120,
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

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: -120,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "pinnacle",
        sharp_book: true,
        market_type: "moneyline",
        selection_key: selectionKey,
        american_price: -120,
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
  check("unchanged price states are nondirectional", out.validityStatus === "valid_nondirectional" && out.label === "Model-Led", `${out.validityStatus} ${out.label}`);
}

{
  const out = resolveMarketReadV2({
    marketType: "total",
    selectionKey: "game-1:total:over",
    selectedLine: 8.5,
    selectedPrice: -110,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "total",
        selection_key: "game-1:total:over",
        american_price: -110,
        line: 8.5,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "total",
        selection_key: "game-1:total:over",
        american_price: -105,
        line: 9,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("total line movement supports over without exact current-line match", out.score >= 1 && out.label !== null, `${out.score} ${out.label}`);
  check("total exact-line status remains available", out.evidence.exactLinePriceEvidence.available === true);
  check("total movement stores first/current line", out.evidence.marketMovementEvidence.firstTrackedLine === 8.5 && out.evidence.marketMovementEvidence.currentLine === 9);
}

{
  const out = resolveMarketReadV2({
    marketType: "spread",
    selectionKey: "game-1:spread:home",
    selectedLine: -2.5,
    selectedPrice: -110,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "spread",
        selection_key: "game-1:spread:home",
        american_price: -110,
        line: -2.5,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "spread",
        selection_key: "game-1:spread:home",
        american_price: -115,
        line: -3,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("spread line movement supports favorite tightening", out.score >= 1 && out.label !== null, `${out.score} ${out.label}`);
  check("spread exact-line status remains available", out.evidence.exactLinePriceEvidence.available === true);
  check("spread movement stores first/current line", out.evidence.marketMovementEvidence.firstTrackedLine === -2.5 && out.evidence.marketMovementEvidence.currentLine === -3);
}

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: -110,
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
    ],
    asOf: "2026-06-25T17:00:00Z",
    maxEvidenceAgeMinutes: 60,
  });
  check("stale evidence returns no market read", out.label === null && out.validityStatus === "stale_evidence", `${out.label} ${out.validityStatus}`);
}

{
  const out = resolveMarketReadV2({
    marketType: "moneyline",
    selectionKey,
    selectedLine: null,
    selectedPrice: null,
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
        american_price: -120,
        line: null,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("moneyline movement can render context even when exact selected price is missing", out.validityStatus === "valid_directional" && out.evidence.exactLinePriceEvidence.status === "missing_selected_price");
}

{
  const out = resolveMarketReadV2({
    marketType: "total",
    selectionKey: "game-1:total:under",
    selectedLine: null,
    selectedPrice: -110,
    splitObservations: [],
    priceObservations: [
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "total",
        selection_key: "game-1:total:under",
        american_price: -110,
        line: 8.5,
        provider_timestamp: "2026-06-25T13:00:00Z",
        fetched_at: "2026-06-25T13:00:00Z",
      },
      {
        sportsbook: "circa",
        sharp_book: true,
        market_type: "total",
        selection_key: "game-1:total:under",
        american_price: -120,
        line: 8.5,
        provider_timestamp: "2026-06-25T14:00:00Z",
        fetched_at: "2026-06-25T14:00:00Z",
      },
    ],
  });
  check("total requires selected line", out.label === null && out.evidence.trace.explanationReasonCodes.includes("missing_selected_line"));
}

console.log(`\nmarket-intelligence-v2-resolver: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
