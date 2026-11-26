/** Stream immutable C2 originals into a six-feature C6 experiment. No fitting/IO to services. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createGunzip, gunzipSync, gzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { qualifyNbaTwoWayRotation, NBA_TWO_WAY_SCHEMA_HASH, type NbaTwoWayRotationSnapshot } from "../../../lib/research/nba/nbaTwoWayRotation";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";

async function main() {
  const [ledgerPath, proofPath, originalInputs, oldReportPath, output] = process.argv.slice(2);
  if (!ledgerPath || !proofPath || !originalInputs || !oldReportPath || !output || fs.existsSync(output)) {
    throw Error("usage: prepare-scaled-player-impact C2_LEDGER PROOF ORIGINAL_INPUTS C2_REPORT NEW_OUTPUT.gz");
  }
  const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p), { maxOutputLength: 32_000_000 }).toString());
  const source = read(originalInputs), old = read(oldReportPath), proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const ledgerHash = createHash("sha256");
  for await (const chunk of fs.createReadStream(ledgerPath)) ledgerHash.update(chunk);
  const ledgerFileSha256 = ledgerHash.digest("hex");
  if (proof.ledgerFileSha256 !== ledgerFileSha256 || proof.schemaHash !== NBA_TWO_WAY_SCHEMA_HASH ||
      !Object.values(old.inputHashes).includes(ledgerFileSha256) || !proof.sourcesVerified || proof.mutationCases < 50 ||
      !Object.values(old.inputHashes).includes(source.originalFeaturesSha256) || !old.qualification.mayFit ||
      source.baseline.hash !== old.baselineA2.hash) throw Error("changed_original_source_contract");
  for (const b of [old.baselineA1, old.baselineA2]) {
    const { hash, ...core } = b;
    if (nbaPlayerStateHash(core) !== hash) throw Error("changed_original_baseline");
  }
  type Original = { gameId: string; season: number; startAt: string; cutoff: string; finalAvailableAt: string;
    sourceSha256: string; features: Record<string, number | null>; actualMargin: number; actualTotal: number };
  const originals = source.rows as Original[], byId = new Map(originals.map(r => [r.gameId, r]));
  const previous = new Map<string, { snapshotHash: string; baselineMargin: number; baselineTotal: number;
    actualMargin: number; actualTotal: number }>(old.evaluations.filter((r: { season: number }) => r.season >= 2023 && r.season <= 2025).map((r: { gameId: string }) => [r.gameId, r]));
  const hashes: string[] = [], ids = new Set<string>(), rows = [];
  let header = false, complete = 0, changes = 0, unknown = 0, matched = 0;
  for await (const line of createInterface({ input: fs.createReadStream(ledgerPath).pipe(createGunzip()), crlfDelay: Infinity })) {
    if (line.length > 4_000_000) throw Error("ledger_row_budget");
    if (!header) { if (JSON.parse(line).encoding !== "nba_two_way_ledger_jsonl_r1") throw Error("ledger_encoding"); header = true; continue; }
    const r = JSON.parse(line) as NbaTwoWayRotationSnapshot;
    const { hash, ...core } = r;
    if (hash !== nbaPlayerStateHash(core) || hashes.length >= 10000 || ids.has(r.target.gameId)) throw Error("ledger_integrity");
    hashes.push(hash); ids.add(r.target.gameId);
    const issues = qualifyNbaTwoWayRotation([r]).issues.filter(x => !["two_way_selection_below_1000", "two_way_changes_below_300", "two_way_frozen_proof_missing"].includes(x));
    if (issues.length) throw Error("invalid_original_player_source:" + issues.join(","));
    if (r.status !== "complete") { unknown++; continue; }
    if ([2023, 2024].includes(r.target.season)) { complete++; if (r.teams.some(t => t.verifiedChange)) changes++; }
    const o = byId.get(r.target.gameId);
    if (!o || o.season < 2022 || o.season > 2025) continue;
    if (o.season !== r.target.season || Date.parse(o.cutoff) !== Date.parse(r.target.cutoff) || Date.parse(o.startAt) !== Date.parse(r.target.startAt)) throw Error("source_cutoff_mismatch");
    const b = o.season === 2022 ? old.baselineA1 : old.baselineA2;
    if (Date.parse(b.trainingEnd) >= Date.parse(o.cutoff) || Date.parse(o.finalAvailableAt) <= Date.parse(o.startAt)) throw Error("source_training_boundary");
    const p = scoreNbaPortableModel(b.artifact, o.features), prior = previous.get(o.gameId);
    if (o.season >= 2023) {
      if (!prior || prior.snapshotHash !== hash || Math.abs(p.marginHome - prior.baselineMargin) > 1e-9 ||
          Math.abs(p.total - prior.baselineTotal) > 1e-9 || o.actualMargin !== prior.actualMargin || o.actualTotal !== prior.actualTotal) {
        throw Error("changed_original_comparison_cohort:" + o.gameId);
      }
      matched++;
    }
    if (o.season === 2022 && Date.parse(o.finalAvailableAt) >= Date.parse(source.firstEvaluation)) continue;
    rows.push({ gameId: o.gameId, season: o.season, startAt: o.startAt, cutoff: o.cutoff,
      finalAvailableAt: o.finalAvailableAt, sourceSha256: o.sourceSha256, snapshotHash: hash,
      sourceSchemaHash: NBA_TWO_WAY_SCHEMA_HASH, baselineHash: b.hash,
      features: r.features, baselineMargin: p.marginHome, baselineTotal: p.total,
      actualMargin: o.actualMargin, actualTotal: o.actualTotal });
  }
  if (!header || nbaPlayerStateHash(hashes.sort()) !== proof.ledgerHash || complete !== old.qualification.selectionComplete ||
      changes !== old.qualification.selectionChanges || matched !== previous.size ||
      rows.filter(r => r.season === 2022).length !== old.head.trainingRows) throw Error("incomplete_original_cohort:" + JSON.stringify({
        header, ledgerHashMatches: nbaPlayerStateHash(hashes) === proof.ledgerHash,
        complete, expectedComplete: old.qualification.selectionComplete, changes, expectedChanges: old.qualification.selectionChanges,
        matched, expectedMatched: previous.size, training: rows.filter(r => r.season === 2022).length, expectedTraining: old.head.trainingRows }));
  rows.sort((a, b) => a.gameId.localeCompare(b.gameId));
  const training = rows.filter(r => r.season === 2022);
  const outputData = { contract: "nba_scaled_player_impact_inputs_r1", createdAt: new Date().toISOString(),
    firstEvaluation: source.firstEvaluation, trainingRows: training.length,
    trainingHash: nbaPlayerStateHash(training), trainingEnd: training.map(r => r.finalAvailableAt).sort().at(-1),
    sourceSchemaHash: NBA_TWO_WAY_SCHEMA_HASH, ledgerHash: proof.ledgerHash,
    trainingBaselineHash: old.baselineA1.hash, evaluationBaselineHash: old.baselineA2.hash,
    selectionComplete: complete, selectionChanges: changes, unknownLedgerRows: unknown,
    unchangedC2ComparisonRows: matched, deferredCurrentSeasonRows: old.evaluations.filter((r: { season: number }) => r.season === 2026).length, rows,
    inputHashes: { ledger: ledgerFileSha256, ...Object.fromEntries([proofPath, originalInputs, oldReportPath].map(p => [p, createHash("sha256").update(fs.readFileSync(p)).digest("hex")])) },
    productionWrites: 0, providerRequests: 0, fittingPerformed: false };
  fs.writeFileSync(output, gzipSync(JSON.stringify(outputData)), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ...outputData, rows: undefined }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
