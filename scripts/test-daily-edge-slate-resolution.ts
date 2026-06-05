/**
 * Phase 4.2.C.1.R-19 Phase 1 (C7) — tests for the slate-resolution state
 * machine in lib/services/dailyEdgeSlateResolution.ts.
 *
 * Pure tests — no DB, no env, no network. Exercises every branch of
 * determineSlateState so the route can rely on the helper's contract.
 *
 * Run: npx tsx scripts/test-daily-edge-slate-resolution.ts
 */

import {
  determineSlateState,
  VISIBLE_SLATE_STATUSES,
} from "../lib/services/dailyEdgeSlateResolution";

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

const REQ = "2026-06-05";
const YESTERDAY = "2026-06-04";

async function main() {
  // ── [A] today_published — visible games present ─────────────────────
  section("Today has visible games → today_published");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "published" },
        { slate_status: "published" },
        { slate_status: "published" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_published", r.slateState === "today_published");
    check("effectiveDate = requested", r.effectiveDate === REQ);
    check("slate_status = published", r.slate_status === "published");
    check("shouldFetchGames = true", r.shouldFetchGames === true);
  }

  // [A.2] today_published wins even when some draft rows linger
  section("Mixed (published + draft) on today → today_published");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "published" },
        { slate_status: "published" },
        { slate_status: "draft" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_published", r.slateState === "today_published");
    check("slate_status = published (dominant visible)", r.slate_status === "published");
    check("shouldFetchGames = true", r.shouldFetchGames === true);
  }

  // [A.3] final-only also visible
  section("Today final-only → today_published");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "final" },
        { slate_status: "final" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_published", r.slateState === "today_published");
    check("slate_status = final", r.slate_status === "final");
  }

  // ── [B] today_pending_ingest — zero rows on requested date ──────────
  section("Today has zero rows (allowStale=false) → today_pending_ingest");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_pending_ingest", r.slateState === "today_pending_ingest");
    check("effectiveDate = requested", r.effectiveDate === REQ);
    check("slate_status = null", r.slate_status === null);
    check("shouldFetchGames = false (no silent fallback)", r.shouldFetchGames === false);
  }

  // [B.2] Crucial regression: today empty, yesterday published, allowStale=false
  //       → MUST NOT silently masquerade yesterday as today.
  section("Today empty + yesterday published + allowStale=false → STILL pending");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [],
      mostRecentVisibleFallback: { slate_date: YESTERDAY, slate_status: "published" },
      allowStale: false,
    });
    check(
      "state = today_pending_ingest (NOT stale_fallback)",
      r.slateState === "today_pending_ingest"
    );
    check("effectiveDate stays = requested", r.effectiveDate === REQ);
    check("shouldFetchGames = false (silent fallback BLOCKED)", r.shouldFetchGames === false);
  }

  // ── [C] today_draft_only ─────────────────────────────────────────────
  section("Today has draft-only games → today_draft_only");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "draft" },
        { slate_status: "draft" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_draft_only", r.slateState === "today_draft_only");
    check("slate_status = draft", r.slate_status === "draft");
    check("shouldFetchGames = false", r.shouldFetchGames === false);
  }

  // ── [D] today_hidden_only ─────────────────────────────────────────────
  section("Today has hidden-only games → today_hidden_only");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "hidden" },
        { slate_status: "hidden" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_hidden_only", r.slateState === "today_hidden_only");
    check("slate_status = hidden", r.slate_status === "hidden");
    check("shouldFetchGames = false", r.shouldFetchGames === false);
  }

  // [D.2] Mixed draft+hidden (no visible) → draft_only (more actionable)
  section("Today has draft+hidden mix → today_draft_only");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [
        { slate_status: "draft" },
        { slate_status: "draft" },
        { slate_status: "hidden" },
      ],
      mostRecentVisibleFallback: null,
      allowStale: false,
    });
    check("state = today_draft_only (mixed pref)", r.slateState === "today_draft_only");
    check("shouldFetchGames = false", r.shouldFetchGames === false);
  }

  // ── [E] stale_fallback — opt-in only ─────────────────────────────────
  section("Today empty + allowStale=true + yesterday published → stale_fallback");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [],
      mostRecentVisibleFallback: { slate_date: YESTERDAY, slate_status: "published" },
      allowStale: true,
    });
    check("state = stale_fallback", r.slateState === "stale_fallback");
    check("effectiveDate = YESTERDAY (the fallback date)", r.effectiveDate === YESTERDAY);
    check("slate_status = published (the fallback's status)", r.slate_status === "published");
    check("shouldFetchGames = true (we have something to render)", r.shouldFetchGames === true);
  }

  // [E.2] allowStale=true overrides draft_only when fallback exists
  section("Today draft-only + allowStale=true + visible yesterday → stale_fallback");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [{ slate_status: "draft" }, { slate_status: "draft" }],
      mostRecentVisibleFallback: { slate_date: YESTERDAY, slate_status: "final" },
      allowStale: true,
    });
    check("state = stale_fallback", r.slateState === "stale_fallback");
    check("effectiveDate = YESTERDAY", r.effectiveDate === YESTERDAY);
    check("slate_status reports fallback's published/final status", r.slate_status === "final");
  }

  // ── [F] no_data — allowStale=true but no fallback exists ─────────────
  section("Today empty + allowStale=true + NO fallback → no_data");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [],
      mostRecentVisibleFallback: null,
      allowStale: true,
    });
    check("state = no_data", r.slateState === "no_data");
    check("effectiveDate stays = requested", r.effectiveDate === REQ);
    check("slate_status = null", r.slate_status === null);
    check("shouldFetchGames = false", r.shouldFetchGames === false);
  }

  // [F.2] allowStale=true + draft-only + NO fallback → no_data, preserves slate_status
  section("Today draft-only + allowStale=true + NO fallback → no_data, status=draft");
  {
    const r = determineSlateState({
      requestedDate: REQ,
      rowsForRequestedDate: [{ slate_status: "draft" }, { slate_status: "draft" }],
      mostRecentVisibleFallback: null,
      allowStale: true,
    });
    check("state = no_data", r.slateState === "no_data");
    check("slate_status = draft (preserves today's actual status)", r.slate_status === "draft");
    check("shouldFetchGames = false", r.shouldFetchGames === false);
  }

  // ── [G] Contract / module constants ──────────────────────────────────
  section("Module contract — VISIBLE_SLATE_STATUSES is set as expected");
  {
    check("VISIBLE_SLATE_STATUSES has 'published'", VISIBLE_SLATE_STATUSES.has("published"));
    check("VISIBLE_SLATE_STATUSES has 'final'", VISIBLE_SLATE_STATUSES.has("final"));
    check("VISIBLE_SLATE_STATUSES does NOT have 'draft'", !VISIBLE_SLATE_STATUSES.has("draft"));
    check("VISIBLE_SLATE_STATUSES does NOT have 'hidden'", !VISIBLE_SLATE_STATUSES.has("hidden"));
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All daily-edge slate-resolution tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
