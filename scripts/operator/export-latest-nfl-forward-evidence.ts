/**
 * Read-only export of the latest authoritative NFL r2 forward evidence row per
 * game. This is an offline model-audit bridge, not a prediction writer.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";

const EXPORT_RELEASE = "nfl_forward_evidence_latest_readonly_export_2026_08_22_r1";

function integerArg(name: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
  return value;
}

function latestByGame(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(row.providerGameId, row);
    }
  }
  return [...latest.values()].sort((a, b) =>
    a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart)
    || a.providerGameId.localeCompare(b.providerGameId));
}

type CurrentStoredEvidence = Omit<NflForwardStoredEvidence, "payload"> & {
  payload: NflForwardEvidencePayload;
};

function currentEvidence(row: NflForwardStoredEvidence): CurrentStoredEvidence {
  if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
    throw new Error(`Unexpected evidence release for ${row.providerGameId}.`);
  }
  return row as CurrentStoredEvidence;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");
  const season = integerArg("season", 2026);
  const week = integerArg("week", 1);
  const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? "football-research/reports/nfl_forward_evidence_r2_latest.local.json";
  const output = path.resolve(process.cwd(), outputArg);
  const allowedRoot = path.resolve(process.cwd(), "football-research/reports");
  if (output !== allowedRoot && !output.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error("--output must remain inside football-research/reports.");
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season, week });
  const latest = latestByGame(stored).map(currentEvidence);
  if (week === 1 && latest.length !== 16) {
    throw new Error(`Expected 16 latest Week 1 evidence rows; received ${latest.length}.`);
  }
  for (const row of latest) {
    if (row.payload.market.comparableCurrentBooks.length < 2) {
      throw new Error(`Comparable multi-book evidence is incomplete for ${row.providerGameId}.`);
    }
    if (
      row.payload.decisions.evaluatedBets.length > 0
      || row.payload.decisions.outcomeConfidence.length > 0
      || row.payload.decisions.publicationEnabled
      || row.payload.decisions.trackingEnabled
    ) {
      throw new Error(`Evidence row ${row.id} violates the no-decision export boundary.`);
    }
  }

  const payload = {
    exportRelease: EXPORT_RELEASE,
    evidenceRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    exportedAt: new Date().toISOString(),
    readOnly: true,
    season,
    week,
    storedRowsRead: stored.length,
    latestRows: latest.map((row) => ({
      id: row.id,
      payloadSha256: row.payloadSha256,
      payload: row.payload,
    })),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    exportRelease: EXPORT_RELEASE,
    evidenceRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    readOnly: true,
    season,
    week,
    storedRowsRead: stored.length,
    latestGames: latest.length,
    capturedAtMin: latest.map((row) => row.capturedAt).sort().at(0) ?? null,
    capturedAtMax: latest.map((row) => row.capturedAt).sort().at(-1) ?? null,
    comparableBooksMin: Math.min(...latest.map((row) => row.payload.market.comparableCurrentBooks.length)),
    projectedQuarterbacks: latest.reduce((sum, row) => sum
      + Number(row.payload.startersAndDepth.away.starterStatus === "projected")
      + Number(row.payload.startersAndDepth.home.starterStatus === "projected"), 0),
    confirmedQuarterbacks: latest.reduce((sum, row) => sum
      + Number(row.payload.startersAndDepth.away.starterStatus === "confirmed")
      + Number(row.payload.startersAndDepth.home.starterStatus === "confirmed"), 0),
    output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
