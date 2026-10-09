#!/usr/bin/env tsx

/** SELECT-only audit for the current Florida State-Louisville lifecycle. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { buildCfbMemberFixture } from "../../lib/services/football/cfbMemberFixture";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client
    .from("cfb_forward_evidence_snapshots")
    .select("id,provider_game_id,stage,captured_at,game_start_at,evidence_release,payload")
    .eq("season", 2026)
    .gte("game_start_at", "2026-10-09T00:00:00.000Z")
    .lt("game_start_at", "2026-10-11T00:00:00.000Z")
    .order("captured_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((row) => {
    const game = (row.payload as { game?: { away?: { name?: string; abbreviation?: string }; home?: { name?: string; abbreviation?: string } } })?.game;
    const identities = [game?.away?.name, game?.away?.abbreviation, game?.home?.name, game?.home?.abbreviation]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toUpperCase());
    return identities.some((value) => ["FLORIDA STATE", "LOUISVILLE", "FSU", "LOU"].includes(value));
  }).map((row) => {
    const payload = row.payload as {
      memberRelease?: string;
      slateGameCount?: number;
      game?: { away?: { name?: string; abbreviation?: string }; home?: { name?: string; abbreviation?: string } };
      decisions?: { publicationEnabled?: boolean; trackingEnabled?: boolean; evaluatedBets?: unknown[]; heldMarkets?: unknown[] };
    };
    return {
      id: row.id,
      providerGameId: row.provider_game_id,
      stage: row.stage,
      capturedAt: row.captured_at,
      gameStartAt: row.game_start_at,
      evidenceRelease: row.evidence_release,
      memberRelease: payload.memberRelease,
      slateGameCount: payload.slateGameCount,
      matchup: `${payload.game?.away?.abbreviation ?? payload.game?.away?.name}@${payload.game?.home?.abbreviation ?? payload.game?.home?.name}`,
      publicationEnabled: payload.decisions?.publicationEnabled,
      trackingEnabled: payload.decisions?.trackingEnabled,
      evaluated: payload.decisions?.evaluatedBets?.length,
      held: payload.decisions?.heldMarkets?.length,
    };
  });
  const now = new Date().toISOString();
  const evidence = await readCfbForwardEvidence({ client, season: 2026 });
  const rebuilt = buildCfbMemberFixture(evidence, now);
  const rebuiltFocus = rebuilt.snapshot.games.filter((game) =>
    `${game.awayTeam}@${game.homeTeam}` === "FSU@LOU"
  ).map((game) => ({
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    startsAt: game.gameStartAt,
    lockState: game.lockState,
    projected: game.projected,
  }));
  const rebuiltStartedGames = rebuilt.snapshot.games.filter((game) =>
    typeof game.gameStartAt === "string" && Date.parse(game.gameStartAt) <= Date.parse(now)
  ).map((game) => ({
    gameId: game.id,
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    startsAt: game.gameStartAt,
    lockState: game.lockState,
    lockedAt: game.lockedAt,
  }));
  console.log(JSON.stringify({ now, rawEvidence: rows, rebuiltFocus, rebuiltStartedGames, rebuiltGames: rebuilt.snapshot.games.length }, null, 2));
}

void main();
