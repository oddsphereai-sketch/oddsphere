/**
 * Tests for /api/admin/upload-scores-model + /api/admin/games endpoints.
 *
 *   • Auth: missing token → 401, wrong email → 403, valid → ok
 *   • GET /games: returns the seeded slate with team abbreviations
 *   • POST upload: 12 predictions ingested + verdict regeneration triggered
 *   • Idempotency: re-upload UPSERTs cleanly
 *
 * Run with: npm run test:admin-upload
 */

import { GET as gamesGet } from "../app/api/admin/games/route";
import { POST as uploadPost } from "../app/api/admin/upload-scores-model/route";
import { supabase } from "../lib/db/supabase";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`; console.log(msg); failures.push(msg); }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const TEST_TOKEN = "phase4h-admin-token";
const ALLOWED_EMAIL = "test@oddsphere.dev";

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
function unauthedToken(url: string): Request {
  return new Request(url, {
    headers: { "x-admin-email": ALLOWED_EMAIL, "x-admin-token": "wrong" },
  });
}
function unauthedEmail(url: string): Request {
  return new Request(url, {
    headers: { "x-admin-email": "intruder@example.com", "x-admin-token": TEST_TOKEN },
  });
}

async function main() {
  const origToken = process.env.ADMIN_TOKEN;
  const origAllowlist = process.env.ADMIN_EMAIL_ALLOWLIST;
  process.env.ADMIN_TOKEN = TEST_TOKEN;
  process.env.ADMIN_EMAIL_ALLOWLIST = ALLOWED_EMAIL;

  // ─── /api/admin/games ────────────────────────────────────────────────────
  section("/api/admin/games");

  const noAuthRes = await gamesGet(new Request("https://x?sport=mlb&date=2026-05-22"));
  check("missing headers → 401", noAuthRes.status === 401);

  const wrongTokenRes = await gamesGet(unauthedToken("https://x?sport=mlb&date=2026-05-22"));
  check("wrong token → 401", wrongTokenRes.status === 401);

  const wrongEmailRes = await gamesGet(unauthedEmail("https://x?sport=mlb&date=2026-05-22"));
  check("non-allowlisted email → 403", wrongEmailRes.status === 403);

  const okRes = await gamesGet(authed("https://x?sport=mlb&date=2026-05-22"));
  check("authed → 200", okRes.status === 200);
  const okBody = (await okRes.json()) as { sport: string; date: string; games: Array<{ external_id: number; home_team: { abbreviation: string }; away_team: { abbreviation: string } }> };
  check("returns sport+date", okBody.sport === "mlb" && okBody.date === "2026-05-22");
  check(`returns 12 games`, okBody.games.length === 12);
  check("each game has team abbreviations", okBody.games.every(g => typeof g.home_team.abbreviation === "string" && typeof g.away_team.abbreviation === "string"));

  // Missing query params
  const noParams = await gamesGet(authed("https://x"));
  check("missing query params → 400", noParams.status === 400);
  const badDate = await gamesGet(authed("https://x?sport=mlb&date=invalid"));
  check("invalid date → 400", badDate.status === 400);

  // ─── /api/admin/upload-scores-model ──────────────────────────────────────
  section("/api/admin/upload-scores-model");

  const noAuthUpload = await uploadPost(new Request("https://x", {
    method: "POST",
    body: JSON.stringify({}),
  }));
  check("upload missing auth → 401", noAuthUpload.status === 401);

  // Happy path — re-upload the seeded predictions
  const predictions = okBody.games.map((g, i) => ({
    game_external_id: g.external_id,
    predicted_home_score: 4.5 + i * 0.1,
    predicted_away_score: 3.5 + i * 0.1,
    predicted_total: 8.0 + i * 0.2,
    predicted_ml_winner: "home" as const,
    ml_confidence: 60.0 + i,
    predicted_ou_side: "under" as const,
    ou_confidence: 55.0,
    predicted_nrfi: true,
    nrfi_confidence: 58.0,
    model_version: "daniels-v3.2-test",
    computed_at: new Date().toISOString(),
  }));

  const uploadRes = await uploadPost(authed("https://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sport: "mlb", date: "2026-05-22", predictions }),
  }));
  check("upload happy path → 200", uploadRes.status === 200);
  const uploadBody = (await uploadRes.json()) as {
    inserted: number; updated: number; failed: number; verdicts_updated: number; errors: unknown[]; run_id: number | null;
    source_type_written?: string;
  };
  check(`upload: 12 updated (UPSERT existing)`, uploadBody.updated === 12);
  check(`upload: 0 failed`, uploadBody.failed === 0);
  // Fix 4.1 (Gap-18+19): verdicts_updated returns 0 — legacy
  // regenerateSharpVerdicts removed; signal text derives at API response
  // time via signalSummaryGenerator. The response field is preserved for
  // wire-shape stability but no longer triggers cron-side text generation.
  check(
    `upload: verdicts_updated === 0 (legacy regeneration removed)`,
    uploadBody.verdicts_updated === 0
  );
  check(`upload: run_id populated`, typeof uploadBody.run_id === "number");

  // Fix 6.1 (Gap-23.5): admin upload response advertises the source_type
  // that was actually written. Confirms the new provenance contract.
  check(
    `upload: response.source_type_written === "manual"`,
    uploadBody.source_type_written === "manual"
  );

  // Verify the upload landed
  const { data: gpRow } = await supabase
    .from("game_predictions")
    .select("ml_confidence, model_version, source_type")
    .eq("model_version", "daniels-v3.2-test")
    .limit(1);
  check(
    `DB: game_predictions updated with new model_version`,
    (gpRow ?? []).length === 1
  );

  // Fix 6.1 (Gap-23.5): manual upload writes source_type='manual' so the
  // production filter at lib/db/productionFilter.ts passes the row through
  // to member-facing /lab/* responses. Pre-Fix-6.1 the column relied on
  // DB DEFAULT 'mock' and the filter hid Daniel's uploads in production.
  check(
    `DB: game_predictions.source_type === "manual" after admin upload (Fix 6.1 / Gap-23.5)`,
    ((gpRow ?? []) as Array<{ source_type: string | null }>)[0]?.source_type === "manual"
  );

  // Bulk check: every row touched by the upload now carries source_type='manual'.
  const { data: allManualRows } = await supabase
    .from("game_predictions")
    .select("id, source_type")
    .eq("model_version", "daniels-v3.2-test");
  const allManual = ((allManualRows ?? []) as Array<{ source_type: string | null }>).every(
    (r) => r.source_type === "manual"
  );
  check(
    `DB: every uploaded game_predictions row carries source_type='manual' (12 rows)`,
    allManual && (allManualRows ?? []).length === 12
  );

  // Idempotency: re-upload same payload → all 12 updated again
  const uploadRes2 = await uploadPost(authed("https://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sport: "mlb", date: "2026-05-22", predictions }),
  }));
  const uploadBody2 = (await uploadRes2.json()) as { updated: number; inserted: number };
  check("upload idempotent: re-upload still updates all 12", uploadBody2.updated === 12);
  check("upload idempotent: no new inserts", uploadBody2.inserted === 0);

  // Per-row validation failures
  const badPredictions = [
    {
      game_external_id: okBody.games[0]!.external_id,
      predicted_home_score: -1, // invalid
      predicted_away_score: 3,
      predicted_total: 7,
      predicted_ml_winner: "home" as const,
      ml_confidence: 60,
      predicted_ou_side: "under" as const,
      ou_confidence: 55,
      predicted_nrfi: true,
      nrfi_confidence: 58,
      model_version: "daniels-test",
      computed_at: new Date().toISOString(),
    },
  ];
  const badUpload = await uploadPost(authed("https://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sport: "mlb", date: "2026-05-22", predictions: badPredictions }),
  }));
  const badBody = (await badUpload.json()) as { failed: number; errors: Array<{ errors: string[] }> };
  check("upload: bad row counted as failed", badBody.failed === 1);
  check(
    "upload: error message mentions 'predicted_home_score'",
    badBody.errors[0]?.errors.some(e => e.toLowerCase().includes("home_score")) ?? false
  );

  // Restore env
  if (origToken) process.env.ADMIN_TOKEN = origToken; else delete process.env.ADMIN_TOKEN;
  if (origAllowlist) process.env.ADMIN_EMAIL_ALLOWLIST = origAllowlist; else delete process.env.ADMIN_EMAIL_ALLOWLIST;

  // Fix 6.1 (Gap-23.5): the admin upload above flipped 12 seed
  // game_predictions rows to source_type='manual'. Restore to 'mock' so
  // subsequent suites (test:production-source-filter, test:lab-daily-edge)
  // see the seed slate in its original mock state. Without this restore,
  // the production-filter E2E "prod mode → 0 games" assertion would fail
  // because the seed slate rows would surface as 'manual'.
  await supabase
    .from("game_predictions")
    .update({ source_type: "mock" })
    .eq("model_version", "daniels-v3.2-test");

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach(m => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All admin-upload tests passed.`);
}

main().catch(e => {
  console.error("\n❌ test-admin-upload failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
