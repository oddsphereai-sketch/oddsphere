/**
 * Ops dashboard (LOCAL TOOL) — editable content.
 *
 * This file is the hand-maintained half of your private local Ops dashboard.
 * It is NOT part of the OddSphere app and is never deployed — it only runs when
 * you start the local server (`npm run ops`).
 *
 * HOW TO UPDATE: edit the arrays below and refresh the page. Keep dated entries
 * newest-first. Add freely — this is your notebook for the whole project.
 */

export type RuleStatus = "live" | "partial" | "experimental" | "off";
export type ModelRule = { sport: string; market: string; name: string; what: string; status: RuleStatus; since?: string; evidence?: string };
export type TodoStatus = "todo" | "in_progress" | "blocked" | "done";
export type Todo = { title: string; detail: string; status: TodoStatus; priority: "P0" | "P1" | "P2"; area: string };
export type ChangeEntry = { date: string; title: string; detail: string; refs?: string };

export const MODEL_RULES: ModelRule[] = [
  { sport: "MLB", market: "Moneyline", name: "Inverted-cohort flip", status: "live", since: "2026-06-22",
    what: "Low-conviction (final conf 55–60), raw <60, market-divergent picks are faded to the opposite side at the real opposite-book price. These were a losing cohort.",
    evidence: "in-sample 12-28 (-17.9u) → 28-12 (+21.5u) on the 40-game cohort; least-validated of the flips (no OOS test)" },
  { sport: "MLB", market: "Totals", name: "Probability-driven side + mean-side flip", status: "live", since: "2026-06-22",
    what: "O/U side follows P(over) vs P(under). When the right-skewed Poisson puts the probability side against the projected mean, flip to the projected-mean side.",
    evidence: "divergent picks ~4-12 baseline; flip-to-mean +13.4u in-sample" },
  { sport: "MLB", market: "Totals", name: "Bet-line basis + no-bend reconciliation", status: "live", since: "2026-06-22",
    what: "Final total pick, line_value, grade, tracking resolve against the line the MEMBER BETS (trusted-book line), not internal market_total. Displayed projection is the raw score sum — never bent.",
    evidence: "isolated +2.7u → +7.6u over 2 weeks" },
  { sport: "MLB", market: "Totals", name: "Reliever-as-starter OU dampening", status: "live", since: "2026-06-22",
    what: "When the starter resolver falls back to a reliever (rp_as_sp), dampen OU confidence too (was ML-only). A reliever's ERA under-projects a full-game total.",
    evidence: "PHI@WSH 2026-06-22 incident; interim — deeper projection fix still owed" },
  { sport: "MLB", market: "First-inning", name: "NRFI→YRFI overconfident mid-band flip", status: "live", since: "2026-06-22",
    what: "Confident NRFI picks with NRFI prob in [0.57,0.63) are an inverted cohort; fade to YRFI at the real YRFI price. Low/high NRFI conviction left alone.",
    evidence: "in-sample +3.5u → +27.8u; held out-of-sample in a chronological split (~60% retention)" },
  { sport: "MLB", market: "All", name: "Probability-space regularization + BA market-sanity gates", status: "live", since: "2026-06-13",
    what: "Regularize probabilities toward the market in probability space; Best-Angle requires market sanity (totals tightened, line-move confirmation).", evidence: "ff8eda2" },
  { sport: "Soccer/WC", market: "All", name: "Soccer-native model, market-led blend 0.65", status: "live", since: "2026-06-13",
    what: "DC derived from 1X2, BTTS market-grounded, match-result follows projected scoreline (draws on even projections, group-stage). Blend market-led 0.65. Value-Leans only." },
  { sport: "NHL", market: "Totals", name: "Total line coherence + probability-driven side", status: "partial", since: "2026-06-15",
    what: "One consensus total line across snapshot/pick/card/edge. O/U side from P(over)/P(under).", evidence: "prob side still has a fake-prob path to finish" },
  { sport: "NBA", market: "Totals", name: "Probability-driven totals", status: "live",
    what: "O/U side already from P(over)/P(under) (NBA was correct pre-fix)." },
  { sport: "All", market: "Integrity", name: "Integrity contract + slate-health auditor", status: "live", since: "2026-06-14",
    what: "Every sport has its own integrity gate; HIGH = slate blocked ('trusted' or 'blocked', never silent). Universal slate-health auditor. fliff + kalshi blocklisted platform-wide." },
  { sport: "All", market: "Refresh", name: "Hourly refresh + freshness contract", status: "live", since: "2026-06-13",
    what: "All sports refresh hourly; 'freshest available over unavailable, always' (held+edge=null ⇒ preserve last-known)." },
];

export const TODOS: Todo[] = [
  { title: "Forward-validation checkpoint per slate", status: "in_progress", priority: "P0", area: "validation",
    detail: "Run scripts/forward-validation-checkpoint.ts after each graded slate: flip record+units, bet-line-dependent picks, old-side counterfactual, CLV, cases where a correction hurt. Read-only; we decide from it." },
  { title: "Deeper starter-resolution / reliever→starter ERA fix", status: "todo", priority: "P1", area: "mlb-model",
    detail: "rp_as_sp OU dampening is interim — it lowers confidence but doesn't fix the projection (still uses reliever's ERA). Real fix: harden starter resolution / adjust reliever ERA when spot-starting." },
  { title: "Circuit-breaker for underperforming flip rules", status: "todo", priority: "P2", area: "validation",
    detail: "Optional: auto-disable a flip rule if it runs >X units down over N forward bets. Needs a non-noisy threshold. NOT built — manual review for now." },
  { title: "Decision: should No Plays count in the public overall W/L?", status: "todo", priority: "P2", area: "tracking",
    detail: "no_bet rows are graded internally but excluded from the public W/L tally (trackingAggregateService.ts:353-355). Making them count in overall is a one-spot change — pending product call." },
  { title: "NBA / NHL tracking bridge to prediction_grades", status: "todo", priority: "P1", area: "tracking",
    detail: "Public tracker reads legacy prediction_results (MLB-only); soccer bridged in route; NBA/NHL still unbridged." },
  { title: "WC calibration roadmap (historical Platt scaling)", status: "todo", priority: "P2", area: "soccer-model",
    detail: "Historical 1998-2022 WC dataset → retroactive runs → per-market Platt scaling → reliability diagrams → promote to historical_platt_v1." },
];

export const CHANGELOG: ChangeEntry[] = [
  { date: "2026-06-22", title: "Calibration corrections + bet-line basis → prod", refs: "8d29068, 57ac073, 81bc632 → prod 20a58ae",
    detail: "ML inverted-cohort flip, totals mean-side flip, FI NRFI→YRFI flip, bet-line-basis totals + no-bend reconciliation, OU reliever-as-starter dampening. Smoke passed; promoted to prod." },
  { date: "2026-06-16", title: "WS streaming foundation + DB saturation recovery",
    detail: "SharpAPI WebSocket market-intel built (gated off). DB outage from unbounded line_history/odds_events bloat — durable fixes + recovery runbook." },
  { date: "2026-06-15", title: "MLB research sprint + flip-corrections research",
    detail: "Built validated replay harness + faithful grade replay. Identified Poisson-skew totals, favorite-Lean EV gap, mid-band overconfidence." },
  { date: "2026-06-14", title: "Slate-health auditor + WC grading launch",
    detail: "Universal cross-sport slate-health auditor (dry-run 0 errors on prod). WC grading philosophy launched; WC official tracking started." },
  { date: "2026-06-13", title: "MLB P0 regularization + morning publish fix + WC blend",
    detail: "Probability-space regularization + BA market-sanity gates (ff8eda2). Fixed sparse-EV slate-wide publish block (284adf4). WC odds contamination fixed; blend market-led 0.65." },
  { date: "2026-06-10", title: "Site-wide reliability audit commissioned",
    detail: "No more band-aids — comprehensive Daily Edge audit across every sport/layer/cron/label. NBA/NHL integrity gaps flagged." },
  { date: "2026-06-06", title: "Tracking foundation + Weekly/Monthly tabs",
    detail: "Modern tracking (prediction_records → prediction_grades). Weekly/Monthly/Lifetime toggle." },
];

export const PRINCIPLES: string[] = [
  "Caution is only for wrong-side / miscalibration — never an 'agree-but-no-value' bucket.",
  "Never present stale-vs-blocked-vs-fake as product choices — default to FIX THE PIPELINE.",
  "fliff + kalshi are blocklisted platform-wide (corrupted/flipped lines).",
  "Nothing is live until verified on the prod URL (www.oddsphereai.com).",
  "Every row writes + grades internally; public filters apply at read time only.",
  "Fix the model, not the game — no per-game patches for systematic issues.",
];
