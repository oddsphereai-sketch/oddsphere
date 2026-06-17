/**
 * READ-ONLY — STEP A: baseline-match validation gate for the offline re-run.
 * Re-runs production prob logic from frozen v2_2_audit inputs using the REAL
 * model functions and checks it reproduces stored ml_model_prob/ou_model_prob.
 * Also checks NB(r->large) -> Poisson limit. No writes. If this doesn't match,
 * the harness foundation is wrong and candidates cannot be trusted.
 */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson, overProbabilityPoisson, poissonPmf } from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";

const START = "2026-06-07";
const K_ML = 0.6, K_OU = 0.5, MAXD_ML = 10.0, MAXD_OU = 9.0;

// --- Negative-binomial with mean mu, dispersion r (size). r->inf = Poisson. ---
function logGamma(z: number): number { // Lanczos
  const g = 7; const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function nbPmf(k: number, mu: number, r: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (!isFinite(r) || r > 1e6) return poissonPmf(k, mu); // Poisson limit
  if (mu <= 0) return k === 0 ? 1 : 0;
  const p = r / (r + mu); // P(success); mean = r(1-p)/p = mu
  const logP = logGamma(k + r) - logGamma(r) - logGamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logP);
}
function nbCdf(k: number, mu: number, r: number): number { let s = 0; for (let i = 0; i <= k; i++) s += nbPmf(i, mu, r); return Math.min(1, s); }
function overProbNB(muHome: number, muAway: number, line: number, r: number): number {
  const mu = Math.max(0, muHome) + Math.max(0, muAway); if (mu <= 0) return 0;
  const floor = Number.isInteger(line) ? line : Math.floor(line);
  return 1 - nbCdf(floor, mu, r);
}
function homeWinNB(muHome: number, muAway: number, r: number): number {
  if (muHome <= 0 && muAway <= 0) return 0.5; if (muHome <= 0) return 0; if (muAway <= 0) return 1;
  const MAXR = 20; const ph: number[] = [], pa: number[] = [];
  for (let i = 0; i <= MAXR; i++) { ph.push(nbPmf(i, muHome, r)); pa.push(nbPmf(i, muAway, r)); }
  let pH = 0, pA = 0, pT = 0;
  for (let h = 0; h <= MAXR; h++) for (let a = 0; a <= MAXR; a++) { const j = ph[h] * pa[a]; if (h > a) pH += j; else if (a > h) pA += j; else pT += j; }
  pH += pT * (muHome / (muHome + muAway)); pA += pT * (muAway / (muHome + muAway));
  return pH / (pH + pA);
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, side, model_probability, model_version, line_value, launch_day, no_bet, snapshot_json")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);

  type Stat = { n: number; match: number; errs: number[] };
  const stats: Record<string, Stat> = {};
  const bump = (key: string, err: number) => { const s = (stats[key] ??= { n: 0, match: 0, errs: [] }); s.n++; s.errs.push(err); if (err < 0.005) s.match++; };
  let nbLimitMaxErr = 0;
  const versions = new Set<string>();

  for (const r of rows as any[]) {
    const a = r.snapshot_json?.v2_2_audit ?? {};
    versions.add(String(r.model_version ?? a.model_version ?? "unknown"));
    const post613 = r.slate_date >= "2026-06-13";
    const hasReg = a.ml_raw_model_prob != null || a.ou_raw_model_prob != null;
    if (r.market === "moneyline") {
      if (a.posterior_home_runs == null || a.posterior_away_runs == null || a.ml_model_prob == null) continue;
      const homeProb = homeWinProbabilityPoisson(a.posterior_home_runs, a.posterior_away_runs);
      const rawPick = homeProb >= 0.5 ? homeProb : 1 - homeProb;
      const reg = regularizeProbability({ rawProb: rawPick, marketProb: a.ml_market_prob ?? null, k: K_ML, maxDistancePp: MAXD_ML });
      const errReg = Math.abs((reg.regularizedProb ?? rawPick) - a.ml_model_prob);
      const errRaw = Math.abs(rawPick - a.ml_model_prob); // pre-regularization hypothesis
      bump("ML all (reg)", errReg); bump(post613 ? "ML >=6/13 (reg)" : "ML <6/13 (reg)", errReg);
      bump("ML all (raw)", errRaw); bump(post613 ? "ML >=6/13 (raw)" : "ML <6/13 (raw)", errRaw);
      bump(hasReg ? "ML hasRawField (reg)" : "ML noRawField (raw)", hasReg ? errReg : errRaw);
      nbLimitMaxErr = Math.max(nbLimitMaxErr, Math.abs(homeWinNB(a.posterior_home_runs, a.posterior_away_runs, 1e9) - homeProb));
    } else if (r.market === "total") {
      if (a.posterior_home_runs == null || a.posterior_away_runs == null || a.ou_model_prob == null) continue;
      const line = a.market_total ?? r.line_value ?? a.posterior_total; if (line == null) continue;
      const overProb = overProbabilityPoisson(a.posterior_away_runs, a.posterior_home_runs, line);
      const rawPick = overProb >= 0.5 ? overProb : 1 - overProb;
      const reg = regularizeProbability({ rawProb: rawPick, marketProb: a.ou_market_prob ?? null, k: K_OU, maxDistancePp: MAXD_OU });
      const errReg = Math.abs((reg.regularizedProb ?? rawPick) - a.ou_model_prob);
      const errRaw = Math.abs(rawPick - a.ou_model_prob);
      bump("OU all (reg)", errReg); bump(post613 ? "OU >=6/13 (reg)" : "OU <6/13 (reg)", errReg);
      bump("OU all (raw)", errRaw); bump(post613 ? "OU >=6/13 (raw)" : "OU <6/13 (raw)", errRaw);
      bump(hasReg ? "OU hasRawField (reg)" : "OU noRawField (raw)", hasReg ? errReg : errRaw);
      nbLimitMaxErr = Math.max(nbLimitMaxErr, Math.abs(overProbNB(a.posterior_away_runs, a.posterior_home_runs, line, 1e9) - overProb));
    }
  }
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  console.log("=== BASELINE-MATCH VALIDATION (replay vs stored; match=|err|<0.005) ===");
  console.log(`model_versions seen: ${[...versions].join(", ")}`);
  console.log(`NB(r=1e9)->Poisson limit maxErr=${nbLimitMaxErr.toFixed(6)} (should be ~0)\n`);
  for (const k of Object.keys(stats)) { const s = stats[k]; console.log(`  ${k.padEnd(26)} n=${String(s.n).padEnd(4)} match=${(100 * s.match / s.n).toFixed(0).padStart(3)}%  meanErr=${mean(s.errs).toFixed(4)}`); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
