import fs from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildNbaPlayerStateSnapshot, qualifyNbaPlayerStateLedger, type NbaPlayerStateObservation, type NbaPlayerStateTarget } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { nbaPlayerStateStatsFromRetainedEvidence } from "../../../lib/research/nba/nbaPlayerStateStatEvidence";

type Bundle = { observations: unknown[]; bodies: [string, unknown][]; targets: NbaPlayerStateTarget[];
  stateObservations: NbaPlayerStateObservation[]; historicalCoverage: { season: number; games: number; sourceAvailableAt: string }[] };
/** Explicit local frozen bundle only. No DB, provider, scheduler or model fitting. */
export function auditNbaPlayerStateReadiness(bundle: Bundle) {
  const bodies = new Map(bundle.bodies);
  const rows = bundle.targets.map(target => buildNbaPlayerStateSnapshot({ target,
    observations: [...nbaPlayerStateStatsFromRetainedEvidence({ cutoff: target.cutoff, targetGameId: target.gameId,
      observations: bundle.observations, bodies }), ...bundle.stateObservations] }));
  const qualification = qualifyNbaPlayerStateLedger(rows);
  return { rows, report: { ...qualification, targets: rows.length,
    complete: rows.filter(r => r.status === "complete").length,
    unknownReasons: rows.flatMap(r => r.teams.filter(t => t.status === "unknown").map(t => ({ gameId: r.target.gameId, teamId: t.teamId, reasons: t.reasons }))),
    inputFamilies: { statBodies: bodies.size, statReferences: bundle.observations.length,
      effectiveRosters: bundle.stateObservations.filter(o => o.kind === "roster").length,
      exactGameAvailability: bundle.stateObservations.filter(o => o.kind === "availability").length },
    historicalCacheCoverageOnly: bundle.historicalCoverage, providerRequests: 0, productionWrites: 0,
    caveat: "Later-collected historical caches do not establish original cutoff availability; no outcome fitting or live model changes." } };
}
if (process.argv[1]?.endsWith("audit-nba-player-state-readiness.ts")) {
  const [input, output] = process.argv.slice(2); if (!input || !output) throw Error("Usage: audit-nba-player-state-readiness.ts frozen-bundle.json.gz new-output-directory");
  const bundle = JSON.parse(gunzipSync(fs.readFileSync(input)).toString()) as Bundle;
  if (!bundle.targets.length || bundle.targets.length > 20_000 || bundle.observations.length > 200_000) throw Error("invalid_bundle_budget");
  const { rows, report } = auditNbaPlayerStateReadiness(bundle);
  fs.mkdirSync(output, { recursive: false });
  fs.writeFileSync(`${output}/cutoff-snapshots.json.gz`, gzipSync(JSON.stringify(rows)), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${output}/readiness.json`, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report));
}
