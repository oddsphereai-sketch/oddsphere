/** Current numerical score path vs original locked-input forecasts, no DB/HTTP. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGunzip, gunzipSync, gzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { canonicalNbaAbbreviation } from "../../../lib/services/nba/espnNbaInjuries";
import { NBA_MODEL_RELEASE } from "../../../lib/automodel/nba/nbaChampionRuntime";
import { NBA_PROFESSIONAL_MODEL_ARTIFACT } from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import { verifyNbaOriginalTeamGame } from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import { NBA_TWO_WAY_SCHEMA_HASH, type NbaTwoWayRotationSnapshot } from "../../../lib/research/nba/nbaTwoWayRotation";
import { compareNbaScaledImpactWithSavedIncumbent, nbaImpactDirectionAtSavedLine } from "../../../lib/research/nba/nbaScaledImpactIncumbentComparison";
import type { NbaScaledImpactHead } from "../../../lib/research/nba/nbaScaledPlayerImpact";

async function main() {
  const [ledger, originalArchive, savedArchive, frozenPath, inputPath, output] = process.argv.slice(2);
  if (!ledger || !originalArchive || !savedArchive || !frozenPath || !inputPath || !output || fs.existsSync(output)) {
    throw Error("usage: compare-scaled-impact-with-incumbent LEDGER NATIVE_ARCHIVE SAVED_ARCHIVE HEAD INPUTS NEW_REPORT.gz");
  }
  const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p), { maxOutputLength: 32_000_000 }).toString());
  const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8")), head = frozen.head as NbaScaledImpactHead;
  const inputBytes = fs.readFileSync(inputPath), inputs = JSON.parse(gunzipSync(inputBytes).toString());
  if (frozen.inputSha256 !== createHash("sha256").update(inputBytes).digest("hex")) throw Error("changed_frozen_impact_input");
  const ledgerSha = createHash("sha256"); for await (const chunk of fs.createReadStream(ledger)) ledgerSha.update(chunk);
  if (ledgerSha.digest("hex") !== inputs.inputHashes.ledger) throw Error("changed_original_player_ledger");
  const savedFile = path.join(savedArchive, "frozen-replay-inputs.json.gz"), saved = read(savedFile);
  type Refusal = { nativeGameId: string; reason: string; externalId?: number; playerCutoff?: string; savedAsOf?: string };
  type Compared = ReturnType<typeof compareNbaScaledImpactWithSavedIncumbent> & { nativeGameId: string; externalId: number;
    date: string; originalModelRelease: string; originalLockedAt: string; originalAsOf: string; impactCutoff: string;
    actualMargin: number; actualTotal: number; originalFinal: { margin: number; total: number };
    originalContracts: { recordId: number; market: "moneyline" | "spread" | "total"; side: string; line: number | null; price: number }[] };
  const before = nbaPlayerStateHash(saved), census = [], refusals: Refusal[] = [], compared: Compared[] = [];
  const snapshotSourceHashes: Record<string, string> = {}, nativeIdentitySourceHashes: Record<string, { gzipSha256: string; decodedSha256: string; receiptSha256: string }> = {};
  // This diagnostic proves the *current* numerical artifact reproduces each
  // actual saved raw forecast before replacing the roster component.
  for (const row of saved.rows) {
    if (census.length >= 128) throw Error("saved_census_budget");
    const record = row.lockedRecords.find((r: { market: string }) => r.market === "total");
    if (!record || !record.locked_at || row.lockedRecords.length !== 3) throw Error("incomplete_saved_lock_cohort");
    const snapshotPath = path.join("locks", record.id + ".json.gz"), snapshotBytes = fs.readFileSync(path.join(savedArchive, snapshotPath));
    snapshotSourceHashes[snapshotPath] = createHash("sha256").update(snapshotBytes).digest("hex");
    const snapshot = JSON.parse(gunzipSync(snapshotBytes, { maxOutputLength: 8_000_000 }).toString()), game = snapshot.nba_game_dto_at_capture;
    const audit = snapshot.nba_grounding_audit, raw = scoreNbaPortableModel(NBA_PROFESSIONAL_MODEL_ARTIFACT, row.stats);
    const old = { margin: audit.roster_regime?.selected === false ? 0 : audit.roster_regime?.marginCorrection ?? 0,
      total: audit.roster_regime?.selected === false ? 0 : audit.roster_regime?.totalCorrection ?? 0 };
    const independent = { margin: audit.independent_projection.margin_home, total: audit.independent_projection.total };
    if (!row.featureParity || row.asOf !== snapshot.as_of || Math.abs(raw.marginHome + old.margin - independent.margin) > 1e-8 ||
        Math.abs(raw.total + old.total - independent.total) > 1e-8 || row.model !== record.model_version ||
        row.lockedRecords.some((r: { model_version: string }) => r.model_version !== row.model)) throw Error("current_code_incumbent_parity_failed");
    census.push({ row, record, snapshot, game, raw, old, independent,
      key: `${Date.parse(game.tip_iso_utc)}:${canonicalNbaAbbreviation(game.home_abbr)}:${canonicalNbaAbbreviation(game.away_abbr)}` });
  }
  if (new Set(census.map(c => c.key)).size !== census.length) throw Error("ambiguous_saved_fixture");
  let header = false, currentComplete = 0;
  for await (const line of createInterface({ input: fs.createReadStream(ledger).pipe(createGunzip()), crlfDelay: Infinity })) {
    if (!header) { header = true; if (JSON.parse(line).encoding !== "nba_two_way_ledger_jsonl_r1") throw Error("ledger_encoding"); continue; }
    const s = JSON.parse(line) as NbaTwoWayRotationSnapshot;
    if (s.target.season !== 2026 || s.status !== "complete") continue;
    currentComplete++;
    const { hash, ...core } = s;
    if (hash !== nbaPlayerStateHash(core) || !s.features) throw Error("changed_current_impact_snapshot");
    const stem = path.join(originalArchive, "native", s.target.gameId + "-boxscore");
    const nativeBytes = fs.readFileSync(stem + ".json.gz"), receiptBytes = fs.readFileSync(stem + ".receipt.json");
    const official = verifyNbaOriginalTeamGame({ gameId: s.target.gameId, season: 2026,
      bytes: gunzipSync(nativeBytes), receipt: JSON.parse(receiptBytes.toString()) });
    nativeIdentitySourceHashes[s.target.gameId] = { gzipSha256: createHash("sha256").update(nativeBytes).digest("hex"),
      decodedSha256: official.receipt.sha256, receiptSha256: createHash("sha256").update(receiptBytes).digest("hex") };
    const g = official.game;
    if (g.homeTeamId !== s.target.homeTeamId || g.awayTeamId !== s.target.awayTeamId || Date.parse(g.startTime) !== Date.parse(s.target.startAt)) throw Error("native_fixture_identity_mismatch");
    // Postgame source contributes stable fixture identity/corroborated result
    // only. No target player/count/rotation field enters a forecast.
    const key = `${Date.parse(g.startTime)}:${canonicalNbaAbbreviation(g.homeTeam)}:${canonicalNbaAbbreviation(g.awayTeam)}`;
    const c = census.find(r => r.key === key);
    if (!c) { refusals.push({ nativeGameId: s.target.gameId, reason: "no_exact_original_saved_fixture" }); continue; }
    if (Date.parse(s.target.cutoff) > Date.parse(c.snapshot.as_of)) {
      refusals.push({ nativeGameId: s.target.gameId, externalId: c.row.game, reason: "original_player_cutoff_after_saved_model_asof",
        playerCutoff: s.target.cutoff, savedAsOf: c.snapshot.as_of }); continue;
    }
    const grade = c.record.grades;
    if (grade.actual_home_score !== g.homeScore || grade.actual_away_score !== g.awayScore) throw Error("conflicting_original_final");
    const result = compareNbaScaledImpactWithSavedIncumbent({ head, input: { features: s.features, snapshotHash: s.hash,
      sourceSchemaHash: NBA_TWO_WAY_SCHEMA_HASH, cutoff: s.target.cutoff, season: 2026 }, savedAsOf: c.snapshot.as_of,
      raw: c.raw, savedIndependent: c.independent, oldRosterCorrection: c.old });
    compared.push({ nativeGameId: s.target.gameId, externalId: c.row.game, date: c.row.date, originalModelRelease: c.row.model,
      originalLockedAt: c.record.locked_at, originalAsOf: c.snapshot.as_of, impactCutoff: s.target.cutoff,
      actualMargin: g.homeScore - g.awayScore, actualTotal: g.homeScore + g.awayScore, ...result,
      originalFinal: { margin: c.game.projection.spread_home, total: c.game.projection.total },
      originalContracts: c.row.lockedRecords.map((r: { market: "moneyline" | "spread" | "total"; side: string; line_value: number | null; odds_american: number; id: number }) =>
        ({ recordId: r.id, market: r.market, side: r.side, line: r.line_value, price: r.odds_american })) });
  }
  if (currentComplete !== inputs.deferredCurrentSeasonRows || nbaPlayerStateHash(saved) !== before) throw Error("current_cohort_or_original_mutation");
  type E = typeof compared[number];
  const mean = (a: number[]) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
  function metrics(a: E[], arm: "incumbent" | "candidate" | "originalFinal") {
    return { games: a.length, marginMAE: mean(a.map(r => Math.abs(r[arm].margin - r.actualMargin))),
      totalMAE: mean(a.map(r => Math.abs(r[arm].total - r.actualTotal))),
      teamMAE: mean(a.map(r => Math.max(Math.abs(r[arm].margin - r.actualMargin), Math.abs(r[arm].total - r.actualTotal)) / 2)),
      winnerCorrect: a.filter(r => (r[arm].margin > 0) === (r.actualMargin > 0)).length };
  }
  function directions(a: E[], arm: "incumbent" | "candidate") {
    return Object.fromEntries((["moneyline", "spread", "total"] as const).map(market => {
      const results = a.map(r => {
        const contract = r.originalContracts.find(c => c.market === market);
        if (!contract) throw Error("missing_original_direction_line");
        return nbaImpactDirectionAtSavedLine({ ...r[arm], market, storedSide: contract.side, selectedLine: contract.line,
          actualMargin: r.actualMargin, actualTotal: r.actualTotal });
      });
      return [market, { wins: results.filter(r => r.result === "win").length, losses: results.filter(r => r.result === "loss").length,
        pushes: results.filter(r => r.result === "push").length, pricedWagers: false }];
    }));
  }
  const byOriginalRelease = Object.fromEntries([...new Set(compared.map(r => r.originalModelRelease))].map(release => {
    const rows = compared.filter(r => r.originalModelRelease === release);
    return [release, { originalLockedTimes: rows.map(r => r.originalLockedAt).sort(),
      incumbentIndependent: metrics(rows, "incumbent"), replacementIndependent: metrics(rows, "candidate"), originalPublishedFinal: metrics(rows, "originalFinal"),
      independentDirectionsAtOriginalLines: { incumbent: directions(rows, "incumbent"), replacement: directions(rows, "candidate") } }];
  }));
  const report = { createdAt: new Date().toISOString(), currentCodeRelease: NBA_MODEL_RELEASE, headHash: head.hash,
    currentArtifactRelease: NBA_PROFESSIONAL_MODEL_ARTIFACT.release, currentFeatureRelease: NBA_PROFESSIONAL_MODEL_ARTIFACT.featureRelease,
    currentArtifactHash: nbaPlayerStateHash(NBA_PROFESSIONAL_MODEL_ARTIFACT),
    currentNumericalIncumbentParityGames: census.length, sourceComplete2026Games: currentComplete, comparedGames: compared.length,
    byOriginalRelease, refusals, rows: compared, originalsHashBefore: before, originalsHashAfter: nbaPlayerStateHash(saved),
    inputHashes: { savedInputs: createHash("sha256").update(fs.readFileSync(savedFile)).digest("hex"), impactInputs: frozen.inputSha256 },
    snapshotSourceHashes, nativeIdentitySourceHashes,
    qualifications: ["Retrospective opened2026 source-bound point-stage comparison; not fresh forward forecasts or an isolated full market-reader wager replay.",
      "Actual original R36/R38 labels and locked times remain authoritative; current R39 numerical parity is separately proven, never a release relabel.",
      "Old roster corrections are replaced, not added twice. Candidate probabilities/grades/ROI and actionables are unqualified; original quotes are retained only.",
      "Unknown or post-asof player evidence is withheld from this offline comparison only; no live card or grade is withheld.",
      "Historical C6 development/replication failure cannot be rescued by a current-season diagnostic."],
    productionPromotionEligible: false, fittingPerformed: false, providerRequests: 0, productionWrites: 0 };
  fs.writeFileSync(output, gzipSync(JSON.stringify(report)), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(output + ".summary.json", JSON.stringify({ ...report, rows: undefined, refusals: undefined,
    refusalCounts: Object.fromEntries([...new Set(refusals.map(r => r.reason))].map(reason => [reason, refusals.filter(r => r.reason === reason).length])) }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ...report, rows: undefined, refusals: undefined }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
