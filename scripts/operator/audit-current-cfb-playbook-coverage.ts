#!/usr/bin/env tsx

/** Bounded read-only audit of Playbook line/split matching across the current CFB slate. */

import { loadEnvConfig } from "@next/env";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import {
  normalizeCfbPlaybookLine,
  normalizeCfbPlaybookSplits,
  resolveCfbPlaybookRow,
} from "../../lib/services/football/cfbPlaybookEvidence";
import { fetchBalldontlieNcaafSlate } from "../../lib/services/football/balldontlieNcaafSlate";
import { activeCfbWeeklyWindow, eligibleCfbWeeklyGames } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const playbookApiKey = process.env.PLAYBOOK_API_KEY;
  if (!balldontlieApiKey || !playbookApiKey) {
    throw new Error("BALLDONTLIE_API_KEY and PLAYBOOK_API_KEY are required.");
  }

  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const window = activeCfbWeeklyWindow(now);
  const slate = await fetchBalldontlieNcaafSlate({
    season: 2026,
    startDate: window.providerQueryStartDate,
    endDate: window.providerQueryEndDate,
    apiKey: balldontlieApiKey,
  });
  const games = eligibleCfbWeeklyGames(slate.games, window);
  const playbook = new PlaybookClient(playbookApiKey);
  const [linesResult, splitsResult] = await Promise.all([
    playbook.lines("ncaaf"),
    playbook.splits("ncaaf"),
  ]);
  const lineRows = linesResult.body.data ?? [];
  const splitRows = splitsResult.body.data ?? [];
  const rows = games.map((game) => {
    const lineRow = resolveCfbPlaybookRow(game, lineRows);
    const splitRow = resolveCfbPlaybookRow(game, splitRows);
    const line = lineRow ? normalizeCfbPlaybookLine(lineRow, now) : null;
    const splits = splitRow ? normalizeCfbPlaybookSplits(splitRow, now) : null;
    return {
      providerGameId: game.providerGameId,
      matchup: `${game.away.abbreviation}@${game.home.abbreviation}`,
      startsAt: game.scheduledStart,
      scope: line !== null ? "provider_covered" : "provider_uncovered",
      matchedLine: line !== null,
      matchedSplits: splits !== null,
      completeMoneyline: line?.awayMoneyline !== null && line?.awayMoneyline !== undefined && line.homeMoneyline !== null,
      completeSpread: line?.awaySpread !== null && line?.awaySpread !== undefined && line.homeSpread !== null,
      completeTotal: line?.total !== null && line?.total !== undefined,
    };
  });
  const missing = rows.filter((row) => !row.completeMoneyline || !row.completeSpread || !row.completeTotal);
  const count = (values: typeof rows, key: (value: (typeof rows)[number]) => string) => values.reduce<Record<string, number>>((result, value) => {
    const name = key(value);
    result[name] = (result[name] ?? 0) + 1;
    return result;
  }, {});

  console.log(JSON.stringify({
    release: "cfb_playbook_current_slate_coverage_select_audit_2026_10_06_r1",
    readOnly: true,
    writes: 0,
    now,
    requests: { balldontlie: slate.providerRequests, playbook: 2 },
    games: rows.length,
    coverage: {
      matchedLine: rows.filter((row) => row.matchedLine).length,
      matchedSplits: rows.filter((row) => row.matchedSplits).length,
      completeMoneyline: rows.filter((row) => row.completeMoneyline).length,
      completeSpread: rows.filter((row) => row.completeSpread).length,
      completeTotal: rows.filter((row) => row.completeTotal).length,
    },
    missingByScope: count(missing, (row) => row.scope),
    missing,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
