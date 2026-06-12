/**
 * Cross-sport slate-visibility auditor.
 *
 * HIGH flag when:
 *   - games(sport=X, slate_date=today).count > 0
 *   AND
 *   - prediction_records(sport=X, slate_date=today).count == 0
 *
 * This is the platform contract Daniel called out in the 2026-06-12 P0:
 * if a sport has provider fixtures today, the sport tab must NOT silently
 * appear empty. Every sport that displays on `/lab/daily-edge` is covered.
 *
 * Exit codes:
 *   0  → all sports either have predictions or have no fixtures
 *   2  → at least one sport has fixtures but zero prediction_records (HIGH)
 *
 * Read-only. No writes.
 *
 * Usage:
 *   npm run audit:slate-visibility
 *   npm run audit:slate-visibility -- --date 2026-06-12
 *   npm run audit:slate-visibility -- --json
 */
import { supabase } from "../../lib/db/supabase";

const SPORTS = ["mlb", "nba", "nhl", "soccer", "ucl"] as const;
type AuditSport = (typeof SPORTS)[number];

function etTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs(): { date: string; json: boolean } {
  const args = process.argv.slice(2);
  let date = etTodayDate();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--date" && args[i + 1]) {
      date = args[i + 1]!;
      i++;
    }
  }
  return { date, json };
}

type SportReport = {
  sport: AuditSport;
  games: number;
  draft_games: number;
  prediction_records: number;
  status: "ok" | "no_fixtures" | "HIGH_empty_slate" | "HIGH_unpublished_slate";
};

async function checkSport(sport: AuditSport, date: string): Promise<SportReport> {
  const { count: gameCount } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("slate_date", date);

  // MLB is the only sport that gates the user-facing Daily Edge response on
  // games.slate_status IN ('published', 'final'). Soccer / NBA / NHL don't
  // populate slate_status, so we only count draft games when the sport
  // actually uses the gate.
  let draftCount = 0;
  if (sport === "mlb") {
    const { count } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("sport", sport)
      .eq("slate_date", date)
      .eq("slate_status", "draft");
    draftCount = count ?? 0;
  }

  const { count: prCount } = await supabase
    .from("prediction_records")
    .select("id", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("slate_date", date);

  const games = gameCount ?? 0;
  const prs = prCount ?? 0;

  let status: SportReport["status"];
  if (games === 0) status = "no_fixtures";
  else if (prs === 0) status = "HIGH_empty_slate";
  else if (draftCount === games) status = "HIGH_unpublished_slate";
  else status = "ok";

  return { sport, games, draft_games: draftCount, prediction_records: prs, status };
}

async function main(): Promise<void> {
  const { date, json } = parseArgs();
  const reports: SportReport[] = [];
  for (const sport of SPORTS) {
    reports.push(await checkSport(sport, date));
  }

  const high = reports.filter(
    (r) => r.status === "HIGH_empty_slate" || r.status === "HIGH_unpublished_slate",
  );

  if (json) {
    console.log(JSON.stringify({ date, reports, high_count: high.length }, null, 2));
  } else {
    console.log(`Slate-visibility audit  date=${date}`);
    console.log(`──────────────────────────────────────────`);
    for (const r of reports) {
      const tag =
        r.status === "HIGH_empty_slate"
          ? "  HIGH (no prs)"
          : r.status === "HIGH_unpublished_slate"
            ? "  HIGH (draft)"
            : r.status === "no_fixtures"
              ? "  (none)"
              : "  OK";
      console.log(
        `  ${r.sport.padEnd(7)}  games=${String(r.games).padStart(3)}  draft=${String(r.draft_games).padStart(3)}  prs=${String(r.prediction_records).padStart(4)}  ${tag}`,
      );
    }
    if (high.length > 0) {
      console.log(`\n✗ HIGH: ${high.length} sport(s) have visibility issues`);
      for (const r of high) {
        if (r.status === "HIGH_empty_slate") {
          console.log(`  → ${r.sport}: ${r.games} games seeded, 0 prediction_records written`);
        } else if (r.status === "HIGH_unpublished_slate") {
          console.log(
            `  → ${r.sport}: ${r.games} games + ${r.prediction_records} prs, but all ${r.draft_games} games still slate_status='draft' (UI hides draft slates)`,
          );
        }
      }
    } else {
      console.log(`\nAll sports clean.`);
    }
  }

  process.exit(high.length > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
