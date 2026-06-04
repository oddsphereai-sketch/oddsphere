/**
 * Phase 4.1.8.C v2 — unit tests for composeTakeaway.
 *
 * Run: npx tsx scripts/test-compose-takeaway.ts
 * Pure fixtures; no DB; no env reads.
 */
import {
  composeTakeaway,
  formatPickPhrase,
  splitModelBreakdown,
  __TEST__,
  type ComposedTakeaway,
} from "../app/lab/lib/composeTakeaway";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";

const { composeLead, NO_PLAY_LEAD } = __TEST__;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✓ ${label}`);
  } else {
    fail++;
    console.log(`✗ ${label}`);
  }
}

// ─── Fixture builder ────────────────────────────────────────────────

type GameOverrides = {
  mlGrade?: DailyEdgeGameDto["predictions"]["ml"]["grade"];
  mlPick?: string;
  ouGrade?: DailyEdgeGameDto["predictions"]["total"]["grade"];
  ouPick?: string;
  ouLine?: number | null;
  nrfiGrade?: DailyEdgeGameDto["predictions"]["nrfi"]["grade"];
  nrfiPick?: string;
  verdictKey?: DailyEdgeGameDto["breakdown"]["verdict"]["key"];
  verdictLabel?: string;
  sharpReadKey?: DailyEdgeGameDto["breakdown"]["sharpRead"]["key"];
  sharpReadSentence?: string;
  modelBreakdown?: string | null;
};

/**
 * 4.1.10 — stub MarketEdgeDto for tests that don't exercise the new
 * per-market enriched fields. The composeTakeaway tests target legacy
 * `predictions` / `breakdown` fields; this stub satisfies the type
 * contract without adding noise to assertions.
 */
function stubMarketEdge(pick: string | null = "X") {
  return {
    pick,
    confidence: 0.6,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "mixed" as const,
    held: false,  // Phase 4.2.C.2 — stub defaults to non-held
    verdict: { key: "lean" as const, label: "Lean" },
    guidedGuide: "stub",
    guidedWatchOut: "stub",
    whyLine: "stub",
    riskLine: "stub",
    modelProb: null,
    marketFairProb: null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: null,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
  };
}

function mkGame(overrides: GameOverrides = {}): DailyEdgeGameDto {
  // Phase 4.1.8.C v2 test note: use `'key' in overrides` rather than `??`
  // so explicit `null` overrides for grade fields are honored (??  swallows
  // null since it only triggers on null/undefined, returning the fallback).
  const mlGrade = "mlGrade" in overrides ? overrides.mlGrade! : "best_signal";
  const ouGrade = "ouGrade" in overrides ? overrides.ouGrade! : "market_watch";
  const nrfiGrade =
    "nrfiGrade" in overrides ? overrides.nrfiGrade! : "market_watch";
  return {
    id: "mlb-1",
    sport: "mlb",
    external_id: 1,
    awayTeam: "BAL",
    awayTeamLogo: null,
    homeTeam: "NYY",
    homeTeamLogo: null,
    gameTime: "7:10 PM",
    gameStartMinutes: 1030,
    predictions: {
      ml: {
        pick: overrides.mlPick ?? "NYY",
        confidence: 0.6,
        sharpStatus: "mixed",
        grade: mlGrade,
        signalType: null,
        marketSignal: null,
      },
      total: {
        pick: overrides.ouPick ?? "Over",
        confidence: 0.55,
        sharpStatus: "mixed",
        line: overrides.ouLine === undefined ? 8.5 : overrides.ouLine,
        grade: ouGrade,
        signalType: null,
        marketSignal: null,
      },
      nrfi: {
        pick: overrides.nrfiPick ?? "NRFI",
        confidence: 0.58,
        sharpStatus: "mixed",
        grade: nrfiGrade,
        signalType: null,
        marketSignal: null,
      },
    },
    projected: { away: 4.1, home: 5.2 },
    sharpSignals: [],
    scheduledLockAt: "2026-05-29T23:10:00.000Z",
    lockState: "open" as const,
    lockedAt: null,
    updatedAt: null,
    generatedAt: null,
    holdReason: null,
    homeStarter: null,
    awayStarter: null,
    markets: {
      moneyline: stubMarketEdge(overrides.mlPick ?? "NYY"),
      total: stubMarketEdge(overrides.ouPick ?? "Over"),
      first_inning: stubMarketEdge(overrides.nrfiPick ?? "NRFI"),
    },
    decisionLine: "stub decision line",
    status: {
      lineupConfirmed: null,
      linesLocked: false,
      sharpSignalPending: true,
      marketDataLimited: false,
    },
    result: null,
    breakdown: {
      verdict: {
        key: overrides.verdictKey ?? "best_angle",
        label: overrides.verdictLabel ?? "Best Angle",
      },
      sharpRead: {
        key: overrides.sharpReadKey ?? "support",
        sentence:
          overrides.sharpReadSentence ?? "Sharp signals support this pick.",
      },
      modelBreakdown:
        overrides.modelBreakdown === undefined
          ? "Cole has been sharp early."
          : overrides.modelBreakdown,
    },
  };
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // GROUP 1 — formatPickPhrase
  // ═══════════════════════════════════════════════════════════════════
  {
    const g = mkGame({ mlGrade: "best_signal", mlPick: "NYY" });
    check(
      "[pick-phrase] ml headline → 'NYY moneyline'",
      formatPickPhrase(g) === "NYY moneyline"
    );
  }
  {
    const g = mkGame({
      mlGrade: null,
      ouGrade: "best_signal",
      ouPick: "Over",
      ouLine: 8.5,
    });
    check(
      "[pick-phrase] total headline with line → 'the over 8.5'",
      formatPickPhrase(g) === "the over 8.5"
    );
  }
  {
    const g = mkGame({
      mlGrade: null,
      ouGrade: "best_signal",
      ouPick: "Under",
      ouLine: null,
    });
    check(
      "[pick-phrase] total headline with no line → 'the under'",
      formatPickPhrase(g) === "the under"
    );
  }
  {
    const g = mkGame({
      mlGrade: null,
      ouGrade: null,
      nrfiGrade: "best_signal",
      nrfiPick: "NRFI",
    });
    check(
      "[pick-phrase] nrfi headline → 'NRFI' (acronym preserved)",
      formatPickPhrase(g) === "NRFI"
    );
  }
  {
    const g = mkGame({
      mlGrade: null,
      ouGrade: null,
      nrfiGrade: "best_signal",
      nrfiPick: "YRFI",
    });
    check(
      "[pick-phrase] yrfi headline → 'YRFI' (acronym preserved)",
      formatPickPhrase(g) === "YRFI"
    );
  }
  {
    const g = mkGame({ mlGrade: null, ouGrade: null, nrfiGrade: null });
    check(
      "[pick-phrase] no headline → null",
      formatPickPhrase(g) === null
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 2 — splitModelBreakdown
  // ═══════════════════════════════════════════════════════════════════
  {
    const r = splitModelBreakdown(null);
    check(
      "[split] null input → { why: null, caveat: null }",
      r.why === null && r.caveat === null
    );
  }
  {
    const r = splitModelBreakdown("Cole has been sharp early.");
    check(
      "[split] no 'though' → full text becomes why, caveat null",
      r.why === "Cole has been sharp early." && r.caveat === null
    );
  }
  {
    const r = splitModelBreakdown(
      "Bradish has been strong in first innings this year, though early-inning data on Pepiot is limited."
    );
    check(
      "[split] 'though X' pattern: main becomes why",
      r.why === "Bradish has been strong in first innings this year."
    );
    check(
      "[split] 'though X' pattern: caveat capitalized + terminating period",
      r.caveat === "Early-inning data on Pepiot is limited."
    );
  }
  {
    const r = splitModelBreakdown(
      "Early-inning edge is thin, but listed total is on the high end."
    );
    check(
      "[split] 'but X' pattern (NOT a caveat) → full text becomes why",
      r.why ===
        "Early-inning edge is thin, but listed total is on the high end." &&
        r.caveat === null
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 3 — composeLead per verdict
  // ═══════════════════════════════════════════════════════════════════
  // Best Angle × all sharpRead keys
  {
    const lead = composeLead("best_angle", "support", "NYY moneyline");
    check(
      "[lead] best_angle + support",
      lead ===
        "The cleanest read here is NYY moneyline, with sharp support behind the same side."
    );
  }
  {
    const lead = composeLead("best_angle", "push_against", "NYY moneyline");
    check(
      "[lead] best_angle + push_against has 'pushing the other way'",
      lead.includes("pushing the other way")
    );
  }
  {
    const lead = composeLead("best_angle", "no_data", "the over 8.5");
    check(
      "[lead] best_angle + no_data uses 'No clear sharp lean either way yet.'",
      lead.includes("No clear sharp lean either way yet")
    );
  }

  // Lean × representative sharpRead keys
  {
    const lead = composeLead("lean", "support", "NRFI");
    check(
      "[lead] lean + support starts with 'A mild lean toward'",
      lead.startsWith("A mild lean toward NRFI")
    );
  }
  {
    const lead = composeLead("lean", "not_enough", "the under 8.5");
    check(
      "[lead] lean + not_enough mentions 'not enough sharp support'",
      lead.includes("not enough sharp support")
    );
  }

  // Watchlist — pick phrase IGNORED per Daniel's example
  {
    const lead = composeLead("watchlist", "no_data", "NYY moneyline");
    check(
      "[lead] watchlist starts with 'This is more of a watchlist spot than a clean play'",
      lead.startsWith("This is more of a watchlist spot than a clean play")
    );
    check(
      "[lead] watchlist does NOT include pick phrase 'NYY moneyline'",
      !lead.includes("NYY moneyline")
    );
  }
  {
    const lead = composeLead("watchlist", "push_against", "NRFI");
    check(
      "[lead] watchlist + push_against mentions 'sharper signals leaning the other way'",
      lead.includes("sharper signals leaning the other way")
    );
  }

  // Caution — pick phrase IGNORED, sharp tail carries the why
  {
    const lead = composeLead("caution", "push_against", "the over 8.5");
    check(
      "[lead] caution + push_against matches Daniel's spec phrasing",
      lead ===
        "Use caution here — the model has a read, but sharper signals are pushing the other way."
    );
  }
  {
    const lead = composeLead("caution", "no_data", "NYY moneyline");
    check(
      "[lead] caution + no_data mentions 'sharp picture isn't clear yet'",
      lead.includes("sharp picture isn't clear yet")
    );
  }
  {
    const lead = composeLead("caution", "mixed", "NYY moneyline");
    check(
      "[lead] caution + mixed does NOT include pick phrase",
      !lead.includes("NYY moneyline")
    );
  }

  // No Play — sharp tail IGNORED; single sentence regardless of sharp key
  {
    const lead = composeLead("no_play", "no_data", null);
    check(
      "[lead] no_play returns the canonical no-play sentence",
      lead === NO_PLAY_LEAD
    );
  }
  {
    const lead = composeLead("no_play", "support", "NYY moneyline");
    check(
      "[lead] no_play ignores sharp_read variant",
      lead === NO_PLAY_LEAD
    );
  }

  // Defensive: pick phrase null with best_angle / lean
  {
    const lead = composeLead("best_angle", "support", null);
    check(
      "[lead] best_angle + null pick → defensive fallback fires",
      lead.includes("The cleanest read here points to a clear angle")
    );
  }
  {
    const lead = composeLead("lean", "mixed", null);
    check(
      "[lead] lean + null pick → defensive fallback fires",
      lead.includes("A mild lean is on the board")
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 4 — composeTakeaway integration
  // ═══════════════════════════════════════════════════════════════════
  {
    const g = mkGame({
      verdictKey: "best_angle",
      sharpReadKey: "support",
      mlGrade: "best_signal",
      mlPick: "NYY",
      modelBreakdown: "Cole has been sharp early.",
    });
    const r: ComposedTakeaway = composeTakeaway(g);
    check(
      "[integration] best_angle + support + ML headline composes full takeaway",
      r.lead ===
        "The cleanest read here is NYY moneyline, with sharp support behind the same side." &&
        r.why === "Cole has been sharp early." &&
        r.caveat === null
    );
  }
  {
    const g = mkGame({
      verdictKey: "best_angle",
      sharpReadKey: "support",
      mlGrade: "best_signal",
      modelBreakdown:
        "Bradish has been strong in first innings this year, though early-inning data on Pepiot is limited.",
    });
    const r = composeTakeaway(g);
    check(
      "[integration] caveat extraction populates the caveat field",
      r.caveat === "Early-inning data on Pepiot is limited."
    );
    check(
      "[integration] caveat extraction strips 'though' clause from why",
      r.why === "Bradish has been strong in first innings this year."
    );
  }
  {
    const g = mkGame({
      verdictKey: "no_play",
      sharpReadKey: "no_data",
      mlGrade: null,
      ouGrade: null,
      nrfiGrade: null,
      modelBreakdown: null,
    });
    const r = composeTakeaway(g);
    check(
      "[integration] no_play row produces canonical lead + null why/caveat",
      r.lead === NO_PLAY_LEAD && r.why === null && r.caveat === null
    );
  }
  {
    const g = mkGame({
      verdictKey: "caution",
      sharpReadKey: "push_against",
      ouGrade: "sharp_conflict",
      ouPick: "Over",
      ouLine: 8.5,
      modelBreakdown: "Early-inning edge is thin, but the top of the order adds scoring risk.",
    });
    const r = composeTakeaway(g);
    check(
      "[integration] caution + push_against returns spec-aligned lead",
      r.lead ===
        "Use caution here — the model has a read, but sharper signals are pushing the other way."
    );
    check(
      "[integration] caution path: 'but X' modelBreakdown stays whole as why",
      r.why ===
        "Early-inning edge is thin, but the top of the order adds scoring risk."
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 5 — Sub-D11 duplication guard
  // ═══════════════════════════════════════════════════════════════════
  {
    // Force a duplication scenario: lead contains the why prefix verbatim.
    const lead =
      "Cole has been sharp early and the sharps are with him on this one.";
    const why = "Cole has been sharp early and the sharps are quiet so far.";
    // probe = "cole has been sharp early and " (30 chars from why's first
    // alpha char). lead does contain that probe. Should return true.
    const dup = __TEST__.whyDuplicatesLead(lead, why);
    check(
      "[dup-guard] 30+ char overlap triggers duplication",
      dup === true
    );
  }
  {
    const lead =
      "The cleanest read here is NYY moneyline, with sharp support behind the same side.";
    const why = "Cole has been sharp early.";
    const dup = __TEST__.whyDuplicatesLead(lead, why);
    check(
      "[dup-guard] short why (<30 chars) never triggers duplication",
      dup === false
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 6 — Lead-length sanity
  // ═══════════════════════════════════════════════════════════════════
  {
    // Iterate over every (verdict, sharpRead) combo and check lengths.
    const verdicts = [
      "best_angle",
      "lean",
      "watchlist",
      "caution",
      "no_play",
    ] as const;
    const sharpReads = [
      "support",
      "push_against",
      "mixed",
      "not_enough",
      "no_data",
      "light_movement",
    ] as const;
    let maxLen = 0;
    let maxLabel = "";
    for (const v of verdicts) {
      for (const s of sharpReads) {
        const lead = composeLead(v, s, "NYY moneyline");
        if (lead.length > maxLen) {
          maxLen = lead.length;
          maxLabel = `${v} + ${s}`;
        }
      }
    }
    check(
      `[lead-length] every lead ≤ 180 chars (longest: ${maxLabel} @ ${maxLen})`,
      maxLen <= 180
    );
  }

  console.log("\n" + "━".repeat(70));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Failures.");
    process.exit(1);
  }
  console.log("\n✅ All composeTakeaway tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
