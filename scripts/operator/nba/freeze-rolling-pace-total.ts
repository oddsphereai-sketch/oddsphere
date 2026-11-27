import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
const [input, fitPath, output] = process.argv.slice(2);
if (!input || !fitPath || !output || fs.existsSync(output)) throw Error("usage: freeze-rolling-pace-total INPUT FIT NEW_HEAD");
const bytes = fs.readFileSync(input), source = JSON.parse(gunzipSync(bytes).toString()), fitBytes = fs.readFileSync(fitPath), fit = JSON.parse(fitBytes.toString());
if (fit.release !== "nba_rolling_regulation_pace_total_2026_11_27_r1_prior_seasons" || fit.alpha !== 1000 ||
    fit.inputSha256 !== createHash("sha256").update(bytes).digest("hex") || fit.featureRelease !== source.featureRelease ||
    fit.candidateMarginFitted !== false || fit.models.length !== 3 || fit.models.map((m: { origin: number }) => m.origin).join() !== "2023,2024,2025") throw Error("rolling_fit_contract");
for (const m of fit.models) {
  const first = source.rows.filter((r: { season: number }) => r.season === m.origin).map((r: { cutoff: string }) => r.cutoff).sort()[0];
  const train = source.rows.filter((r: { season: number; finalAvailableAt: string }) => r.season >= 2021 && r.season < m.origin && Date.parse(r.finalAvailableAt) < Date.parse(first))
    .sort((a: { gameId: string }, b: { gameId: string }) => a.gameId.localeCompare(b.gameId));
  if (m.firstEvaluation !== first || m.trainingRows !== train.length || m.trainingIdsHash !== nbaPlayerStateHash(train.map((r: { gameId: string }) => r.gameId)) ||
      Date.parse(m.trainingEnd) >= Date.parse(first) || (m.origin === 2023 && m.firstOriginFrozenMaxDifference > 1e-9)) throw Error("rolling_training_integrity");
  for (const view of [m.legacy, m.candidateTotal]) {
    const d = view.design;
    if (d.features.length !== 75 || new Set(d.features).size !== 75 || d.designColumns > 150 || d.splineKnots.length ||
        d.designMeans.length !== d.designColumns || !d.designMeans.every(Number.isFinite) ||
        d.designStandardDeviations.length !== d.designColumns || !d.designStandardDeviations.every((n: number) => Number.isFinite(n) && n > 0) ||
        view.total.length !== d.designColumns + 1 || !view.total.every(Number.isFinite)) throw Error("rolling_head_dimension");
  }
}
const core = { release: fit.release, featureRelease: fit.featureRelease, alpha: fit.alpha, models: fit.models,
  rawFitSha256: createHash("sha256").update(fitBytes).digest("hex") };
const result = { frozenAt: new Date().toISOString(), inputSha256: fit.inputSha256, head: { ...core, hash: nbaPlayerStateHash(core) },
  fittingPerformed: false, developmentRead: false };
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ frozenAt: result.frozenAt, headHash: result.head.hash, origins: fit.models.map((m: { origin: number; trainingRows: number }) => ({ origin: m.origin, trainingRows: m.trainingRows })) }));
