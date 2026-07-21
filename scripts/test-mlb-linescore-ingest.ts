/**
 * Push 4b — tests for MLB linescore ingest service (pure / fixture).
 *
 * Tests:
 *   - extractFirstInningTotal: complete / incomplete / absent / multi-inning
 *   - buildInningScoresJson: shape + ordering + null handling
 *   - normalizeMlbStatsStatus: 8 status strings
 *   - classifyLinescoreAction: wrong-game guard, scheduled-skip,
 *     postponed-skip, complete-write, idempotent-noop
 *   - team alias mapping for today's slate (SEA, DET, BAL, TOR, PIT,
 *     ATL, LAA, LAD)
 */

import {
  extractFirstInningTotal,
  buildInningScoresJson,
  normalizeMlbStatsStatus,
  classifyLinescoreAction,
  selectOurGameForMlbStatsGame,
  type MlbStatsRawGame,
  type OurGameRow,
} from "../lib/services/mlbLinescoreIngestService";
import { normalizeMlbTeamName } from "../lib/providers/real_api/_teamNameNormalizer";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

function makeRaw(overrides: Partial<MlbStatsRawGame> = {}): MlbStatsRawGame {
  return {
    gamePk: 745000,
    status: { detailedState: "Final", abstractGameState: "Final" },
    teams: {
      home: { team: { id: 1, name: "Chicago Cubs" }, score: 5 },
      away: { team: { id: 2, name: "San Francisco Giants" }, score: 3 },
    },
    linescore: {
      innings: [
        { num: 1, away: { runs: 0 }, home: { runs: 0 } },
        { num: 2, away: { runs: 1 }, home: { runs: 2 } },
      ],
    },
    ...overrides,
  };
}

// ── extractFirstInningTotal ───────────────────────────────────────
console.log("━━━ extractFirstInningTotal ━━━");
{
  const r = extractFirstInningTotal(makeRaw());
  check("0-0 first inning → total=0, status=complete", r.total === 0 && r.status === "complete");
}
{
  const r = extractFirstInningTotal(makeRaw({
    linescore: { innings: [{ num: 1, away: { runs: 2 }, home: { runs: 1 } }] },
  }));
  check("2-1 first inning → total=3", r.total === 3 && r.awayRuns === 2 && r.homeRuns === 1);
}
{
  const r = extractFirstInningTotal(makeRaw({
    linescore: { innings: [{ num: 1, away: { runs: 0 } }] },
  }));
  check("top scored, bottom not yet → total=null, status=incomplete", r.total === null && r.status === "incomplete");
}
{
  const r = extractFirstInningTotal(makeRaw({ linescore: { innings: [] } }));
  check("empty innings → status=absent", r.status === "absent" && r.total === null);
}
{
  const r = extractFirstInningTotal(makeRaw({ linescore: {} }));
  check("no linescore → status=absent", r.status === "absent");
}

// ── buildInningScoresJson ─────────────────────────────────────────
console.log("\n━━━ buildInningScoresJson ━━━");
{
  const out = buildInningScoresJson(makeRaw());
  check("returns {home, away} arrays", out !== null && Array.isArray(out.home) && Array.isArray(out.away));
  check("home=[0,2] away=[0,1]", out !== null && JSON.stringify(out.home) === "[0,2]" && JSON.stringify(out.away) === "[0,1]");
}
{
  const out = buildInningScoresJson(makeRaw({
    linescore: { innings: [
      { num: 1, away: { runs: 0 }, home: { runs: 0 } },
      { num: 2, away: { runs: 0 }, home: { runs: 0 } },
      { num: 3, away: { runs: 0 }, home: { runs: 1 } },
      { num: 4, away: { runs: 0 }, home: { runs: 0 } },
      { num: 5, away: { runs: 0 }, home: { runs: 0 } },
      { num: 6, away: { runs: 0 }, home: { runs: 0 } },
      { num: 7, away: { runs: 0 }, home: { runs: 0 } },
      { num: 8, away: { runs: 0 }, home: { runs: 0 } },
      { num: 9, away: { runs: 0 } }, // walk-off, no bottom
    ] },
  }));
  check("9-inning game, walk-off → 9 entries with last home=null", out !== null && out.home.length === 9 && out.away.length === 9 && out.home[8] === null);
}

// ── normalizeMlbStatsStatus ───────────────────────────────────────
console.log("\n━━━ normalizeMlbStatsStatus ━━━");
const statuses: Array<[string, string]> = [
  ["Final", "final"],
  ["Game Over", "final"],
  ["In Progress", "in_progress"],
  ["Scheduled", "scheduled"],
  ["Pre-Game", "scheduled"],
  ["Warmup", "scheduled"],
  ["Postponed", "postponed"],
  ["Cancelled", "canceled"],
  ["Suspended", "suspended"],
];
for (const [detailed, want] of statuses) {
  const got = normalizeMlbStatsStatus({ gamePk: 1, status: { detailedState: detailed } });
  check(`"${detailed}" → "${want}"`, got === want);
}
check(
  '"Postponed" overrides abstractGameState="Final"',
  normalizeMlbStatsStatus({
    gamePk: 1,
    status: { detailedState: "Postponed", abstractGameState: "Final" },
  }) === "postponed",
);

// ── classifyLinescoreAction ───────────────────────────────────────
console.log("\n━━━ classifyLinescoreAction ━━━");
const baseOurs = {
  id: 14771,
  external_id: 5058728,
  game_date: "2026-06-06T19:05:00+00:00",
  status: null as string | null,
  home_team_id: 771,
  away_team_id: 780,
  first_inning_runs: null as number | null,
  inning_scores: null,
  home_score: null as number | null,
  away_score: null as number | null,
};
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw(),
    ours: baseOurs,
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("complete FI + matching teams → would_update", cls.action === "would_update");
}
{
  // Pre-6B.23: FI matched → noop regardless. Post-6B.23: if game is
  // Final and DB doesn't yet have status=STATUS_FINAL + scores, the
  // would_update path fires so MLB Stats fills in the missing ML / OU
  // grading inputs. Setting status + scores to match makes this a
  // genuine noop.
  const cls = classifyLinescoreAction({
    mlb: makeRaw(),
    ours: { ...baseOurs, first_inning_runs: 0, status: "STATUS_FINAL", home_score: 5, away_score: 3 },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("identical FI + status + scores in DB → noop (idempotent)", cls.action === "noop");
}
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ status: { detailedState: "Scheduled" } }),
    ours: baseOurs,
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("scheduled (with FI total=0 from absent linescore) → skipped", cls.action === "skipped");
}
{
  // Mismatched teams — MLB says Cubs/Giants but DB expects Yankees/RedSox
  const cls = classifyLinescoreAction({
    mlb: makeRaw(),
    ours: baseOurs,
    expectedHomeAbbrev: "NYY",
    expectedAwayAbbrev: "BOS",
  });
  check("wrong-game guard rejects mismatched teams", cls.action === "skipped" && (cls.reason ?? "").includes("wrong-game"));
}
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw({
      teams: {
        home: { team: { name: "FakeTeamX" } },
        away: { team: { name: "FakeTeamY" } },
      },
    }),
    ours: baseOurs,
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("unresolvable team name → skipped (team_normalization_failed)", cls.action === "skipped" && (cls.reason ?? "").includes("team normalization"));
}
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ status: { detailedState: "Postponed" }, linescore: {} }),
    ours: { ...baseOurs, status: "STATUS_SCHEDULED" },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("postponed game with stale scheduled status → would_update", cls.action === "would_update" && cls.normalized_status === "postponed");
}
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ status: { detailedState: "Postponed" }, linescore: {} }),
    ours: { ...baseOurs, status: "STATUS_POSTPONED" },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("postponed game already synced → noop (idempotent)", cls.action === "noop");
}
{
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ status: { detailedState: "Cancelled" }, linescore: {} }),
    ours: { ...baseOurs, status: "STATUS_SCHEDULED" },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("canceled game with stale scheduled status → would_update", cls.action === "would_update" && cls.normalized_status === "canceled");
}
{
  // Live game with first inning complete should still be writable
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ status: { detailedState: "In Progress" } }),
    ours: baseOurs,
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("live game with completed 1st inning → would_update", cls.action === "would_update");
}
{
  // Final but missing 1st inning data
  const cls = classifyLinescoreAction({
    mlb: makeRaw({ linescore: { innings: [{ num: 2, away: { runs: 1 }, home: { runs: 0 } }] } }),
    ours: baseOurs,
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("final with absent 1st inning data → skipped (linescore_missing_first_inning)", cls.action === "skipped" && (cls.reason ?? "").includes("linescore_missing_first_inning"));
}

// ── Doubleheader row selection ─────────────────────────────────────
console.log("\n━━━ Doubleheader row selection ━━━");
{
  const firstGame: OurGameRow = {
    ...baseOurs,
    id: 29337,
    external_id: 10558770,
    game_date: "2026-07-11T16:05:00+00:00",
  };
  const secondGame: OurGameRow = {
    ...baseOurs,
    id: 29340,
    external_id: 5059195,
    game_date: "2026-07-11T20:15:00+00:00",
  };
  const firstMlb = makeRaw({
    gamePk: 1,
    gameDate: "2026-07-11T16:05:00Z",
    teams: {
      home: { team: { name: "Pittsburgh Pirates" }, score: 7 },
      away: { team: { name: "Milwaukee Brewers" }, score: 6 },
    },
  });
  const secondMlb = makeRaw({
    gamePk: 2,
    gameDate: "2026-07-11T20:15:00Z",
    teams: {
      home: { team: { name: "Pittsburgh Pirates" }, score: 3 },
      away: { team: { name: "Milwaukee Brewers" }, score: 2 },
    },
  });
  check(
    "same-team first doubleheader game selects early DB row",
    selectOurGameForMlbStatsGame(firstMlb, [firstGame, secondGame])?.id === 29337,
  );
  check(
    "same-team second doubleheader game selects late DB row",
    selectOurGameForMlbStatsGame(secondMlb, [firstGame, secondGame])?.id === 29340,
  );
}

// ── Team alias mapping for today's slate ──────────────────────────
console.log("\n━━━ Team alias mapping — today's 2026-06-06 slate ━━━");
const todayPairs: Array<[string, string]> = [
  ["Seattle Mariners", "SEA"],
  ["Detroit Tigers", "DET"],
  ["Baltimore Orioles", "BAL"],
  ["Toronto Blue Jays", "TOR"],
  ["Pittsburgh Pirates", "PIT"],
  ["Atlanta Braves", "ATL"],
  ["Los Angeles Angels", "LAA"],
  ["Los Angeles Dodgers", "LAD"],
  ["Athletics", "ATH"],
  ["Houston Astros", "HOU"],
  ["Washington Nationals", "WSH"],
  ["Arizona Diamondbacks", "ARI"],
  ["Boston Red Sox", "BOS"],
  ["New York Yankees", "NYY"],
];
for (const [name, want] of todayPairs) {
  const got = normalizeMlbTeamName(name);
  check(`"${name}" → ${want}`, got === want);
}

// ── Phase 6B.23 — final-score writer trigger ────────────────────────
console.log("\n━━━ Phase 6B.23 — MLB Stats writes final scores when game is Final ━━━");
{
  // Game is Final, MLB Stats has team scores, DB has FI saved but no
  // status/scores → should classify as would_update.
  const cls = classifyLinescoreAction({
    mlb: makeRaw({
      status: { detailedState: "Final" },
      teams: {
        home: { team: { id: 771, name: "Chicago Cubs" }, score: 5 },
        away: { team: { id: 780, name: "San Francisco Giants" }, score: 3 },
      },
    }),
    ours: { ...baseOurs, first_inning_runs: 0, status: "STATUS_IN_PROGRESS", home_score: null, away_score: null },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("Final + FI noop but scores missing → would_update", cls.action === "would_update");
}
{
  // Game is Final, MLB Stats team scores already in DB, FI matches →
  // pure noop.
  const cls = classifyLinescoreAction({
    mlb: makeRaw({
      status: { detailedState: "Final" },
      teams: {
        home: { team: { id: 771, name: "Chicago Cubs" }, score: 5 },
        away: { team: { id: 780, name: "San Francisco Giants" }, score: 3 },
      },
    }),
    ours: { ...baseOurs, first_inning_runs: 0, status: "STATUS_FINAL", home_score: 5, away_score: 3 },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("Final + DB already complete → noop (idempotent)", cls.action === "noop");
}
{
  // Game is Final but MLB Stats has no team scores (defensive — should
  // NOT trigger an update on the basis of final-status alone).
  const cls = classifyLinescoreAction({
    mlb: makeRaw({
      status: { detailedState: "Final" },
      teams: {
        home: { team: { id: 771, name: "Chicago Cubs" } },
        away: { team: { id: 780, name: "San Francisco Giants" } },
      },
    }),
    ours: { ...baseOurs, first_inning_runs: 0, status: "STATUS_IN_PROGRESS", home_score: null, away_score: null },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("Final + MLB scores missing → noop (won't fake scores)", cls.action === "noop");
}
{
  // Game is In Progress — never write status/scores from this path
  // (BDL owns in-progress updates).
  const cls = classifyLinescoreAction({
    mlb: makeRaw({
      status: { detailedState: "In Progress" },
      teams: {
        home: { team: { id: 771, name: "Chicago Cubs" }, score: 3 },
        away: { team: { id: 780, name: "San Francisco Giants" }, score: 2 },
      },
    }),
    ours: { ...baseOurs, first_inning_runs: 0, status: "STATUS_IN_PROGRESS", home_score: null, away_score: null },
    expectedHomeAbbrev: "CHC",
    expectedAwayAbbrev: "SF",
  });
  check("In Progress + FI matches → noop (no mid-game score writes from MLB Stats)", cls.action === "noop");
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All MLB linescore ingest tests passed.");
