import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflForwardMemberSnapshot } from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const season = numberArg("season", 2026);
  const configuredWeek = numberArg("week", 1);
  const week = resolveNflForwardWeek({ season, configuredWeek });
  const away = requiredArg("away").toUpperCase();
  const home = requiredArg("home").toUpperCase();
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const [published, evidence] = await Promise.all([
    readNflForwardMemberSnapshot({ client, season, week }),
    readNflForwardEvidence({ client, season, week }),
  ]);
  if (!published) throw new Error(`NFL ${season} Week ${week} published snapshot is unavailable.`);
  const game = published.fixture.snapshot.games.find((row) => row.awayTeam === away && row.homeTeam === home);
  if (!game) throw new Error(`${away}@${home} is absent from the published Week ${week} snapshot.`);
  const source = evidence
    .filter((row) => row.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .filter((row) => row.payload.game.away.abbreviation === away && row.payload.game.home.abbreviation === home)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];
  if (!source || source.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
    throw new Error(`${away}@${home} has no current-schema evidence.`);
  }
  console.log(JSON.stringify({
    readOnly: true,
    season,
    week,
    publishedAt: published.publishedAt,
    sourceCapturedAt: published.sourceCapturedAt,
    sourceChecksum: published.sourceChecksum,
    published: {
      gameStartAt: game.gameStartAt,
      lockState: game.lockState,
      projected: game.projected,
      footballProjection: game.footballProjection,
      predictions: game.predictions,
      markets: game.markets,
      recommendationDecision: game.recommendationDecision,
      holdReason: game.holdReason,
    },
    latestEvidence: {
      rowId: source.id,
      capturedAt: source.capturedAt,
      stage: source.stage,
      payloadStage: source.payload.stage,
      captureTiming: source.payload.captureTiming,
      t60LagMinutes: source.payload.t60LagMinutes,
      current: source.payload.market.current,
      currentBooks: source.payload.market.currentBooks,
      comparableCurrentBooks: source.payload.market.comparableCurrentBooks,
      operationalOpening: source.payload.market.operationalOpening,
      playbookLine: source.payload.market.playbookLine,
      playbookSplits: source.payload.market.playbookSplits,
      sharpApiSplits: source.payload.market.sharpApiSplits,
      outcomeForecast: source.payload.outcomeForecast,
      decisions: source.payload.decisions,
      startersAndDepth: source.payload.startersAndDepth,
      injuries: source.payload.injuries,
      weather: source.payload.weather,
      coverage: source.payload.coverage,
    },
  }, null, 2));
}

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;
}
function requiredArg(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}
function numberArg(name: string, fallback: number): number {
  const value = Number(argument(name) ?? fallback);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
  return value;
}
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
