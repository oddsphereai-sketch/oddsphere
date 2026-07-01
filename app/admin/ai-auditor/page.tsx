"use client";

import { useEffect, useState } from "react";

type Summary = {
  month_key: string;
  total_spend_usd: number;
  projected_spend_usd: number;
  calls_today: number;
  calls_month: number;
  cache_hits: number;
  cache_hit_rate: number;
  pass_count: number;
  warn_count: number;
  block_count: number;
  mini_escalation_count: number;
  spend_by_sport: Record<string, number>;
  spend_by_model: Record<string, number>;
  highest_cost_slates: Array<{ slate_date: string; spend_usd: number }>;
  highest_cost_games: Array<{ game_id: string; spend_usd: number }>;
  current_budget_mode: "NORMAL" | "CONSERVE" | "PROTECT" | "HARD_STOP";
};

type LedgerRow = {
  id: string;
  created_at: string;
  sport: string | null;
  slate_date: string | null;
  game_id: string | null;
  audit_scope: string | null;
  payload_hash: string | null;
  from_cache: boolean | null;
  skipped_reason: string | null;
  model: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  status: string | null;
  severity: string | null;
  recommended_actions: string[] | null;
  escalation: boolean | null;
  applied: boolean | null;
};

type ResponseBody = {
  summary: Summary;
  costPreview: {
    sport: string;
    from: string;
    to: string;
    gamesFound: number;
    gameCardPayloadsBuilt: number;
    auditOpportunities: {
      baseGameCards: number;
      refreshesRequested: number;
      hourlyAuditOpportunities: number;
      lockAudits: number;
      totalAuditOpportunities: number;
      note: string | null;
    };
    estimatedAiCalls: number;
    estimatedCacheSkips: number;
    estimatedNanoCalls: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedNanoCostUsd: number;
    escalationRouter: {
      enabled: boolean;
      estimatedMiniCalls: number;
      miniEscalationRate: number;
      maxMiniEscalationRate: number;
      exceedsConfiguredMax: boolean;
      triggersByCategory: Record<string, number>;
      estimatedMiniCostUsd: number;
      estimatedTotalCostWithRouterUsd: number;
      conservativeTotalCostWithRouterUsd: number;
    };
    costScenarios: {
      onePassCostUsd: number;
      hourlyRefreshWorstCaseCostUsd: number;
      hourlyPlusLockWorstCaseCostUsd: number;
      changedOnlyCacheAdjustedCostUsd: number;
      realisticChangedOnlyCostUsd: number;
      messy10PctMiniEscalationUsd: number;
      messy20PctMiniEscalationUsd: number;
      dailyBestCaseChangedOnlyUsd: number;
      dailyRealisticHourlyChangesUsd: number;
      dailyMessy10PctMiniEscalationUsd: number;
      dailyBadCaseNoCacheUsd: number;
    };
    conservativeCostScenarios: {
      multiplier: number;
      onePassCostUsd: number;
      hourlyRefreshWorstCaseCostUsd: number;
      hourlyPlusLockWorstCaseCostUsd: number;
      changedOnlyCacheAdjustedCostUsd: number;
      messy10PctMiniEscalationUsd: number;
      messy20PctMiniEscalationUsd: number;
      projectedMonthlyRealisticHourlyChangesUsd: number;
      projectedMonthlyBadCaseNoCacheUsd: number;
    };
    projectedMonthlyCostUsd: {
      bestCaseWithCacheSkips: number;
      realisticCaseFromHistoricalPayloads: number;
      realisticHourlyChangesOnMostCards: number;
      messyCase10PctMiniEscalation: number;
      worstCaseEveryHourlyRefresh: number;
      badCaseNoCacheHourlyPlusLock: number;
    };
    budgetModeByScenario: Record<string, string>;
    projectedPeakSlateCostUsd: Array<{
      label: string;
      assumedGameCards: number;
      refreshes: number;
      lockAudits: number;
      hourlyAuditOpportunities: number;
      totalAuditOpportunities: number;
      estimatedOnePassCostUsd: number;
      estimatedHourlyRefreshCostUsd: number;
      estimatedHourlyPlusLockCostUsd: number;
      estimatedMessy10PctMiniEscalationUsd: number;
      estimatedMessy20PctMiniEscalationUsd: number;
      conservativeHourlyPlusLockCostUsd: number;
      synthetic: boolean;
    }>;
    pricing: {
      nanoModel: string;
      miniModel: string;
      nanoInputUsdPerMillion: number;
      nanoOutputUsdPerMillion: number;
      miniInputUsdPerMillion: number;
      miniOutputUsdPerMillion: number;
      pricingMode: "standard" | "batch";
      conservativeMultiplier: number;
      source: string;
    };
  };
  activeSportsCostPreview: {
    sports: string[];
    estimatedNanoCostUsd: number;
    gameCardPayloadsBuilt: number;
    estimatedAiCalls: number;
    estimatedCacheSkips: number;
    projectedMonthEndRealisticUsd: number;
  };
  liveQc: {
    status: {
      enabled: boolean;
      guardedLiveQc: boolean;
      shadowMode: boolean;
      applySafeCopyFixes: boolean;
      applyGuardedDowngrades: boolean;
      allowUpgrades: boolean;
      allowPickFlips: boolean;
      allowProbabilityChanges: boolean;
      disableGpt55Live: boolean;
    };
    counters: {
      safeCopyFixesApplied: number;
      gradeDowngradesOrCapsApplied: number;
      blocks: number;
      recommendationsNotApplied: number;
    };
    recentAppliedFixes: Array<{
      created_at: string;
      sport: string | null;
      slate_date: string | null;
      game_id: string | null;
      audit_scope: string | null;
      model: string | null;
      actions: unknown;
      status: string | null;
    }>;
  };
  recent: LedgerRow[];
  caps: { soft: number; protect: number; hard: number };
};

function readSavedAdminCredentials(): { email: string; token: string; authed: boolean } {
  if (typeof window === "undefined") return { email: "", token: "", authed: false };
  try {
    const saved = window.localStorage.getItem("admin_credentials");
    if (!saved) return { email: "", token: "", authed: false };
    const parsed = JSON.parse(saved) as { email?: string; token?: string };
    return {
      email: parsed.email ?? "",
      token: parsed.token ?? "",
      authed: Boolean(parsed.email && parsed.token),
    };
  } catch {
    return { email: "", token: "", authed: false };
  }
}

function money(v: number | null | undefined): string {
  return `$${Number(v ?? 0).toFixed(2)}`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function Card({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div style={{ background: "#0f172a", border: `1px solid ${danger ? "#7f1d1d" : "#1e293b"}`, borderRadius: 8, padding: 14, color: "#e2e8f0" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 5 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

function Pairs({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  return (
    <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
      <h2 style={{ fontSize: 14, color: "#e2e8f0", marginBottom: 10 }}>{title}</h2>
      {entries.length === 0 ? <p style={{ color: "#64748b", fontSize: 13 }}>No spend recorded.</p> : null}
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #0f172a", padding: "7px 0", color: "#cbd5e1", fontSize: 13 }}>
          <span>{key}</span>
          <strong>{money(value)}</strong>
        </div>
      ))}
    </section>
  );
}

export default function AiAuditorAdminPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<ResponseBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = readSavedAdminCredentials();
    setEmail(saved.email);
    setToken(saved.token);
    setAuthed(saved.authed);
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetch("/api/admin/ai-auditor", { headers: { "x-admin-email": email, "x-admin-token": token } })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<ResponseBody>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [authed, email, token]);

  if (!authed) {
    return (
      <main style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Admin · AI Auditor</h1>
        <label style={{ display: "block", marginBottom: 12 }}>Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>Admin token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <button onClick={() => { localStorage.setItem("admin_credentials", JSON.stringify({ email, token })); setAuthed(true); }} style={{ padding: "8px 16px", background: "#000", color: "#fff", border: 0, borderRadius: 4 }}>Continue</button>
      </main>
    );
  }

  const summary = data?.summary;
  const hard = data?.caps.hard ?? 250;
  const escalationRate = summary && summary.calls_month > 0 ? summary.mini_escalation_count / summary.calls_month : 0;
  const blocked = data?.recent.filter((r) => r.status === "block") ?? [];
  const changed = data?.recent.filter((r) => r.applied === true || r.recommended_actions?.some((a) => a === "apply_copy_fixes" || a === "downgrade_grade")) ?? [];

  return (
    <main style={{ minHeight: "100vh", background: "#020617", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#f8fafc", fontSize: 26, margin: 0 }}>AI Auditor</h1>
          <p style={{ color: "#94a3b8", margin: "4px 0 0" }}>Spend ledger, budget mode, cache behavior, and recent audit outcomes.</p>
        </div>
        <button onClick={() => { localStorage.removeItem("admin_credentials"); setAuthed(false); }} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0" }}>Sign out</button>
      </div>
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
      {!summary ? <p style={{ color: "#94a3b8" }}>Loading…</p> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
            <Card label="Budget Mode" value={summary.current_budget_mode} danger={summary.current_budget_mode === "HARD_STOP"} />
            <Card label="Month Spend" value={money(summary.total_spend_usd)} sub={`${money(Math.max(0, hard - summary.total_spend_usd))} before hard cap`} danger={summary.total_spend_usd >= hard * 0.9} />
            <Card label="Projected" value={money(summary.projected_spend_usd)} sub={`Hard cap ${money(hard)}`} danger={summary.projected_spend_usd >= hard} />
            <Card label="Calls" value={`${summary.calls_today} / ${summary.calls_month}`} sub="today / month" />
            <Card label="Cache Skip Rate" value={pct(summary.cache_hit_rate)} sub={`${summary.cache_hits} cache hits`} />
            <Card label="Warn / Block" value={`${summary.warn_count} / ${summary.block_count}`} sub={`${summary.pass_count} pass`} />
            <Card label="Mini Escalation" value={pct(escalationRate)} danger={escalationRate > 0.15} />
          </div>
          {data?.liveQc ? (
            <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <h2 style={{ color: "#e2e8f0", fontSize: 14, margin: 0 }}>Guarded Live QC</h2>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: "4px 0 0" }}>
                    {data.liveQc.status.guardedLiveQc ? "Enabled" : "Disabled"} · safe copy {data.liveQc.status.applySafeCopyFixes ? "on" : "off"} · downgrades {data.liveQc.status.applyGuardedDowngrades ? "on" : "off"}
                  </p>
                </div>
                <div style={{ color: "#64748b", fontSize: 12 }}>
                  upgrades {data.liveQc.status.allowUpgrades ? "allowed" : "blocked"} · pick flips {data.liveQc.status.allowPickFlips ? "allowed" : "blocked"} · GPT-5.5 {data.liveQc.status.disableGpt55Live ? "disabled" : "not blocked"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                <Card label="Safe Copy Fixes" value={`${data.liveQc.counters.safeCopyFixesApplied}`} sub="applied in recent ledger rows" />
                <Card label="Downgrades / Caps" value={`${data.liveQc.counters.gradeDowngradesOrCapsApplied}`} sub="applied in recent ledger rows" />
                <Card label="Blocks" value={`${data.liveQc.counters.blocks}`} sub="coherence or safety blocks" />
                <Card label="Not Applied" value={`${data.liveQc.counters.recommendationsNotApplied}`} sub="recommendations held by guards" />
              </div>
              {data.liveQc.recentAppliedFixes.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: 12, margin: "12px 0 0" }}>No applied live QC fixes recorded yet.</p>
              ) : (
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
                  Recent applied fixes: {data.liveQc.recentAppliedFixes.map((row) => `${row.sport ?? "—"} ${row.game_id ?? "—"} ${String(row.actions ?? "—")}`).join(" · ")}
                </div>
              )}
            </section>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 18 }}>
            <Pairs title="Spend By Sport" rows={summary.spend_by_sport} />
            <Pairs title="Spend By Model" rows={summary.spend_by_model} />
          </div>
          {data?.costPreview ? (
            <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <h2 style={{ color: "#e2e8f0", fontSize: 14, margin: 0 }}>Cost Preview</h2>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: "4px 0 0" }}>
                    {data.costPreview.sport.toUpperCase()} · {data.costPreview.from} · no OpenAI calls
                  </p>
                </div>
                <div style={{ color: "#64748b", fontSize: 12 }}>
                  {data.costPreview.pricing.pricingMode} pricing · {data.costPreview.pricing.nanoModel} primary · {data.costPreview.pricing.miniModel} escalation
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
                <Card label="One-Pass Cost" value={money(data.costPreview.costScenarios.onePassCostUsd)} sub={`${data.costPreview.auditOpportunities.baseGameCards} cards`} />
                <Card label="Refresh Count" value={`${data.costPreview.auditOpportunities.refreshesRequested}`} sub={`${data.costPreview.auditOpportunities.hourlyAuditOpportunities} hourly opportunities`} />
                <Card label="Hourly Worst Case" value={money(data.costPreview.costScenarios.hourlyRefreshWorstCaseCostUsd)} sub={`${data.costPreview.auditOpportunities.hourlyAuditOpportunities} audits`} />
                <Card label="Hourly + Lock" value={money(data.costPreview.costScenarios.hourlyPlusLockWorstCaseCostUsd)} sub={`${data.costPreview.auditOpportunities.totalAuditOpportunities} total opportunities`} />
                <Card
                  label={`Conservative ${data.costPreview.conservativeCostScenarios.multiplier}x`}
                  value={money(data.costPreview.conservativeCostScenarios.hourlyPlusLockWorstCaseCostUsd)}
                  sub="hourly + lock buffer"
                />
                <Card label="Changed Only" value={money(data.costPreview.costScenarios.changedOnlyCacheAdjustedCostUsd)} sub={`${data.costPreview.estimatedCacheSkips} skipped by hash/cache`} />
                <Card
                  label="Mini Router"
                  value={`${data.costPreview.escalationRouter.estimatedMiniCalls}`}
                  sub={`${(data.costPreview.escalationRouter.miniEscalationRate * 100).toFixed(1)}% · max ${(data.costPreview.escalationRouter.maxMiniEscalationRate * 100).toFixed(1)}%`}
                  danger={data.costPreview.escalationRouter.exceedsConfiguredMax}
                />
                <Card
                  label="Router Total"
                  value={money(data.costPreview.escalationRouter.estimatedTotalCostWithRouterUsd)}
                  sub={`${data.costPreview.pricing.nanoModel} + mini second opinion`}
                />
                <Card
                  label="Active Sports"
                  value={money(data.activeSportsCostPreview?.estimatedNanoCostUsd ?? 0)}
                  sub={`${data.activeSportsCostPreview?.gameCardPayloadsBuilt ?? 0} cards · ${(data.activeSportsCostPreview?.sports ?? []).map((s) => s.toUpperCase()).join(", ")}`}
                />
                <Card label="Expected Calls" value={`${data.costPreview.estimatedAiCalls}`} sub="after cache/change assumptions" />
                <Card label="Tokens" value={`${data.costPreview.estimatedInputTokens}`} sub={`${data.costPreview.estimatedOutputTokens} output est.`} />
                <Card label="Month-End Realistic" value={money(data.costPreview.projectedMonthlyCostUsd.realisticHourlyChangesOnMostCards)} sub={data.costPreview.budgetModeByScenario.realisticHourlyChangesOnMostCards ?? "NORMAL"} />
                <Card label="Messy Month" value={money(data.costPreview.projectedMonthlyCostUsd.messyCase10PctMiniEscalation)} sub={data.costPreview.budgetModeByScenario.messyCase10PctMiniEscalation ?? "NORMAL"} />
                <Card label="Bad Case Month" value={money(data.costPreview.projectedMonthlyCostUsd.badCaseNoCacheHourlyPlusLock)} sub={data.costPreview.budgetModeByScenario.badCaseNoCacheHourlyPlusLock ?? "NORMAL"} />
                <Card label="Conservative Month" value={money(data.costPreview.conservativeCostScenarios.projectedMonthlyBadCaseNoCacheUsd)} sub={`${data.costPreview.conservativeCostScenarios.multiplier}x bad case`} />
              </div>
              {data.costPreview.auditOpportunities.note ? (
                <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 10px" }}>{data.costPreview.auditOpportunities.note}</p>
              ) : null}
              <div style={{ color: "#94a3b8", fontSize: 12 }}>
                Peak checks: {data.costPreview.projectedPeakSlateCostUsd.map((row) => `${row.label}${row.synthetic ? " synthetic" : ""}: ${row.totalAuditOpportunities} ops ${money(row.estimatedHourlyPlusLockCostUsd)}`).join(" · ")}
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
                Mini triggers: {Object.entries(data.costPreview.escalationRouter.triggersByCategory).map(([key, value]) => `${key} ${value}`).join(" · ")}
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>
                Pricing: {data.costPreview.pricing.nanoModel} ${data.costPreview.pricing.nanoInputUsdPerMillion}/1M input · ${data.costPreview.pricing.nanoOutputUsdPerMillion}/1M output; {data.costPreview.pricing.miniModel} ${data.costPreview.pricing.miniInputUsdPerMillion}/1M input · ${data.costPreview.pricing.miniOutputUsdPerMillion}/1M output.
              </div>
            </section>
          ) : null}
          <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 18 }}>
            <h2 style={{ color: "#e2e8f0", fontSize: 14 }}>Recent Blocked / Changed Cards</h2>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>{blocked.length} blocked · {changed.length} changed or recommended for safe fixes/downgrades</p>
          </section>
          <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
            <h2 style={{ color: "#e2e8f0", fontSize: 14 }}>Recent Audit History</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", color: "#cbd5e1", fontSize: 12 }}>
                <thead><tr style={{ color: "#94a3b8" }}><th align="left">Time</th><th align="left">Game</th><th align="left">Scope</th><th align="left">Model</th><th align="right">Cost</th><th align="left">Status</th><th align="left">Actions</th></tr></thead>
                <tbody>
                  {(data?.recent ?? []).map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #1e293b" }}>
                      <td style={{ padding: 7 }}>{new Date(r.created_at).toLocaleString()}</td>
                      <td style={{ padding: 7 }}>{r.sport ?? "—"} · {r.slate_date ?? "—"} · {r.game_id ?? "—"}</td>
                      <td style={{ padding: 7 }}>{r.audit_scope ?? "—"}</td>
                      <td style={{ padding: 7 }}>{r.model ?? (r.skipped_reason ?? "—")}</td>
                      <td style={{ padding: 7, textAlign: "right" }}>{money(Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0))}</td>
                      <td style={{ padding: 7 }}>{r.status ?? "skipped"}{r.escalation ? " · escalation" : ""}</td>
                      <td style={{ padding: 7 }}>{r.recommended_actions?.join(", ") ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
