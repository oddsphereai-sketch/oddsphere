/** Local outcome scoring only. It cannot fetch data, generate forecasts or alter locked records. */
import { readFileSync, writeFileSync } from "node:fs";
import { digest, invariant } from "./core";
import { scoreProspective, type ProbabilityProposal, type SettledOutcome } from "./probability-proposals";
const [manifestFile, out] = process.argv.slice(2);
invariant(out?.startsWith("/private/tmp/"), "NEW private score output required");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { forecastFiles: string[]; outcomeFile?: string };
invariant(manifest.forecastFiles.length > 0 && new Set(manifest.forecastFiles).size === manifest.forecastFiles.length, "Missing/duplicate source files");
const sources = manifest.forecastFiles.map(file => { const value = JSON.parse(readFileSync(file, "utf8")); return { file, value, digest: digest(value) }; });
const forecasts = sources.flatMap(s => s.value.proposals as ProbabilityProposal[]);
const outcomes = manifest.outcomeFile ? JSON.parse(readFileSync(manifest.outcomeFile, "utf8")) as SettledOutcome[] : [];
const scored = scoreProspective(forecasts, outcomes);
const rows = scored.rows.filter(r => r.scored);
const groups = [...new Set(rows.map(r => r.group))].map(group => {
  const values = rows.filter(r => r.group === group), paired = values.filter(r => r.baselineBrier !== null);
  const mean = (v: number[]) => v.length ? v.reduce((n, x) => n + x, 0) / v.length : null;
  return { group, scored: values.length, games: new Set(values.map(r => r.gameId)).size,
    candidateBrier: mean(values.map(r => r.candidateBrier)), candidateLogLoss: mean(values.map(r => r.candidateLogLoss)),
    paired: paired.length, pairedCandidateBrier: mean(paired.map(r => r.candidateBrier)), pairedBaselineBrier: mean(paired.map(r => r.baselineBrier!)) };
});
const report = { generatedAt: new Date().toISOString(), scope: "raw uncalibrated hypotheses, including retained failed-review games; never production qualification",
  sources: sources.map(s => ({ file: s.file, digest: s.digest, qualityGate: s.value.qualityGate ?? "see original receipt qualityError; presence alone does not mean accepted" })),
  proposals: forecasts.length, ...scored, groups };
writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ out, proposals: forecasts.length, pending: scored.pending, excluded: scored.excluded, scored: rows.length, candidateQualified: false }));
