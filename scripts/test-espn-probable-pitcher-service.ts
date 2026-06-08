/**
 * Phase 6B.31a — pure unit tests for the ESPN secondary probable-pitcher
 * source. Covers:
 *
 *   - parseEspnScoreboardEvents (pure parser): all common shapes including
 *     missing probables, missing teams, malformed athlete records, bad ids.
 *   - mapEspnPitcherToPlayer (DB mapper): exact-match returns "matched",
 *     0 rows returns "not_found", multiple rows return "ambiguous".
 *   - fetchEspnProbablePitchers (network fetch with injected fetch):
 *     non-OK status, non-JSON content-type, throwing fetch, valid JSON
 *     parse-through.
 *   - isEspnSecondarySourceEnabled (env-driven master switch).
 *
 * No DB, no network. Mock supabase + mock fetch. Run:
 *   npx tsx scripts/test-espn-probable-pitcher-service.ts
 */

import {
  buildGameKey,
  fetchEspnProbablePitchers,
  isEspnSecondarySourceEnabled,
  mapEspnPitcherToPlayer,
  parseEspnScoreboardEvents,
} from "../lib/services/espnProbablePitcherService";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── Fixture builders ────────────────────────────────────────────────

function buildEspnEvent(opts: {
  eventId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeProbable?: { id: number | string; name: string } | null;
  awayProbable?: { id: number | string; name: string } | null;
}) {
  return {
    id: opts.eventId,
    competitions: [
      {
        competitors: [
          {
            homeAway: "home",
            team: { abbreviation: opts.homeAbbr },
            probables: opts.homeProbable !== undefined && opts.homeProbable !== null
              ? [{ athlete: { id: opts.homeProbable.id, fullName: opts.homeProbable.name } }]
              : [],
          },
          {
            homeAway: "away",
            team: { abbreviation: opts.awayAbbr },
            probables: opts.awayProbable !== undefined && opts.awayProbable !== null
              ? [{ athlete: { id: opts.awayProbable.id, fullName: opts.awayProbable.name } }]
              : [],
          },
        ],
      },
    ],
  };
}

// ─── Mock supabase ───────────────────────────────────────────────────

type MockRow = { id: number; mlb_person_id: number | null; full_name: string; team_id: number; is_pitcher: boolean; active: boolean };

function mockSupabase(rows: MockRow[]) {
  // Mock the chain: .from("players").select(...).eq().eq().eq().eq().then(...)
  // For our mapper we apply 4 eq filters and select id+mlb_person_id.
  function makeQuery(filters: Array<{ col: keyof MockRow; val: unknown }>): {
    eq: (col: keyof MockRow, val: unknown) => ReturnType<typeof makeQuery>;
    then: (resolve: (v: { data: Array<{ id: number; mlb_person_id: number | null }> | null; error: null }) => void) => void;
  } {
    const obj = {
      eq(col: keyof MockRow, val: unknown) {
        return makeQuery([...filters, { col, val }]);
      },
      then(resolve: (v: { data: Array<{ id: number; mlb_person_id: number | null }> | null; error: null }) => void) {
        const filtered = rows.filter((r) =>
          filters.every((f) => r[f.col] === f.val),
        );
        resolve({
          data: filtered.map((r) => ({ id: r.id, mlb_person_id: r.mlb_person_id })),
          error: null,
        });
      },
    };
    return obj;
  }
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return makeQuery([]);
        },
      };
    },
  } as unknown as Parameters<typeof mapEspnPitcherToPlayer>[0];
}

async function main() {
  // ──────────────────────────────────────────────────────────────────
  section("parseEspnScoreboardEvents — pure parser");

  // Test 1: both probables present
  {
    const body = {
      events: [
        buildEspnEvent({
          eventId: 401815676,
          homeAbbr: "BAL",
          awayAbbr: "SEA",
          homeProbable: { id: 33148, name: "Chris Bassitt" },
          awayProbable: { id: 4297897, name: "Emerson Hancock" },
        }),
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    check(`T1 parse — has SEA@BAL key`, out.has("SEA@BAL"));
    const game = out.get("SEA@BAL");
    check(`T1 parse — espnEventId = 401815676`, game?.espnEventId === 401815676);
    check(`T1 parse — homeTeamAbbr = BAL`, game?.homeTeamAbbr === "BAL");
    check(`T1 parse — awayTeamAbbr = SEA`, game?.awayTeamAbbr === "SEA");
    check(`T1 parse — home Bassitt`, game?.home?.fullName === "Chris Bassitt" && game?.home?.espnAthleteId === 33148);
    check(`T1 parse — away Hancock`, game?.away?.fullName === "Emerson Hancock" && game?.away?.espnAthleteId === 4297897);
  }

  // Test 2: home probable missing
  {
    const body = {
      events: [
        buildEspnEvent({
          eventId: 1,
          homeAbbr: "BAL",
          awayAbbr: "SEA",
          homeProbable: null,
          awayProbable: { id: 4297897, name: "Emerson Hancock" },
        }),
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    const game = out.get("SEA@BAL");
    check(`T2 parse — home null when ESPN omits probable`, game?.home === null);
    check(`T2 parse — away still populated`, game?.away !== null);
  }

  // Test 3: malformed athlete (id missing) → that side is null
  {
    const body = {
      events: [
        {
          id: 1,
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { abbreviation: "BAL" }, probables: [{ athlete: { fullName: "Some Pitcher" } }] },
                { homeAway: "away", team: { abbreviation: "SEA" }, probables: [{ athlete: { id: 4297897, fullName: "Hancock" } }] },
              ],
            },
          ],
        },
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    const game = out.get("SEA@BAL");
    check(`T3 parse — malformed athlete (no id) → null on that side`, game?.home === null);
    check(`T3 parse — other side parses cleanly`, game?.away?.espnAthleteId === 4297897);
  }

  // Test 4: id is a string → parsed as number
  {
    const body = {
      events: [
        buildEspnEvent({
          eventId: 1,
          homeAbbr: "BAL",
          awayAbbr: "SEA",
          homeProbable: { id: "33148", name: "Chris Bassitt" },
          awayProbable: null,
        }),
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    check(`T4 parse — string id coerced to number`, out.get("SEA@BAL")?.home?.espnAthleteId === 33148);
  }

  // Test 5: id = 0 or negative → rejected
  {
    const body = {
      events: [
        buildEspnEvent({ eventId: 1, homeAbbr: "BAL", awayAbbr: "SEA", homeProbable: { id: 0, name: "X" }, awayProbable: null }),
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    check(`T5 parse — id=0 rejected`, out.get("SEA@BAL")?.home === null);
  }

  // Test 6: missing team abbreviation → whole game skipped
  {
    const body = {
      events: [
        {
          id: 1,
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: {}, probables: [] },
                { homeAway: "away", team: { abbreviation: "SEA" }, probables: [] },
              ],
            },
          ],
        },
      ],
    };
    const out = parseEspnScoreboardEvents(body);
    check(`T6 parse — game with missing team abbr skipped entirely`, out.size === 0);
  }

  // Test 7: empty/malformed root payload → empty map
  {
    check(`T7 parse — null root → empty map`, parseEspnScoreboardEvents(null).size === 0);
    check(`T7 parse — empty object → empty map`, parseEspnScoreboardEvents({}).size === 0);
    check(`T7 parse — events not an array → empty map`, parseEspnScoreboardEvents({ events: "nope" }).size === 0);
  }

  // ──────────────────────────────────────────────────────────────────
  section("buildGameKey");
  check(`buildGameKey("SEA", "BAL") === "SEA@BAL"`, buildGameKey("SEA", "BAL") === "SEA@BAL");

  // ──────────────────────────────────────────────────────────────────
  section("mapEspnPitcherToPlayer — strict 4-constraint lookup");

  const bassittRow: MockRow = {
    id: 13773, mlb_person_id: 605135, full_name: "Chris Bassitt",
    team_id: 754, is_pitcher: true, active: true,
  };

  // Test 8: exact match → "matched"
  {
    const sb = mockSupabase([bassittRow]);
    const r = await mapEspnPitcherToPlayer(sb, "Chris Bassitt", 754);
    check(`T8 mapper — exact full_name+team+pitcher+active → matched`, r.status === "matched");
    check(`T8 mapper — playerId = 13773`, r.playerId === 13773);
    check(`T8 mapper — mlbPersonId = 605135 (audit)`, r.mlbPersonId === 605135);
    check(`T8 mapper — matchCount = 1`, r.matchCount === 1);
  }

  // Test 9: name not in players → "not_found"
  {
    const sb = mockSupabase([bassittRow]);
    const r = await mapEspnPitcherToPlayer(sb, "Phantom Player", 754);
    check(`T9 mapper — name not present → not_found`, r.status === "not_found");
    check(`T9 mapper — playerId null on not_found`, r.playerId === null);
  }

  // Test 10: team mismatch → "not_found"
  {
    const sb = mockSupabase([bassittRow]);
    const r = await mapEspnPitcherToPlayer(sb, "Chris Bassitt", 999);
    check(`T10 mapper — wrong team_id → not_found`, r.status === "not_found");
  }

  // Test 11: is_pitcher = false → "not_found"
  {
    const sb = mockSupabase([{ ...bassittRow, is_pitcher: false }]);
    const r = await mapEspnPitcherToPlayer(sb, "Chris Bassitt", 754);
    check(`T11 mapper — is_pitcher=false → not_found`, r.status === "not_found");
  }

  // Test 12: active = false → "not_found"
  {
    const sb = mockSupabase([{ ...bassittRow, active: false }]);
    const r = await mapEspnPitcherToPlayer(sb, "Chris Bassitt", 754);
    check(`T12 mapper — active=false → not_found`, r.status === "not_found");
  }

  // Test 13: ambiguous (rare — two pitchers on same team with same exact name) → "ambiguous"
  {
    const dup1 = { ...bassittRow, id: 99991 };
    const dup2 = { ...bassittRow, id: 99992 };
    const sb = mockSupabase([dup1, dup2]);
    const r = await mapEspnPitcherToPlayer(sb, "Chris Bassitt", 754);
    check(`T13 mapper — 2 matching rows → ambiguous`, r.status === "ambiguous");
    check(`T13 mapper — ambiguous → matchCount = 2`, r.matchCount === 2);
    check(`T13 mapper — ambiguous → playerId null`, r.playerId === null);
  }

  // ──────────────────────────────────────────────────────────────────
  section("fetchEspnProbablePitchers — network failure tolerance");

  // Test 14: bad date → empty map
  {
    const out = await fetchEspnProbablePitchers("not-a-date", { log: () => {} });
    check(`T14 fetch — bad date → empty map`, out.size === 0);
  }

  // Test 15: non-OK status → empty map, no throw
  {
    const fakeFetch = async () => new Response("server error", { status: 500 });
    const out = await fetchEspnProbablePitchers("2026-06-08", { log: () => {}, fetchImpl: fakeFetch as unknown as typeof fetch });
    check(`T15 fetch — non-2xx → empty map (no throw)`, out.size === 0);
  }

  // Test 16: non-JSON content-type → empty map
  {
    const fakeFetch = async () => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } });
    const out = await fetchEspnProbablePitchers("2026-06-08", { log: () => {}, fetchImpl: fakeFetch as unknown as typeof fetch });
    check(`T16 fetch — non-JSON content-type → empty map`, out.size === 0);
  }

  // Test 17: throwing fetch → empty map, no rethrow
  {
    const fakeFetch = async () => { throw new Error("connection reset"); };
    const out = await fetchEspnProbablePitchers("2026-06-08", { log: () => {}, fetchImpl: fakeFetch as unknown as typeof fetch });
    check(`T17 fetch — fetch throws → empty map (caught)`, out.size === 0);
  }

  // Test 18: valid JSON → parses through
  {
    const body = JSON.stringify({
      events: [
        buildEspnEvent({
          eventId: 401815676,
          homeAbbr: "BAL",
          awayAbbr: "SEA",
          homeProbable: { id: 33148, name: "Chris Bassitt" },
          awayProbable: { id: 4297897, name: "Emerson Hancock" },
        }),
      ],
    });
    const fakeFetch = async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    const out = await fetchEspnProbablePitchers("2026-06-08", { log: () => {}, fetchImpl: fakeFetch as unknown as typeof fetch });
    check(`T18 fetch — valid JSON → 1 game parsed`, out.size === 1);
    check(`T18 fetch — Bassitt present`, out.get("SEA@BAL")?.home?.fullName === "Chris Bassitt");
  }

  // ──────────────────────────────────────────────────────────────────
  section("isEspnSecondarySourceEnabled — env master switch");

  // Test 19: unset → true (enabled by default)
  {
    delete process.env.ESPN_SECONDARY_PROBABLE_PITCHER;
    check(`T19 env — unset → enabled (true)`, isEspnSecondarySourceEnabled() === true);
  }

  // Test 20: "false" → disabled
  {
    process.env.ESPN_SECONDARY_PROBABLE_PITCHER = "false";
    check(`T20 env — "false" → disabled`, isEspnSecondarySourceEnabled() === false);
  }

  // Test 21: "0" → disabled
  {
    process.env.ESPN_SECONDARY_PROBABLE_PITCHER = "0";
    check(`T21 env — "0" → disabled`, isEspnSecondarySourceEnabled() === false);
  }

  // Test 22: "true" → enabled
  {
    process.env.ESPN_SECONDARY_PROBABLE_PITCHER = "true";
    check(`T22 env — "true" → enabled`, isEspnSecondarySourceEnabled() === true);
  }

  // Restore env
  delete process.env.ESPN_SECONDARY_PROBABLE_PITCHER;

  // ──────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL:", (e as Error).message); console.error((e as Error).stack); process.exit(1); });
