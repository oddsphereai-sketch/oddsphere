/**
 * Phase 3.x.0b — mocked-fetch unit tests for the MLB Stats API helper.
 *
 * Run: npx tsx scripts/test-mlb-stats-api.ts
 * No live HTTP calls. No DB writes.
 */
import {
  searchPersonByNameDob,
  getPitcherFirstInningStats,
  parseBaseballInningsPitched,
} from "../lib/providers/real_api/_mlbStatsApiClient";

const realFetch = globalThis.fetch;
let lastUrl = "";

function mockFetch(impl: (url: string) => Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    lastUrl = url;
    return impl(url);
  }) as typeof fetch;
}

function mockOk(json: unknown): void {
  mockFetch(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => json,
      }) as unknown as Response
  );
}

function mockHttpError(status: number): void {
  mockFetch(
    async () =>
      ({
        ok: false,
        status,
        json: async () => ({}),
      }) as unknown as Response
  );
}

function mockNetworkThrow(): void {
  globalThis.fetch = (async () => {
    throw new Error("network");
  }) as typeof fetch;
}

function mockBadJson(): void {
  mockFetch(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("parse");
        },
      }) as unknown as Response
  );
}

function restore(): void {
  globalThis.fetch = realFetch;
}

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

const isClose = (n: number | null | undefined, t: number): boolean =>
  n !== null && n !== undefined && Math.abs(n - t) < 0.001;

async function main(): Promise<void> {
  // ── searchPersonByNameDob ──────────────────────────────────────────

  mockOk({
    people: [{ id: 543037, fullName: "Gerrit Cole", birthDate: "1990-09-08" }],
  });
  const r1 = await searchPersonByNameDob("Gerrit Cole", "1990-09-08", { quiet: true });
  check("[1] single result + DOB match returns person", r1?.id === 543037);

  mockOk({
    people: [{ id: 1, fullName: "Other Guy", birthDate: "1990-09-09" }],
  });
  const r2 = await searchPersonByNameDob("Other Guy", "1990-09-08", { quiet: true });
  check("[2] single result, DOB differs returns null", r2 === null);

  mockOk({
    people: [
      { id: 1, fullName: "A", birthDate: "2000-01-01" },
      { id: 2, fullName: "B", birthDate: "1990-09-08" },
      { id: 3, fullName: "C", birthDate: "2000-01-02" },
    ],
  });
  const r3 = await searchPersonByNameDob("Same Name", "1990-09-08", { quiet: true });
  check("[3] multi result, 1 DOB match returns that one", r3?.id === 2);

  mockOk({
    people: [
      { id: 1, fullName: "A", birthDate: "2000-01-01" },
      { id: 2, fullName: "B", birthDate: "2000-01-02" },
    ],
  });
  const r4 = await searchPersonByNameDob("Same Name", "1990-09-08", { quiet: true });
  check("[4] multi result, 0 DOB matches returns null", r4 === null);

  mockOk({
    people: [
      { id: 1, fullName: "A", birthDate: "1990-09-08" },
      { id: 2, fullName: "B", birthDate: "1990-09-08" },
    ],
  });
  const r5 = await searchPersonByNameDob("Same Name", "1990-09-08", { quiet: true });
  check("[5] multi result, 2 DOB matches → null (fail-closed)", r5 === null);

  mockOk({ people: [] });
  const r6 = await searchPersonByNameDob("Nobody", "1990-09-08", { quiet: true });
  check("[6] empty people array returns null", r6 === null);

  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response();
  }) as typeof fetch;
  const r7 = await searchPersonByNameDob("Foo", null, { quiet: true });
  check("[7] dob null returns null without fetching", r7 === null && !fetchCalled);

  mockNetworkThrow();
  const r8 = await searchPersonByNameDob("Foo", "1990-09-08", { quiet: true });
  check("[8] network error returns null", r8 === null);

  mockHttpError(500);
  const r9 = await searchPersonByNameDob("Foo", "1990-09-08", { quiet: true });
  check("[9] HTTP 500 returns null", r9 === null);

  mockBadJson();
  const r10 = await searchPersonByNameDob("Foo", "1990-09-08", { quiet: true });
  check("[10] malformed JSON returns null", r10 === null);

  // [11] Diacritic name → URL-encoded
  let capturedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        people: [{ id: 99, fullName: "Eury Pérez", birthDate: "2003-04-15" }],
      }),
    } as unknown as Response;
  }) as typeof fetch;
  const r11 = await searchPersonByNameDob("Eury Pérez", "2003-04-15", { quiet: true });
  check("[11a] diacritic name resolves to person", r11?.id === 99);
  check(
    "[11b] diacritic name is URL-encoded (Eury%20P%C3%A9rez)",
    capturedUrl.includes("Eury%20P%C3%A9rez")
  );

  // ── getPitcherFirstInningStats ─────────────────────────────────────

  const fullSplitResponse = {
    stats: [
      {
        splits: [
          {
            split: { code: "i01", description: "First Inning" },
            stat: {
              era: "2.25",
              earnedRuns: 8,
              runs: 8,
              inningsPitched: "32.0",
              gamesPlayed: 32,
              whip: "1.03",
            },
          },
        ],
      },
    ],
  };
  mockOk(fullSplitResponse);
  const s12 = await getPitcherFirstInningStats(676979, 2025, { quiet: true });
  check("[12a] statSplits era parsed", s12?.first_inning_era === 2.25);
  check("[12b] statSplits earned_runs parsed", s12?.first_inning_earned_runs === 8);
  check("[12c] statSplits runs parsed", s12?.first_inning_runs_allowed === 8);
  check("[12d] statSplits IP parsed as 32", s12?.first_inning_innings_pitched === 32);
  check(
    "[12e] statSplits starts parsed (gamesPlayed proxy)",
    s12?.first_inning_starts === 32
  );
  check("[12f] statSplits WHIP parsed", s12?.first_inning_whip === 1.03);
  check("[12g] statSplits mlb_person_id set", s12?.mlb_person_id === 676979);
  check("[12h] statSplits season set", s12?.season === 2025);
  check("[12i] statSplits raw_source", s12?.raw_source === "mlb_stats_api");

  mockOk({ stats: [{ splits: [] }] });
  const s13 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check("[13a] empty splits returns non-null record", s13 !== null);
  check("[13b] empty splits → era null", s13?.first_inning_era === null);
  check("[13c] empty splits → starts null", s13?.first_inning_starts === null);
  check("[13d] empty splits → mlb_person_id populated", s13?.mlb_person_id === 99);
  check("[13e] empty splits → season populated", s13?.season === 2025);

  mockOk({
    stats: [
      {
        splits: [
          {
            split: { code: "i01" },
            stat: {
              era: "-.--",
              earnedRuns: 0,
              runs: 0,
              inningsPitched: "0.0",
              gamesPlayed: 0,
              whip: "-.--",
            },
          },
        ],
      },
    ],
  });
  const s14 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check("[14a] era '-.--' → null", s14?.first_inning_era === null);
  check("[14b] whip '-.--' → null", s14?.first_inning_whip === null);

  const ipResp = (ip: string) => ({
    stats: [
      {
        splits: [
          {
            split: { code: "i01" },
            stat: {
              era: "2.0",
              earnedRuns: 1,
              runs: 1,
              inningsPitched: ip,
              gamesPlayed: 1,
              whip: "1.0",
            },
          },
        ],
      },
    ],
  });

  mockOk(ipResp("5.2"));
  const s15 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[15] IP '5.2' → 5.667 (baseball-decimal, NOT 5.2)",
    isClose(s15?.first_inning_innings_pitched, 5 + 2 / 3)
  );

  mockOk(ipResp("0.1"));
  const s16 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[16] IP '0.1' → 0.333 (one out)",
    isClose(s16?.first_inning_innings_pitched, 1 / 3)
  );

  mockOk(ipResp("6.0"));
  const s17 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[17] IP '6.0' → 6 exact",
    s17?.first_inning_innings_pitched === 6
  );

  mockOk(ipResp("abc"));
  const s18 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[18a] IP 'abc' → null for IP only",
    s18?.first_inning_innings_pitched === null
  );
  check(
    "[18b] other fields parsed despite IP malformed",
    s18?.first_inning_era === 2.0
  );

  mockOk(ipResp("6.5"));
  const s18c = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[18c] IP '6.5' → null (fraction digit > 2)",
    s18c?.first_inning_innings_pitched === null
  );

  mockOk({
    stats: [
      {
        splits: [
          {
            split: { code: "i01" },
            stat: {
              era: "3.0",
              earnedRuns: 1,
              runs: 1,
              inningsPitched: "3.0",
              whip: "1.0",
            },
          },
        ],
      },
    ],
  });
  const s19 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check(
    "[19a] missing gamesPlayed → first_inning_starts null",
    s19?.first_inning_starts === null
  );
  check(
    "[19b] missing gamesPlayed → era still parsed",
    s19?.first_inning_era === 3.0
  );

  mockNetworkThrow();
  const s20 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check("[20] stats fetch network error → null", s20 === null);

  mockHttpError(500);
  const s21 = await getPitcherFirstInningStats(99, 2025, { quiet: true });
  check("[21] stats HTTP 500 → null", s21 === null);

  // ── parseBaseballInningsPitched direct unit ────────────────────────

  check("[P1] parser '6.0' → 6", parseBaseballInningsPitched("6.0") === 6);
  check(
    "[P2] parser '6.1' → 6+1/3",
    isClose(parseBaseballInningsPitched("6.1"), 6 + 1 / 3)
  );
  check(
    "[P3] parser '6.2' → 6+2/3",
    isClose(parseBaseballInningsPitched("6.2"), 6 + 2 / 3)
  );
  check(
    "[P4] parser '5.2' → 5+2/3 (NOT 5.2 decimal)",
    isClose(parseBaseballInningsPitched("5.2"), 5 + 2 / 3)
  );
  check(
    "[P5] parser '0.1' → 1/3",
    isClose(parseBaseballInningsPitched("0.1"), 1 / 3)
  );
  check("[P6] parser 'abc' → null", parseBaseballInningsPitched("abc") === null);
  check(
    "[P7] parser '6.3' (frac > 2) → null",
    parseBaseballInningsPitched("6.3") === null
  );
  check("[P8] parser '' → null", parseBaseballInningsPitched("") === null);
  check("[P9] parser null → null", parseBaseballInningsPitched(null) === null);
  check("[P10] parser number-input → null", parseBaseballInningsPitched(6.0) === null);

  restore();

  console.log("\n" + "━".repeat(70));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Failures.");
    process.exit(1);
  }
  console.log("\n✅ All Phase 3.x.0b MLB Stats API helper tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
