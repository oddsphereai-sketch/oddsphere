/**
 * Phase 4.2.C.1.G-1 — pure unit tests for `lib/services/starterResolver`.
 *
 * No HTTP, no DB. Covers:
 *   • parseMlbStatsSchedule       — 5 scenarios (both starters, missing
 *                                    probable, doubleheader, postponed,
 *                                    cancelled)
 *   • parseBdlGameStarters        — nested + flat shapes, missing fields
 *   • parseBdlLineupsForStarter   — probable-only, confirmed-preferred,
 *                                    team-side mapping, defensive nulls
 *   • mergeStarter                — all 5 rules + edge cases for legacy
 *                                    (null-provenance) data
 *
 * Live network tests for the actual MLB Stats / BDL HTTP responses are out
 * of scope for G-1; they belong in the operator dry-run smoke (G-2).
 */

import {
  type ExistingStarter,
  type MergeDecision,
  type NormalizedStarterCandidate,
  type ParsedStarter,
  mergeStarter,
  parseBdlGameStarters,
  parseBdlLineupsForStarter,
  parseMlbStatsSchedule,
} from "../lib/services/starterResolver";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─────────────────────────────────────────────────────────────────────
// MLB Stats /schedule parser
// ─────────────────────────────────────────────────────────────────────

function mlbStatsBothStartersFixture() {
  return {
    dates: [
      {
        date: "2026-06-03",
        games: [
          {
            gamePk: 745321,
            gameDate: "2026-06-03T17:35:00Z",
            gameNumber: 1,
            doubleHeader: "N",
            status: { detailedState: "Scheduled" },
            teams: {
              home: {
                team: { id: 144, name: "Atlanta Braves" },
                probablePitcher: { id: 666158, fullName: "Spencer Strider" },
              },
              away: {
                team: { id: 117, name: "Houston Astros" },
                probablePitcher: { id: 656302, fullName: "Cristian Javier" },
              },
            },
          },
        ],
      },
    ],
  };
}

async function testMlbSchedule_BothStarters() {
  section("parseMlbStatsSchedule — both starters present");
  const out = parseMlbStatsSchedule(mlbStatsBothStartersFixture());
  check("returns 1 game", out.length === 1);
  if (out.length !== 1) return;
  const g = out[0];
  check("gamePk === 745321", g.gamePk === 745321);
  check("status === 'scheduled'", g.status === "scheduled");
  check("doubleHeader === 'N'", g.doubleHeader === "N");
  check("homeTeamId === 144", g.homeTeamId === 144);
  check("awayTeamId === 117", g.awayTeamId === 117);
  check("homeProbable present", g.homeProbable !== null);
  check("awayProbable present", g.awayProbable !== null);
  if (g.homeProbable !== null) {
    check("homeProbable.externalId === 666158", g.homeProbable.externalId === 666158);
    check("homeProbable.source === 'mlb_stats_probable'", g.homeProbable.source === "mlb_stats_probable");
    check("homeProbable.confidence === 'probable'", g.homeProbable.confidence === "probable");
    check("homeProbable.externalIdKind === 'mlb_person_id'", g.homeProbable.externalIdKind === "mlb_person_id");
    check("homeProbable.fullName === 'Spencer Strider'", g.homeProbable.fullName === "Spencer Strider");
  }
  if (g.awayProbable !== null) {
    check("awayProbable.externalId === 656302", g.awayProbable.externalId === 656302);
  }
}

async function testMlbSchedule_MissingProbable() {
  section("parseMlbStatsSchedule — one side missing probablePitcher");
  const fixture = {
    dates: [
      {
        games: [
          {
            gamePk: 1,
            gameDate: "2026-06-03T20:00:00Z",
            doubleHeader: "N",
            status: { detailedState: "Scheduled" },
            teams: {
              home: {
                team: { id: 121, name: "Mets" },
                probablePitcher: { id: 657277, fullName: "Logan Webb" },
              },
              away: {
                team: { id: 110, name: "Orioles" },
                // no probablePitcher field
              },
            },
          },
        ],
      },
    ],
  };
  const out = parseMlbStatsSchedule(fixture);
  check("returns 1 game", out.length === 1);
  if (out.length !== 1) return;
  check("homeProbable present", out[0].homeProbable !== null);
  check("awayProbable === null (no probablePitcher on away)", out[0].awayProbable === null);
  check("awayTeamId still populated", out[0].awayTeamId === 110);
}

async function testMlbSchedule_Doubleheader() {
  section("parseMlbStatsSchedule — doubleheader (2 games same date)");
  const fixture = {
    dates: [
      {
        games: [
          {
            gamePk: 800001,
            gameDate: "2026-06-03T17:05:00Z",
            gameNumber: 1,
            doubleHeader: "S",
            status: { detailedState: "Scheduled" },
            teams: {
              home: { team: { id: 110 }, probablePitcher: { id: 100, fullName: "P1" } },
              away: { team: { id: 111 }, probablePitcher: { id: 101, fullName: "P2" } },
            },
          },
          {
            gamePk: 800002,
            gameDate: "2026-06-03T20:05:00Z",
            gameNumber: 2,
            doubleHeader: "S",
            status: { detailedState: "Scheduled" },
            teams: {
              home: { team: { id: 110 }, probablePitcher: { id: 200, fullName: "P3" } },
              away: { team: { id: 111 }, probablePitcher: { id: 201, fullName: "P4" } },
            },
          },
        ],
      },
    ],
  };
  const out = parseMlbStatsSchedule(fixture);
  check("returns 2 games", out.length === 2);
  if (out.length !== 2) return;
  check("game 1: gameNumber === 1", out[0].gameNumber === 1);
  check("game 2: gameNumber === 2", out[1].gameNumber === 2);
  check("game 1: doubleHeader === 'S'", out[0].doubleHeader === "S");
  check("game 1: home probable externalId === 100", out[0].homeProbable?.externalId === 100);
  check("game 2: home probable externalId === 200", out[1].homeProbable?.externalId === 200);
  check(
    "different gamePks",
    out[0].gamePk !== out[1].gamePk
  );
}

async function testMlbSchedule_Postponed() {
  section("parseMlbStatsSchedule — postponed game still parsed with right status");
  const fixture = {
    dates: [
      {
        games: [
          {
            gamePk: 9001,
            gameDate: "2026-06-03T23:05:00Z",
            doubleHeader: "N",
            status: { detailedState: "Postponed" },
            teams: {
              home: { team: { id: 1 }, probablePitcher: { id: 10, fullName: "x" } },
              away: { team: { id: 2 }, probablePitcher: { id: 20, fullName: "y" } },
            },
          },
        ],
      },
    ],
  };
  const out = parseMlbStatsSchedule(fixture);
  check("returns 1 game", out.length === 1);
  check("status === 'postponed'", out[0].status === "postponed");
  check("probables still extracted (caller decides to skip writes)", out[0].homeProbable !== null && out[0].awayProbable !== null);
}

async function testMlbSchedule_Cancelled() {
  section("parseMlbStatsSchedule — cancelled game");
  const fixture = {
    dates: [
      {
        games: [
          {
            gamePk: 9002,
            gameDate: "2026-06-03T23:05:00Z",
            doubleHeader: "N",
            status: { detailedState: "Cancelled" },
            teams: { home: { team: { id: 1 } }, away: { team: { id: 2 } } },
          },
        ],
      },
    ],
  };
  const out = parseMlbStatsSchedule(fixture);
  check("returns 1 game with status='cancelled'", out.length === 1 && out[0].status === "cancelled");
  check("no probables (none in payload)", out[0].homeProbable === null && out[0].awayProbable === null);
}

async function testMlbSchedule_Malformed() {
  section("parseMlbStatsSchedule — malformed inputs");
  check("null → []", parseMlbStatsSchedule(null).length === 0);
  check("undefined → []", parseMlbStatsSchedule(undefined).length === 0);
  check("string → []", parseMlbStatsSchedule("not json").length === 0);
  check("empty object → []", parseMlbStatsSchedule({}).length === 0);
  check("missing dates → []", parseMlbStatsSchedule({ totalGames: 0 }).length === 0);
  // Empty dates / empty games
  check("empty dates array → []", parseMlbStatsSchedule({ dates: [] }).length === 0);
  check(
    "game missing gamePk → skipped",
    parseMlbStatsSchedule({ dates: [{ games: [{ gameDate: "..." }] }] }).length === 0
  );
}

async function testMlbSchedule_StatusVariants() {
  section("parseMlbStatsSchedule — status variants normalize");
  const cases: Array<{ in: string; out: string }> = [
    { in: "Scheduled", out: "scheduled" },
    { in: "Pre-Game", out: "scheduled" },
    { in: "Warmup", out: "scheduled" },
    { in: "In Progress", out: "in_progress" },
    { in: "Final", out: "final" },
    { in: "Game Over", out: "final" },
    { in: "Postponed", out: "postponed" },
    { in: "Cancelled", out: "cancelled" },
    { in: "Canceled", out: "cancelled" },
    { in: "Weather Delay", out: "other" },
  ];
  for (const c of cases) {
    const fx = {
      dates: [{ games: [{ gamePk: 1, status: { detailedState: c.in }, teams: { home: {}, away: {} } }] }],
    };
    const r = parseMlbStatsSchedule(fx);
    check(`'${c.in}' → '${c.out}'`, r[0]?.status === c.out);
  }
}

// ─────────────────────────────────────────────────────────────────────
// BDL /games parser
// ─────────────────────────────────────────────────────────────────────

async function testBdlGames_NestedShape() {
  section("parseBdlGameStarters — nested home_team_pitcher.id shape");
  const r = parseBdlGameStarters({
    id: 5058686,
    home_team_pitcher: { id: 543037 },
    away_team_pitcher: { id: 668678 },
  });
  check("home present", r.home !== null);
  check("away present", r.away !== null);
  check("home.externalId === 543037", r.home?.externalId === 543037);
  check("away.externalId === 668678", r.away?.externalId === 668678);
  check("home.source === 'bdl_games'", r.home?.source === "bdl_games");
  check("home.confidence === 'probable'", r.home?.confidence === "probable");
  check("home.externalIdKind === 'bdl_player_id'", r.home?.externalIdKind === "bdl_player_id");
}

async function testBdlGames_FlatShape() {
  section("parseBdlGameStarters — flat home_team_pitcher_id shape");
  const r = parseBdlGameStarters({
    id: 5058686,
    home_team_pitcher_id: 543037,
    away_team_pitcher_id: 668678,
  });
  check("home.externalId === 543037", r.home?.externalId === 543037);
  check("away.externalId === 668678", r.away?.externalId === 668678);
}

async function testBdlGames_Missing() {
  section("parseBdlGameStarters — both missing → both null");
  const r = parseBdlGameStarters({ id: 5058686 });
  check("home === null", r.home === null);
  check("away === null", r.away === null);
}

async function testBdlGames_OneSideMissing() {
  section("parseBdlGameStarters — one side missing");
  const r = parseBdlGameStarters({ id: 1, home_team_pitcher: { id: 543037 } });
  check("home present", r.home !== null);
  check("away === null", r.away === null);
}

async function testBdlGames_ZeroAndNegative() {
  section("parseBdlGameStarters — pitcher id 0 or negative treated as null");
  const r = parseBdlGameStarters({ home_team_pitcher_id: 0, away_team_pitcher_id: -1 });
  check("home === null (id=0)", r.home === null);
  check("away === null (id=-1)", r.away === null);
}

async function testBdlGames_Malformed() {
  section("parseBdlGameStarters — malformed inputs");
  check("null → both null", parseBdlGameStarters(null).home === null);
  check("string → both null", parseBdlGameStarters("nope").home === null);
}

// ─────────────────────────────────────────────────────────────────────
// BDL /lineups parser
// ─────────────────────────────────────────────────────────────────────

async function testBdlLineups_ProbableOnly() {
  section("parseBdlLineupsForStarter — probable-only rows");
  const rows = [
    { game_id: 1, team_id: 100, player_id: 700, is_probable_pitcher: true, is_confirmed: false },
    { game_id: 1, team_id: 200, player_id: 800, is_probable_pitcher: true, is_confirmed: false },
    // a non-pitcher row should be ignored
    { game_id: 1, team_id: 100, player_id: 900, is_probable_pitcher: false, position: "C" },
  ];
  const r = parseBdlLineupsForStarter(rows, 100, 200);
  check("home present", r.home !== null);
  check("away present", r.away !== null);
  check("home.externalId === 700", r.home?.externalId === 700);
  check("home.source === 'bdl_lineups_probable'", r.home?.source === "bdl_lineups_probable");
  check("home.confidence === 'probable'", r.home?.confidence === "probable");
}

async function testBdlLineups_ConfirmedPreferredOverProbable() {
  section("parseBdlLineupsForStarter — confirmed preferred over probable for same side");
  // Same side has BOTH a probable row and a confirmed row. Confirmed wins.
  const rows = [
    { game_id: 1, team_id: 100, player_id: 700, is_probable_pitcher: true, is_confirmed: false },
    { game_id: 1, team_id: 100, player_id: 700, is_probable_pitcher: true, is_confirmed: true },
  ];
  const r = parseBdlLineupsForStarter(rows, 100, 200);
  check("home.source === 'bdl_lineups_confirmed'", r.home?.source === "bdl_lineups_confirmed");
  check("home.confidence === 'confirmed'", r.home?.confidence === "confirmed");
}

async function testBdlLineups_ConfirmedWinsRegardlessOfOrder() {
  section("parseBdlLineupsForStarter — confirmed wins even if probable appears LAST");
  const rows = [
    { game_id: 1, team_id: 100, player_id: 700, is_probable_pitcher: true, is_confirmed: true },
    { game_id: 1, team_id: 100, player_id: 700, is_probable_pitcher: true, is_confirmed: false },
  ];
  const r = parseBdlLineupsForStarter(rows, 100, 200);
  check("home.confidence === 'confirmed' (confirmed sticks)", r.home?.confidence === "confirmed");
}

async function testBdlLineups_TeamSideMapping() {
  section("parseBdlLineupsForStarter — team_id maps to correct side");
  const rows = [
    { team_id: 999, player_id: 1, is_probable_pitcher: true }, // unknown team — ignored
    { team_id: 100, player_id: 700, is_probable_pitcher: true }, // home
    { team_id: 200, player_id: 800, is_probable_pitcher: true }, // away
  ];
  const r = parseBdlLineupsForStarter(rows, 100, 200);
  check("home → 700", r.home?.externalId === 700);
  check("away → 800", r.away?.externalId === 800);
}

async function testBdlLineups_EmptyAndMalformed() {
  section("parseBdlLineupsForStarter — empty/malformed inputs");
  const r1 = parseBdlLineupsForStarter([], 100, 200);
  check("empty rows → both null", r1.home === null && r1.away === null);
  const r2 = parseBdlLineupsForStarter([null as unknown, "junk" as unknown], 100, 200);
  check("malformed rows skipped → both null", r2.home === null && r2.away === null);
  const r3 = parseBdlLineupsForStarter(
    [{ team_id: 100, player_id: 0, is_probable_pitcher: true }],
    100,
    200
  );
  check("player_id 0 skipped", r3.home === null);
}

// ─────────────────────────────────────────────────────────────────────
// mergeStarter — rule coverage
// ─────────────────────────────────────────────────────────────────────

const cand = (
  playerId: number,
  source: NormalizedStarterCandidate["source"],
  confidence: NormalizedStarterCandidate["confidence"]
): NormalizedStarterCandidate => ({ playerId, source, confidence });

const existing = (
  playerId: number | null,
  source: ExistingStarter["source"],
  confidence: ExistingStarter["confidence"]
): ExistingStarter => ({ playerId, source, confidence });

async function testMerge_NoExistingNoCandidate() {
  section("mergeStarter — no existing + null candidate");
  const d = mergeStarter(existing(null, null, null), null);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'no_existing_no_candidate'", d.reason === "no_existing_no_candidate");
}

async function testMerge_NeverNullOverwrite() {
  section("mergeStarter — null candidate NEVER overwrites existing");
  const d = mergeStarter(existing(6271, "bdl_games", "probable"), null);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'null_candidate_preserve_existing'", d.reason === "null_candidate_preserve_existing");
}

async function testMerge_FreshWrite() {
  section("mergeStarter — fresh write when no existing");
  const c = cand(6271, "mlb_stats_probable", "probable");
  const d = mergeStarter(existing(null, null, null), c);
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'fresh'", d.reason === "fresh");
    check("value === candidate", d.value === c);
    check("previousPlayerId === null", d.previousPlayerId === null);
    check("scratchDetected === false", d.scratchDetected === false);
  }
}

async function testMerge_ConfirmedBeatsProbable_SamePlayer() {
  section("mergeStarter — confirmed candidate upgrades same-player probable");
  const c = cand(6271, "bdl_lineups_confirmed", "confirmed");
  const d = mergeStarter(existing(6271, "bdl_games", "probable"), c);
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'upgrade_same_player'", d.reason === "upgrade_same_player");
    check("scratchDetected === false (same player)", d.scratchDetected === false);
    check("previousPlayerId === 6271", d.previousPlayerId === 6271);
  }
}

async function testMerge_ProbableDoesNotUpgradeConfirmed_SamePlayer() {
  section("mergeStarter — probable candidate cannot replace confirmed same-player");
  const c = cand(6271, "bdl_games", "probable");
  const d = mergeStarter(existing(6271, "bdl_lineups_confirmed", "confirmed"), c);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'same_player_no_upgrade'", d.reason === "same_player_no_upgrade");
}

async function testMerge_SamePlayerSameTierNoChange() {
  section("mergeStarter — same player, same tier → no_change");
  const c = cand(6271, "mlb_stats_probable", "probable");
  const d = mergeStarter(existing(6271, "bdl_games", "probable"), c);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'same_player_no_upgrade'", d.reason === "same_player_no_upgrade");
}

async function testMerge_ManualProtected() {
  section("mergeStarter — manual existing protected against automated candidate");
  const c = cand(6299, "bdl_lineups_confirmed", "confirmed"); // even confirmed!
  const d = mergeStarter(existing(6271, "manual", "confirmed"), c);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'manual_protected'", d.reason === "manual_protected");
}

async function testMerge_ManualBeatsManual() {
  section("mergeStarter — manual candidate can replace manual existing");
  const c = cand(6299, "manual", "confirmed");
  const d = mergeStarter(existing(6271, "manual", "confirmed"), c);
  // Both manual; different player; same tier → same_tier_scratch write
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'same_tier_scratch'", d.reason === "same_tier_scratch");
    check("scratchDetected === true", d.scratchDetected === true);
  }
}

async function testMerge_ScratchSameTier() {
  section("mergeStarter — same tier, different player → write + scratchDetected");
  const c = cand(6299, "bdl_games", "probable");
  const d = mergeStarter(existing(6271, "bdl_games", "probable"), c);
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'same_tier_scratch'", d.reason === "same_tier_scratch");
    check("scratchDetected === true", d.scratchDetected === true);
    check("previousPlayerId === 6271", d.previousPlayerId === 6271);
    check("value.playerId === 6299", d.value.playerId === 6299);
  }
}

async function testMerge_ScratchUpgrade() {
  section("mergeStarter — confirmed candidate beats probable for DIFFERENT player → upgrade_with_scratch");
  const c = cand(6299, "bdl_lineups_confirmed", "confirmed");
  const d = mergeStarter(existing(6271, "bdl_games", "probable"), c);
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'upgrade_with_scratch'", d.reason === "upgrade_with_scratch");
    check("scratchDetected === true", d.scratchDetected === true);
  }
}

async function testMerge_LowerConfidenceDifferentPlayer() {
  section("mergeStarter — probable candidate cannot replace confirmed for DIFFERENT player");
  const c = cand(6299, "bdl_games", "probable");
  const d = mergeStarter(existing(6271, "bdl_lineups_confirmed", "confirmed"), c);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'different_player_lower_confidence'", d.reason === "different_player_lower_confidence");
}

async function testMerge_LegacyNullProvenance_ConfirmedUpgrades() {
  section("mergeStarter — legacy row (null provenance) is upgradable to confirmed");
  const c = cand(6271, "bdl_lineups_confirmed", "confirmed");
  const d = mergeStarter(existing(6271, null, null), c);
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") {
    check("reason === 'upgrade_same_player'", d.reason === "upgrade_same_player");
    check("scratchDetected === false", d.scratchDetected === false);
  }
}

async function testMerge_LegacyNullProvenance_ProbableSamePlayerNoOp() {
  section("mergeStarter — legacy row + same-player probable → no upgrade (same tier)");
  const c = cand(6271, "bdl_games", "probable");
  const d = mergeStarter(existing(6271, null, null), c);
  check("kind === 'no_change'", d.kind === "no_change");
  if (d.kind === "no_change") check("reason === 'same_player_no_upgrade'", d.reason === "same_player_no_upgrade");
}

async function testMerge_LegacyNullProvenance_NotManualProtected() {
  section("mergeStarter — null provenance is NOT treated as 'manual'");
  const c = cand(6299, "bdl_games", "probable"); // different player, same tier as null
  const d = mergeStarter(existing(6271, null, null), c);
  // Should be same_tier_scratch (null treated as probable, different player)
  check("kind === 'write'", d.kind === "write");
  if (d.kind === "write") check("reason === 'same_tier_scratch'", d.reason === "same_tier_scratch");
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.G-1 — starterResolver unit tests");
  console.log("==============================================");

  await testMlbSchedule_BothStarters();
  await testMlbSchedule_MissingProbable();
  await testMlbSchedule_Doubleheader();
  await testMlbSchedule_Postponed();
  await testMlbSchedule_Cancelled();
  await testMlbSchedule_Malformed();
  await testMlbSchedule_StatusVariants();

  await testBdlGames_NestedShape();
  await testBdlGames_FlatShape();
  await testBdlGames_Missing();
  await testBdlGames_OneSideMissing();
  await testBdlGames_ZeroAndNegative();
  await testBdlGames_Malformed();

  await testBdlLineups_ProbableOnly();
  await testBdlLineups_ConfirmedPreferredOverProbable();
  await testBdlLineups_ConfirmedWinsRegardlessOfOrder();
  await testBdlLineups_TeamSideMapping();
  await testBdlLineups_EmptyAndMalformed();

  await testMerge_NoExistingNoCandidate();
  await testMerge_NeverNullOverwrite();
  await testMerge_FreshWrite();
  await testMerge_ConfirmedBeatsProbable_SamePlayer();
  await testMerge_ProbableDoesNotUpgradeConfirmed_SamePlayer();
  await testMerge_SamePlayerSameTierNoChange();
  await testMerge_ManualProtected();
  await testMerge_ManualBeatsManual();
  await testMerge_ScratchSameTier();
  await testMerge_ScratchUpgrade();
  await testMerge_LowerConfidenceDifferentPlayer();
  await testMerge_LegacyNullProvenance_ConfirmedUpgrades();
  await testMerge_LegacyNullProvenance_ProbableSamePlayerNoOp();
  await testMerge_LegacyNullProvenance_NotManualProtected();

  // Silence unused-import warnings — ParsedStarter / MergeDecision are
  // load-bearing for the test fixtures' typing surface but not directly
  // referenced as values.
  void ({} as ParsedStarter);
  void ({} as MergeDecision);

  console.log();
  console.log("==============================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
