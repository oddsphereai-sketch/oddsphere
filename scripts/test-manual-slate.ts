/**
 * Fix 7.2 — manual slate provider + admin upload route + UI integration tests.
 *
 * Coverage:
 *   • ManualSlateProvider construction (default + stagingRowId variants)
 *   • manualGameExternalId determinism + manual-range bounds + collision check
 *   • manualProviderIdKey natural-key shape
 *   • Route: missing auth → 401, wrong email → 403, valid auth → 200
 *   • Route: body shape validation (missing sport, bad date, empty games)
 *   • Route: unknown team abbreviation → 400 with structured unknown_teams
 *   • Route: zero-teams-for-sport → 400 with multi-sport empty-state hint
 *   • Route: happy path — INSERT staging, inline refresh, UPDATE staging
 *   • Route: idempotency — same payload twice → same games count via
 *     deterministic external_id + UPSERT, 2 distinct staging rows recorded
 *   • DB shape: ingested games carry provider_ids.manual = natural-key string
 *   • Cleanup: every test removes its manually-created games + staging rows
 *     so subsequent suites see the seed slate in its original state.
 *
 * Prerequisites:
 *   • V14 + V15 migrations applied (provider_ids JSONB on games/teams/players,
 *     manual_slate_staging table created).
 *   • `npm run seed` recently to populate the MLB teams + reference data.
 */

import { GET as teamsGet } from "../app/api/admin/teams/route";
import { POST as uploadSlatePost } from "../app/api/admin/upload-slate/route";
import { supabase } from "../lib/db/supabase";
import {
  ManualSlateProvider,
  manualGameExternalId,
  manualProviderIdKey,
} from "../lib/providers/manual/ManualSlateProvider";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
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

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const TEST_TOKEN = "phase4h-admin-token";
const ALLOWED_EMAIL = "test@oddsphere.dev";
const TEST_SLATE_DATE = "2030-01-15"; // far-future date to avoid collisions with seed slate

function authed(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-admin-email": ALLOWED_EMAIL,
      "x-admin-token": TEST_TOKEN,
    },
  });
}
function unauthedToken(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-admin-email": ALLOWED_EMAIL,
      "x-admin-token": "wrong",
    },
  });
}
function unauthedEmail(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-admin-email": "intruder@example.com",
      "x-admin-token": TEST_TOKEN,
    },
  });
}

async function cleanupTestSlate() {
  // Remove staging rows + games created during this test run.
  await supabase
    .from("manual_slate_staging")
    .delete()
    .eq("slate_date", TEST_SLATE_DATE);
  // Also delete any games whose provider_ids.manual prefix matches our test slate.
  // Use the deterministic external_id range to scope safely.
  await supabase
    .from("games")
    .delete()
    .gte("external_id", 1_000_000_000)
    .eq("sport", "mlb");
}

async function main() {
  const origToken = process.env.ADMIN_TOKEN;
  const origAllowlist = process.env.ADMIN_EMAIL_ALLOWLIST;
  process.env.ADMIN_TOKEN = TEST_TOKEN;
  process.env.ADMIN_EMAIL_ALLOWLIST = ALLOWED_EMAIL;

  // Clean slate before we start, in case a prior test run left rows behind.
  await cleanupTestSlate();

  // ─── manualGameExternalId — Flag D1 determinism + range ─────────────────
  section("manualGameExternalId — Flag D1 deterministic hash");

  const idA = manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS");
  const idB = manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS");
  check("same inputs → same external_id (idempotency)", idA === idB);

  const idC = manualGameExternalId("mlb", "2026-05-28", "BOS", "NYY");
  check("swapping home/away changes the id (NYY-BOS ≠ BOS-NYY)", idA !== idC);

  const idD = manualGameExternalId("nba", "2026-05-28", "NYY", "BOS");
  check("different sport changes the id", idA !== idD);

  check(
    `external_id within manual range [1_000_000_000, 2_073_741_823] (got ${idA})`,
    idA >= 1_000_000_000 && idA <= 2_073_741_823
  );

  // Collision check across 200+ plausible tuples. Uses deduplicated team
  // list so we never feed identical (sport, date, home, away) tuples to the
  // hash and self-report a "collision" that's really a duplicate input.
  const seen = new Set<number>();
  const sports = ["mlb", "nba", "nfl", "nhl", "ucl"];
  const dates = ["2026-05-28", "2026-05-29", "2026-06-01", "2026-09-15"];
  const teams = Array.from(
    new Set(["NYY", "BOS", "LAD", "SF", "CHC", "HOU", "TEX", "TOR", "LAL", "GSW"])
  );
  let collisions = 0;
  let pairs = 0;
  for (const sp of sports) {
    for (const dt of dates) {
      for (let i = 0; i < teams.length; i++) {
        for (let j = 0; j < teams.length; j++) {
          if (i === j) continue;
          pairs++;
          const id = manualGameExternalId(sp, dt, teams[i]!, teams[j]!);
          if (seen.has(id)) collisions++;
          seen.add(id);
        }
      }
    }
  }
  check(
    `zero hash collisions across ${pairs} unique tuples (got ${collisions} collisions, ${seen.size} unique ids)`,
    collisions === 0
  );

  // ─── manualProviderIdKey natural-key shape ───────────────────────────────
  section("manualProviderIdKey — natural key string");
  check(
    "natural key has expected sport:date:home:away format",
    manualProviderIdKey("mlb", "2026-05-28", "NYY", "BOS") ===
      "mlb:2026-05-28:NYY:BOS"
  );

  // ─── Fix 7.2.2 — Defensive normalization (Item 2) ────────────────────────
  // Inputs to manualGameExternalId / manualProviderIdKey are normalized
  // (sport lowercase, abbrev uppercase+trimmed, strict YYYY-MM-DD) so the
  // same logical matchup always hashes to the same external_id regardless
  // of operator input casing or whitespace.
  section("Fix 7.2.2 — manual key normalization");

  check(
    "manualGameExternalId is case-invariant on sport",
    manualGameExternalId("MLB", "2026-05-28", "NYY", "BOS") ===
      manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS")
  );
  check(
    "manualGameExternalId is case-invariant on team abbreviations",
    manualGameExternalId("mlb", "2026-05-28", "nyy", "bos") ===
      manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS")
  );
  check(
    "manualGameExternalId trims whitespace on abbreviations",
    manualGameExternalId("mlb", "2026-05-28", "  NYY  ", " BOS ") ===
      manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS")
  );
  check(
    "manualProviderIdKey normalizes to canonical lowercase:uppercase form",
    manualProviderIdKey("MLB", "2026-05-28", " nyy ", "BOS") ===
      "mlb:2026-05-28:NYY:BOS"
  );
  check(
    "manualProviderIdKey + manualGameExternalId stay in lockstep across casing",
    manualProviderIdKey("MLB", "2026-05-28", " nyy ", "BOS") ===
      manualProviderIdKey("mlb", "2026-05-28", "NYY", "BOS") &&
      manualGameExternalId("MLB", "2026-05-28", " nyy ", "BOS") ===
        manualGameExternalId("mlb", "2026-05-28", "NYY", "BOS")
  );

  // Strict slate_date enforcement — throws on malformed input.
  function throwsOn(fn: () => unknown): boolean {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  }
  check(
    "manualGameExternalId throws on '2030-1-15' (single-digit month/day)",
    throwsOn(() => manualGameExternalId("mlb", "2030-1-15", "NYY", "BOS"))
  );
  check(
    "manualGameExternalId throws on '2030/01/15' (wrong separator)",
    throwsOn(() => manualGameExternalId("mlb", "2030/01/15", "NYY", "BOS"))
  );
  check(
    "manualGameExternalId throws on empty slate_date",
    throwsOn(() => manualGameExternalId("mlb", "", "NYY", "BOS"))
  );

  // ─── /api/admin/teams auth + validation ──────────────────────────────────
  section("/api/admin/teams — auth + validation");

  const noAuthTeams = await teamsGet(new Request("https://x?sport=mlb"));
  check("teams: missing headers → 401", noAuthTeams.status === 401);

  const wrongTokenTeams = await teamsGet(unauthedToken("https://x?sport=mlb"));
  check("teams: wrong token → 401", wrongTokenTeams.status === 401);

  const wrongEmailTeams = await teamsGet(unauthedEmail("https://x?sport=mlb"));
  check("teams: non-allowlisted email → 403", wrongEmailTeams.status === 403);

  const noSport = await teamsGet(authed("https://x"));
  check("teams: missing sport query → 400", noSport.status === 400);

  const badSport = await teamsGet(authed("https://x?sport=cricket"));
  check("teams: unknown sport → 400", badSport.status === 400);

  const mlbTeams = await teamsGet(authed("https://x?sport=mlb"));
  check("teams: valid mlb request → 200", mlbTeams.status === 200);
  const mlbBody = (await mlbTeams.json()) as {
    sport: string;
    count: number;
    teams: Array<{ abbreviation: string; display_name: string }>;
  };
  check(`teams: at least 1 MLB team seeded (got ${mlbBody.count})`, mlbBody.count > 0);
  check("teams: payload includes abbreviation + display_name", mlbBody.teams.every(t => typeof t.abbreviation === "string" && typeof t.display_name === "string"));

  // Multi-sport empty state — Flag H1
  const nbaTeams = await teamsGet(authed("https://x?sport=nba"));
  check("teams: nba request → 200 (sport accepted)", nbaTeams.status === 200);
  const nbaBody = (await nbaTeams.json()) as { count: number };
  check("teams: nba count = 0 (empty-state hint will fire)", nbaBody.count === 0);

  // Grab two real MLB team abbreviations for the upload tests
  const homeAbbrev = mlbBody.teams[0]!.abbreviation;
  const awayAbbrev = mlbBody.teams[1]!.abbreviation;

  // ─── /api/admin/upload-slate auth ────────────────────────────────────────
  section("/api/admin/upload-slate — auth");

  const noAuthUpload = await uploadSlatePost(
    new Request("https://x", { method: "POST", body: JSON.stringify({}) })
  );
  check("upload-slate: missing auth → 401", noAuthUpload.status === 401);

  const wrongEmailUpload = await uploadSlatePost(
    unauthedEmail("https://x", { method: "POST", body: JSON.stringify({}) })
  );
  check("upload-slate: non-allowlisted email → 403", wrongEmailUpload.status === 403);

  // ─── Body shape validation ───────────────────────────────────────────────
  section("/api/admin/upload-slate — body validation");

  const missingFields = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "mlb" }),
    })
  );
  check("missing slate_date + games → 400", missingFields.status === 400);

  const badSportUpload = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "cricket", slate_date: TEST_SLATE_DATE, games: [] }),
    })
  );
  check("unknown sport → 400", badSportUpload.status === 400);

  const badDate = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "mlb", slate_date: "2030/01/15", games: [] }),
    })
  );
  check("slate_date not YYYY-MM-DD → 400", badDate.status === 400);

  const emptyGames = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "mlb", slate_date: TEST_SLATE_DATE, games: [] }),
    })
  );
  check("empty games[] → 400", emptyGames.status === 400);

  const sameTeam = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "mlb",
        slate_date: TEST_SLATE_DATE,
        games: [
          {
            home_team_abbrev: homeAbbrev,
            away_team_abbrev: homeAbbrev,
            game_date: "2030-01-15T23:05:00.000Z",
            season: 2030,
          },
        ],
      }),
    })
  );
  check("home == away → 400", sameTeam.status === 400);

  // Fix 7.2.2 (Item 2) — defensive abbrev rejection. The new STRICT_ABBREV
  // regex rejects abbreviations with non-alphanumeric characters even
  // after trim+upper. Whitespace alone is normalized; punctuation is not.
  // Reject case — no DB side effects, safe to run inline with other
  // validation tests.
  const badAbbrev = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "mlb",
        slate_date: TEST_SLATE_DATE,
        games: [
          {
            home_team_abbrev: "N.Y",
            away_team_abbrev: awayAbbrev,
            game_date: "2030-01-15T23:05:00.000Z",
            season: 2030,
          },
        ],
      }),
    })
  );
  check("malformed abbrev with punctuation → 400 (Fix 7.2.2 — Item 2)", badAbbrev.status === 400);

  // ─── Unknown team abbreviation — Flag B1 ────────────────────────────────
  section("/api/admin/upload-slate — unknown team handling (Flag B1)");

  const unknownTeam = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "mlb",
        slate_date: TEST_SLATE_DATE,
        games: [
          {
            home_team_abbrev: "ZZZ",
            away_team_abbrev: awayAbbrev,
            game_date: "2030-01-15T23:05:00.000Z",
            season: 2030,
          },
        ],
      }),
    })
  );
  check("unknown abbreviation → 400", unknownTeam.status === 400);
  const unknownBody = (await unknownTeam.json()) as { unknown_teams?: string[] };
  check(
    "unknown_teams list returned with offending abbrev",
    (unknownBody.unknown_teams ?? []).includes("ZZZ")
  );

  // Multi-sport empty state — NBA upload before teams seeded
  const nbaUpload = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "nba",
        slate_date: TEST_SLATE_DATE,
        games: [
          {
            home_team_abbrev: "LAL",
            away_team_abbrev: "BOS",
            game_date: "2030-01-15T23:05:00.000Z",
            season: 2030,
          },
        ],
      }),
    })
  );
  check("nba slate without seeded teams → 400", nbaUpload.status === 400);
  const nbaUploadBody = (await nbaUpload.json()) as {
    teams_seeded_for_sport?: number;
  };
  check(
    "nba response includes teams_seeded_for_sport hint",
    nbaUploadBody.teams_seeded_for_sport === 0
  );

  // ─── Happy path: upload MLB slate via the route ──────────────────────────
  section("/api/admin/upload-slate — happy path (MLB)");

  const happyPayload = {
    sport: "mlb",
    slate_date: TEST_SLATE_DATE,
    games: [
      {
        home_team_abbrev: homeAbbrev,
        away_team_abbrev: awayAbbrev,
        game_date: "2030-01-15T23:05:00.000Z",
        season: 2030,
        venue: "Test Park",
      },
    ],
  };

  const happyRes = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(happyPayload),
    })
  );
  check("happy path → 200", happyRes.status === 200);
  const happyBody = (await happyRes.json()) as {
    sport: string;
    slate_date: string;
    staging_id: number;
    records_updated: number;
    source: string;
    publish?: { promoted: number; status: "published" | "draft"; error?: string };
  };
  check(`happy path: records_updated === 1 (got ${happyBody.records_updated})`, happyBody.records_updated === 1);
  check("happy path: source = manual_slate_upload", happyBody.source === "manual_slate_upload");
  check("happy path: staging_id is a number", typeof happyBody.staging_id === "number");

  // Fix 7.2.2 — auto-publish (Item 1). After the slate refresh the route
  // promotes draft → published via slatePublishService.publishSlate so the
  // game becomes visible in /lab/daily-edge immediately, without manual
  // SQL workaround.
  check(
    "happy path: publish present in response (Fix 7.2.2 — Item 1)",
    happyBody.publish !== undefined
  );
  check(
    `happy path: publish.status === 'published' (got '${happyBody.publish?.status}')`,
    happyBody.publish?.status === "published"
  );
  check(
    `happy path: publish.promoted === 1 (got ${happyBody.publish?.promoted})`,
    happyBody.publish?.promoted === 1
  );
  check(
    "happy path: no publish error on happy path",
    happyBody.publish?.error === undefined
  );

  // Verify DB shape — games row + provider_ids attachment + slate_status.
  // Fix 7.2.2 (Item 1): slate_status must be 'published' after upload —
  // proves the auto-publish call took effect and removes the SQL workaround.
  const expectedExtId = manualGameExternalId("mlb", TEST_SLATE_DATE, homeAbbrev, awayAbbrev);
  const expectedProviderKey = manualProviderIdKey(
    "mlb",
    TEST_SLATE_DATE,
    homeAbbrev,
    awayAbbrev
  );
  const { data: gameStatusRow } = await supabase
    .from("games")
    .select("slate_status")
    .eq("sport", "mlb")
    .eq("external_id", expectedExtId)
    .maybeSingle();
  check(
    `DB: games.slate_status === 'published' after upload (Fix 7.2.2 — Item 1)`,
    (gameStatusRow as { slate_status: string } | null)?.slate_status === "published"
  );
  const { data: gameRow } = await supabase
    .from("games")
    .select("id, external_id, sport, provider_ids")
    .eq("sport", "mlb")
    .eq("external_id", expectedExtId)
    .maybeSingle();
  check("ingested game row exists with deterministic external_id", gameRow !== null);
  if (gameRow) {
    const pids = (gameRow as { provider_ids: Record<string, unknown> }).provider_ids;
    check(
      `provider_ids.manual === "${expectedProviderKey}"`,
      pids?.manual === expectedProviderKey
    );
  }

  // Staging audit row
  const { data: stagingRow } = await supabase
    .from("manual_slate_staging")
    .select("id, status, ingest_result, created_by")
    .eq("id", happyBody.staging_id)
    .maybeSingle();
  check("staging row written", stagingRow !== null);
  if (stagingRow) {
    const s = stagingRow as {
      status: string;
      ingest_result: { records_updated: number } | null;
      created_by: string;
    };
    check("staging row status = 'ingested'", s.status === "ingested");
    check("staging row records the records_updated count", s.ingest_result?.records_updated === 1);
    check(`staging row records created_by = '${ALLOWED_EMAIL}'`, s.created_by === ALLOWED_EMAIL);
  }

  // ─── Idempotency: re-uploading the same slate ───────────────────────────
  section("/api/admin/upload-slate — idempotency");

  const happyRes2 = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(happyPayload),
    })
  );
  check("re-upload → 200", happyRes2.status === 200);
  const happyBody2 = (await happyRes2.json()) as {
    staging_id: number;
    records_updated: number;
  };
  check("re-upload still reports records_updated === 1", happyBody2.records_updated === 1);
  check(
    "re-upload created a new staging row (distinct staging_id)",
    happyBody2.staging_id !== happyBody.staging_id
  );

  // Games count: still exactly 1 row (UPSERT on (sport, external_id))
  const { count: gameCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("sport", "mlb")
    .eq("external_id", expectedExtId);
  check(
    "games row count for the manual external_id remains 1 after re-upload",
    (gameCount ?? 0) === 1
  );

  // Staging count for (sport, date) is now 2
  const { count: stagingCount } = await supabase
    .from("manual_slate_staging")
    .select("*", { count: "exact", head: true })
    .eq("sport", "mlb")
    .eq("slate_date", TEST_SLATE_DATE);
  check("staging table records both upload attempts (count = 2)", (stagingCount ?? 0) === 2);

  // ─── Fix 7.2.2 (Item 2) — case-invariant happy path ─────────────────────
  // Run AFTER the idempotency section so the staging-count math above
  // stays clean. Upload with sport='MLB' (uppercase) + lowercase team
  // abbreviations; the route's upfront normalization should accept it
  // and UPSERT into the same external_id as the canonical-form upload
  // (no duplicate row produced).
  section("Fix 7.2.2 — case-invariant upload happy path");

  const lowercaseAbbrev = await uploadSlatePost(
    authed("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "MLB",
        slate_date: TEST_SLATE_DATE,
        games: [
          {
            home_team_abbrev: homeAbbrev.toLowerCase(),
            away_team_abbrev: awayAbbrev.toLowerCase(),
            game_date: "2030-01-15T23:05:00.000Z",
            season: 2030,
          },
        ],
      }),
    })
  );
  check(
    `lowercase sport + lowercase abbrev normalize and reach happy path → 200 (got ${lowercaseAbbrev.status})`,
    lowercaseAbbrev.status === 200
  );
  // Confirm UPSERT semantics held — no second row created at a different
  // external_id from the case-variant input.
  const normalizedExtId = manualGameExternalId(
    "mlb",
    TEST_SLATE_DATE,
    homeAbbrev,
    awayAbbrev
  );
  const { count: normalizedRowCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("sport", "mlb")
    .eq("external_id", normalizedExtId);
  check(
    "Fix 7.2.2: case-variant upload UPSERTed the same external_id (no duplicate row)",
    (normalizedRowCount ?? 0) === 1
  );
  // Confirm there are no OTHER manual game rows for this slate_date that
  // could indicate a divergent hash bug. Any second row would mean
  // normalization is leaking somewhere.
  const { count: anyManualForDateCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("sport", "mlb")
    .eq("slate_date", TEST_SLATE_DATE)
    .filter("provider_ids->>manual", "neq", null);
  check(
    "Fix 7.2.2: only one manual game row exists for this slate_date across all uploads",
    (anyManualForDateCount ?? 0) === 1
  );

  // ─── Provider unit test: stagingRowId constructor reads specific row ─────
  section("ManualSlateProvider — stagingRowId constructor");

  const provider = new ManualSlateProvider({ stagingRowId: happyBody.staging_id });
  const games = await provider.getGames(TEST_SLATE_DATE, "mlb");
  check(`provider.getGames returns 1 game from staging row #${happyBody.staging_id}`, games.length === 1);
  if (games[0]) {
    check("provider game has provider_ids.manual attached", games[0].provider_ids?.manual === expectedProviderKey);
    check("provider game external_id matches deterministic hash", games[0].external_id === expectedExtId);
  }

  // ─── Provider unit test: cron path (no stagingRowId) reads latest ────────
  section("ManualSlateProvider — cron-path latest-row lookup");

  const cronProvider = new ManualSlateProvider();
  const cronGames = await cronProvider.getGames(TEST_SLATE_DATE, "mlb");
  check(
    `cron-path lookup returns games (got ${cronGames.length}) — latest non-failed staging row`,
    cronGames.length === 1
  );

  // ─── Cleanup ────────────────────────────────────────────────────────────
  await cleanupTestSlate();

  // Restore env
  if (origToken) process.env.ADMIN_TOKEN = origToken;
  else delete process.env.ADMIN_TOKEN;
  if (origAllowlist) process.env.ADMIN_EMAIL_ALLOWLIST = origAllowlist;
  else delete process.env.ADMIN_EMAIL_ALLOWLIST;

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All manual-slate tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-manual-slate failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
