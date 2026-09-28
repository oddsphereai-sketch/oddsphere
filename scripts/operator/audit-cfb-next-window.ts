#!/usr/bin/env tsx

/** SELECT-only audit of the CFB weekly rollover planner. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { determineCfbForwardCollectionNeed } from "../../lib/services/football/cfbForwardEvidence";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  activeCfbWeeklyWindow,
  isGameInCfbWeeklyWindow,
  nextCfbWeeklyWindow,
  resolveCfbForwardWindow,
  resolveCfbVisibleWindows,
} from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { evidence } = await readCfbForwardWriterEvidence({ client, season: 2026 });
  const active = activeCfbWeeklyWindow(now);
  const next = nextCfbWeeklyWindow(active);
  const primary = resolveCfbForwardWindow({ now, evidence });
  const visible = resolveCfbVisibleWindows({ now, evidence });
  const summarize = (window: typeof active) => {
    const rows = evidence.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
    const games = new Set(rows.map((row) => row.providerGameId));
    const openings = new Set(rows.filter((row) => row.stage === "opening").map((row) => row.providerGameId));
    const expected = rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.payload.slateGameCount));
    return {
      start: window.boardStartDate,
      end: window.boardEndDate,
      rows: rows.length,
      games: games.size,
      openings: openings.size,
      expected,
      need: determineCfbForwardCollectionNeed({ existing: rows, now }),
      latestCapture: rows.map((row) => row.capturedAt).sort().at(-1) ?? null,
      futureGames: new Set(rows.filter((row) => Date.parse(row.gameStartAt) > Date.parse(now)).map((row) => row.providerGameId)).size,
    };
  };
  console.log(JSON.stringify({
    audit: "cfb_next_window_select_audit_2026_09_28_r1",
    readOnly: true,
    writes: 0,
    now,
    active: summarize(active),
    next: summarize(next),
    primary: { start: primary.boardStartDate, end: primary.boardEndDate },
    visible: visible.map((window) => ({ start: window.boardStartDate, end: window.boardEndDate })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
