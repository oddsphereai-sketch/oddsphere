/**
 * Phase 6B.2b — member tracking page tests.
 *
 * Grep-based assertions against the member tracking surface:
 *   • app/lab/tracking/page.tsx (rewritten layout)
 *   • app/api/lab/tracking-foundation/route.ts (expanded API)
 *
 * The page is a client React component with no DOM here, so we assert
 * structural invariants — the same approach used elsewhere in this
 * project (see scripts/test-tracking-foundation.ts).
 */

import { readFileSync } from "node:fs";

const PAGE = readFileSync("app/lab/tracking/page.tsx", "utf8");
const API = readFileSync("app/api/lab/tracking-foundation/route.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ tracking page tests ━━━\n`);

// API surface ────────────────────────────────────────────────────────

check("API surfaces byPlayGrade", API.includes("byPlayGrade: result.byPlayGrade"));
check("API surfaces byModelVersion", API.includes("byModelVersion: result.byModelVersion"));
check("API surfaces leans", API.includes("leans: result.leans"));
check("API excludes launch-day picks", API.includes("includeLaunchDay: false"));
check("API does not expose raw model audit", !/sport_specific|fi_v2_audit|v2_2_audit/.test(API));
check("API marks no-store cache", API.includes('"Cache-Control": "no-store"'));

// Page structure ─────────────────────────────────────────────────────

check("Page is client component", PAGE.includes('"use client"'));
check("Page consumes tracking-foundation API", PAGE.includes("/api/lab/tracking-foundation"));
check("Page renders Model Tracking title", PAGE.includes("Model Tracking"));
check("Page renders updated timestamp", PAGE.includes("Updated"));

// Required sections ──────────────────────────────────────────────────

for (const label of [
  "Overall record",
  "By market",
  "By play grade",
  "By model version",
  "What this means",
  "Historical baselines",
]) {
  check(`Page renders '${label}' section`, PAGE.includes(label));
}

// Top summary cards ──────────────────────────────────────────────────

check("Page shows All picks card", PAGE.includes("All picks"));
check("Page shows Best Angle card", PAGE.includes("Best Angle"));
check("Page shows Pending card", PAGE.includes("Pending"));

// Market splits ──────────────────────────────────────────────────────

check("Page renders Moneyline market card", PAGE.includes("Moneyline"));
check("Page renders Total O/U market card", PAGE.includes("Total O/U"));
check("Page renders First Inning market card", PAGE.includes("First Inning"));
check("Page surfaces NRFI / YRFI inside FI card", /NRFI[\s\S]{0,80}YRFI/.test(PAGE));

// Play-grade splits: Toss-Up + Held are state counts only ────────────

check(
  "Page marks Toss-Up / Held as state-only",
  /pg === "toss_up" \|\| pg === "held"/.test(PAGE),
);
check(
  "Page documents Toss-Up/Held are not graded as bets",
  PAGE.includes("not graded as bet") || PAGE.includes("state counts only"),
);
check(
  "Page renders all five play-grade cards",
  /best_angle[\s\S]{0,80}lean[\s\S]{0,80}no_bet[\s\S]{0,80}toss_up[\s\S]{0,80}held/.test(PAGE),
);

// Model version splits ──────────────────────────────────────────────

check("Page distinguishes FI V2 label", /fi_v2[\s\S]{0,80}FI V2/.test(PAGE));
check("Page distinguishes legacy / pre-cutover", PAGE.includes("Legacy / Pre-cutover"));

// Mobile-first / Daily Edge palette ─────────────────────────────────

check("Page uses dark premium background", PAGE.includes("bg-[#0a0d14]"));
check("Page uses card surface treatment", PAGE.includes("bg-white/[0.02]"));
check("Page uses border treatment", PAGE.includes("border-white/[0.04]"));
check("Page uses emerald accent for win rates", /emerald-300/.test(PAGE));
check("Page uses responsive grid columns", /grid-cols-2 sm:grid-cols-/.test(PAGE));
check("Page has sm: breakpoint padding", PAGE.includes("sm:px-6"));
check("Page constrains content max width", PAGE.includes("max-w-5xl"));

// Footer / disclosure ───────────────────────────────────────────────

check(
  "Page discloses excluded categories in footer",
  /excludes pushes[\s\S]{0,80}Toss-Up and Held/.test(PAGE),
);
check(
  "Page discloses postponed = void rule",
  /[Pp]ostponed[\s\S]{0,80}void/.test(PAGE),
);

// Honest empty / loading / error states ─────────────────────────────

check("Page renders loading state", PAGE.includes("Loading tracking"));
check("Page renders error state", PAGE.includes("temporarily unavailable"));
check(
  "Page renders pre-init state",
  PAGE.includes("Tracking is initializing"),
);

// Data hygiene ──────────────────────────────────────────────────────

check(
  "fmtPct returns em-dash when no decided picks",
  /win_pct === null[\s\S]{0,40}"—"/.test(PAGE),
);
check(
  "Page does not roll Toss-Up/Held into overall win rate",
  // Overall card consumes data.overall directly from the server, which
  // computes win_pct on decided picks only. Toss-Up + Held are NEVER
  // re-added on the page.
  !/toss_up[\s\S]{0,80}\+=\s*wins/.test(PAGE),
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
