/**
 * Tests for slatePublishService (Phase 6.3d).
 *
 *   • Transitions: draft → published, published → final (gated on all
 *     games STATUS_FINAL), any → hidden.
 *   • Idempotency: re-running a transition on the current state returns
 *     the right counts without writing duplicates.
 *   • promoteHistoricalDrafts respects the cutoff date.
 *   • getPublishStatus collapses to a single value when uniform, returns
 *     "mixed" when split, "empty" when no rows.
 *   • listPublishedSlates groups by slate_date with correct game counts.
 *   • Audit log: every transition writes exactly one admin_audit_log row
 *     with the right action_type + JSONB before/after_state.
 *   • CHECK constraint enforces the slate_status vocabulary at the DB.
 *
 * STRATEGY
 *   The test creates ITS OWN isolated games + admin_audit_log rows scoped
 *   to a synthetic future slate_date (2099-12-31) and a synthetic sport
 *   marker ("__test_publish__" — passed as Sport's open string union). This
 *   avoids touching the seed slate. Cleanup at the end deletes only the
 *   rows it created.
 *
 * Prerequisite: schema-migration-v8 + v12 applied.
 *
 * Run with: npm run test:slate-publish
 */

import {
  publishSlate,
  finalizeSlate,
  hideSlate,
  getPublishStatus,
  listPublishedSlates,
  promoteHistoricalDrafts,
} from "../lib/services/slatePublishService";
import { supabase } from "../lib/db/supabase";
import type { Sport } from "../lib/types/domain/Sport";

const TEST_SLATE = "2099-12-31";
const TEST_SLATE_OLDER = "2099-12-30";
const TEST_SLATE_FUTURE = "2099-12-31"; // cutoff sanity for promote
const TEST_SPORT = "__test_publish__" as Sport;

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

type GameSeed = {
  externalId: number;
  status: string; // STATUS_SCHEDULED or STATUS_FINAL
  slate_status: string; // draft / published / final / hidden
  slate_date: string;
};

async function seedTestGames(games: GameSeed[]): Promise<number[]> {
  const rows = games.map((g) => ({
    sport: TEST_SPORT,
    external_id: g.externalId,
    home_team_id: null,
    away_team_id: null,
    home_pitcher_id: null,
    away_pitcher_id: null,
    ballpark_id: null,
    game_date: `${g.slate_date}T23:00:00.000Z`,
    slate_date: g.slate_date,
    season: 2099,
    season_type: "regular",
    postseason: false,
    status: g.status,
    slate_status: g.slate_status,
  }));
  const { data, error } = await supabase.from("games").insert(rows).select("id");
  if (error) {
    throw new Error(`seedTestGames failed: ${error.message}`);
  }
  return ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
}

async function cleanupTestGames(): Promise<void> {
  // Delete any test-prefixed admin_audit_log rows first (FK-safe — they
  // have no FK back to games, but keep the cleanup symmetrical).
  await supabase
    .from("admin_audit_log")
    .delete()
    .like("action_type", "slate.%")
    .or(
      `before_state->>sport.eq.${TEST_SPORT},after_state->>sport.eq.${TEST_SPORT}`
    );
  // PostgREST `or` with json operators is finicky; do a fallback sweep on
  // the after_state alone since every action writes that field.
  await supabase
    .from("admin_audit_log")
    .delete()
    .filter("after_state->>sport", "eq", TEST_SPORT);

  // Then the synthetic games.
  await supabase.from("games").delete().eq("sport", TEST_SPORT);
}

async function loadSlateStatuses(
  date: string
): Promise<Array<{ id: number; status: string; slate_status: string }>> {
  const { data, error } = await supabase
    .from("games")
    .select("id, status, slate_status")
    .eq("sport", TEST_SPORT)
    .eq("slate_date", date);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: number;
    status: string;
    slate_status: string;
  }>;
}

async function countAuditRows(action_type: string): Promise<number> {
  const { count, error } = await supabase
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action_type", action_type)
    .filter("after_state->>sport", "eq", TEST_SPORT);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main() {
  // Wipe any leftovers from a prior failed run.
  await cleanupTestGames();

  try {
    // ─── Transitions: draft → published ────────────────────────────────
    section("publishSlate (draft → published)");

    await seedTestGames([
      { externalId: 9_000_001, status: "STATUS_SCHEDULED", slate_status: "draft", slate_date: TEST_SLATE },
      { externalId: 9_000_002, status: "STATUS_SCHEDULED", slate_status: "draft", slate_date: TEST_SLATE },
    ]);

    let auditBefore = await countAuditRows("slate.publish");
    const r1 = await publishSlate(TEST_SPORT, TEST_SLATE);
    check("publishSlate promotes draft rows", r1.promoted === 2);
    const after1 = await loadSlateStatuses(TEST_SLATE);
    check(
      "all rows now read slate_status=published",
      after1.every((r) => r.slate_status === "published")
    );
    check(
      "publishSlate writes exactly one admin_audit_log row",
      (await countAuditRows("slate.publish")) === auditBefore + 1
    );

    // Idempotency
    const r2 = await publishSlate(TEST_SPORT, TEST_SLATE);
    check(
      "re-publishing an already-published slate returns promoted=0",
      r2.promoted === 0
    );
    check(
      "idempotent re-publish does NOT write another audit row",
      (await countAuditRows("slate.publish")) === auditBefore + 1
    );

    // ─── finalizeSlate gate: only when ALL games STATUS_FINAL ──────────
    section("finalizeSlate (gated on STATUS_FINAL)");

    const r3 = await finalizeSlate(TEST_SPORT, TEST_SLATE);
    check(
      "finalizeSlate refuses when any game is still STATUS_SCHEDULED",
      r3.finalized === 0
    );
    check(
      "no audit row written when finalize is refused",
      (await countAuditRows("slate.finalize")) === 0
    );

    // Mark all games final, then try again
    await supabase
      .from("games")
      .update({ status: "STATUS_FINAL" })
      .eq("sport", TEST_SPORT)
      .eq("slate_date", TEST_SLATE);

    const r4 = await finalizeSlate(TEST_SPORT, TEST_SLATE);
    check("finalizeSlate promotes when all games STATUS_FINAL", r4.finalized === 2);
    const after2 = await loadSlateStatuses(TEST_SLATE);
    check(
      "all rows now read slate_status=final",
      after2.every((r) => r.slate_status === "final")
    );
    check(
      "finalizeSlate writes one audit row",
      (await countAuditRows("slate.finalize")) === 1
    );

    const r5 = await finalizeSlate(TEST_SPORT, TEST_SLATE);
    check("idempotent finalize returns finalized=0", r5.finalized === 0);

    // ─── hideSlate from any state ───────────────────────────────────────
    section("hideSlate (any → hidden)");

    const r6 = await hideSlate(TEST_SPORT, TEST_SLATE, "test retraction");
    check("hideSlate retracts from final → hidden", r6.hidden === 2);
    const after3 = await loadSlateStatuses(TEST_SLATE);
    check(
      "all rows now read slate_status=hidden",
      after3.every((r) => r.slate_status === "hidden")
    );
    check(
      "hideSlate writes one audit row",
      (await countAuditRows("slate.hide")) === 1
    );

    // ─── getPublishStatus → uniform / mixed / empty ─────────────────────
    section("getPublishStatus");

    check(
      "uniform-hidden slate returns 'hidden'",
      (await getPublishStatus(TEST_SPORT, TEST_SLATE)) === "hidden"
    );

    check(
      "empty slate returns 'empty'",
      (await getPublishStatus(TEST_SPORT, "2099-01-01")) === "empty"
    );

    // Manually split the slate by flipping one row back to draft
    const after4 = await loadSlateStatuses(TEST_SLATE);
    await supabase
      .from("games")
      .update({ slate_status: "draft" })
      .eq("id", after4[0].id);
    check(
      "split slate returns 'mixed'",
      (await getPublishStatus(TEST_SPORT, TEST_SLATE)) === "mixed"
    );

    // Reset to consistent state for the rest of the tests
    await supabase
      .from("games")
      .update({ slate_status: "hidden" })
      .eq("sport", TEST_SPORT)
      .eq("slate_date", TEST_SLATE);

    // ─── listPublishedSlates ───────────────────────────────────────────
    section("listPublishedSlates");

    // Seed a second TEST slate as published so the list has something
    await seedTestGames([
      {
        externalId: 9_001_001,
        status: "STATUS_SCHEDULED",
        slate_status: "published",
        slate_date: TEST_SLATE_OLDER,
      },
      {
        externalId: 9_001_002,
        status: "STATUS_SCHEDULED",
        slate_status: "published",
        slate_date: TEST_SLATE_OLDER,
      },
    ]);

    const list = await listPublishedSlates(TEST_SPORT);
    const ourEntry = list.find((e) => e.slate_date === TEST_SLATE_OLDER);
    check(
      "listPublishedSlates returns the seeded published slate with correct gameCount",
      ourEntry !== undefined && ourEntry.gameCount === 2
    );

    // ─── promoteHistoricalDrafts cutoff ─────────────────────────────────
    section("promoteHistoricalDrafts");

    // Clean and seed two slates: one before cutoff, one at/after.
    await cleanupTestGames();
    await seedTestGames([
      {
        externalId: 9_002_001,
        status: "STATUS_SCHEDULED",
        slate_status: "draft",
        slate_date: "2099-11-30", // before cutoff
      },
      {
        externalId: 9_002_002,
        status: "STATUS_SCHEDULED",
        slate_status: "draft",
        slate_date: TEST_SLATE_FUTURE, // at cutoff — must NOT be promoted
      },
    ]);

    const r7 = await promoteHistoricalDrafts(TEST_SLATE_FUTURE, TEST_SPORT);
    check(
      "promoteHistoricalDrafts (scoped to TEST_SPORT) promoted exactly 1 — the older row",
      r7.promoted === 1
    );
    const after5 = await loadSlateStatuses("2099-11-30");
    check(
      "older slate is now published",
      after5.every((r) => r.slate_status === "published")
    );
    const after6 = await loadSlateStatuses(TEST_SLATE_FUTURE);
    check(
      "cutoff-date slate remains draft (not promoted)",
      after6.every((r) => r.slate_status === "draft")
    );

    const r8 = await promoteHistoricalDrafts(TEST_SLATE_FUTURE, TEST_SPORT);
    check("re-running promoteHistoricalDrafts (TEST_SPORT) returns promoted=0", r8.promoted === 0);

    // ─── CHECK constraint enforces the vocabulary ──────────────────────
    section("CHECK constraint");

    const { error: badError } = await supabase
      .from("games")
      .update({ slate_status: "archived" })
      .eq("sport", TEST_SPORT)
      .eq("slate_date", "2099-11-30");
    check(
      "writing an invalid slate_status value fails (V8 CHECK constraint)",
      badError !== null && /check/i.test(badError?.message ?? "")
    );
  } finally {
    // Always clean up — even if assertions failed.
    await cleanupTestGames();
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All slate-publish tests passed.`);
}

main().catch(async (e) => {
  console.error("\n❌ test-slate-publish failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  await cleanupTestGames();
  process.exit(1);
});
