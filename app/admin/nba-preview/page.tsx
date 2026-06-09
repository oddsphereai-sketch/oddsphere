"use client";

/**
 * Phase 7A — NBA Finals v0a — admin-only internal preview.
 *
 * /admin/nba-preview
 *
 * Mirrors the auth gate of /admin/auto-predictions (localStorage email +
 * admin token). Reads from /api/admin/nba-preview, renders a raw grid:
 * one row per game/market with audit fields visible.
 *
 * INTERNAL ONLY — banner emphasizes provisional + not-member-facing.
 */

import { useCallback, useEffect, useState } from "react";

type NbaInjuryStatus =
  | "out"
  | "questionable"
  | "probable"
  | "available"
  | "unknown";

type NbaPlayerInjury = {
  player_id: number | null;
  name: string;
  status: NbaInjuryStatus;
};

type NbaTeamSnapshot = {
  team_external_id: number;
  abbreviation: string;
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  recent_form_10g_net_rating: number | null;
};

type NbaSeriesContext = {
  game_number: number;
  series_score_home: number;
  series_score_away: number;
  home_team_leads_series_by: number;
  is_elimination_for_home: boolean;
  is_elimination_for_away: boolean;
  days_rest_home: number | null;
  days_rest_away: number | null;
  venue_shift: boolean;
};

type NbaMarketSnapshot = {
  ml: { home_odds_american: number | null; away_odds_american: number | null };
  spread: {
    home_line: number | null;
    home_odds_american: number | null;
    away_odds_american: number | null;
  };
  total: {
    line: number | null;
    over_odds_american: number | null;
    under_odds_american: number | null;
  };
};

type NbaDataQuality = {
  ratings_present: boolean;
  home_injuries_known: boolean;
  away_injuries_known: boolean;
  market_present: boolean;
  series_context_derived: boolean;
};

type NbaGameSnapshot = {
  game_external_id: number;
  slate_date: string;
  game_time_iso: string | null;
  home_team: NbaTeamSnapshot;
  away_team: NbaTeamSnapshot;
  home_injuries: NbaPlayerInjury[];
  away_injuries: NbaPlayerInjury[];
  series: NbaSeriesContext | null;
  market: NbaMarketSnapshot;
  data_quality: NbaDataQuality;
};

type NbaAutoModelAudit = {
  independent_home_score: number;
  independent_away_score: number;
  independent_home_sd: number;
  independent_away_sd: number;
  market_total: number | null;
  market_spread_home: number | null;
  market_home_ml_no_vig: number | null;
  market_away_ml_no_vig: number | null;
  market_baseline_valid: boolean;
  posterior_home_score: number;
  posterior_away_score: number;
  posterior_total: number;
  posterior_spread_home: number;
  trust_independent: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  confidence_ceiling: number;
  injury_unknown_count_home: number;
  injury_unknown_count_away: number;
  injury_out_count_home: number;
  injury_out_count_away: number;
  ml_pick: "home" | "away";
  ml_confidence: number;
  ml_best_angle_eligible: boolean;
  spread_pick: "home" | "away";
  spread_confidence: number;
  total_pick: "over" | "under";
  total_confidence: number;
  series_game_number: number | null;
  series_score_home: number | null;
  series_score_away: number | null;
  series_closeout_pressure: boolean;
  series_venue_shift: boolean;
  model_integrity_notes: string[];
  provisional: boolean;
};

type NbaAutoModelOutput = {
  game_external_id: number;
  prediction_source: "auto_v0_nba_internal";
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_spread_home: number;
  predicted_ml_winner: "home" | "away";
  ml_confidence: number;
  predicted_spread_side: "home" | "away";
  spread_confidence: number;
  predicted_total_side: "over" | "under";
  total_confidence: number;
  stage: "morning_draft" | "t60_locked";
  provisional: boolean;
  audit: NbaAutoModelAudit;
};

type AdminGameEntry = {
  game_external_id: number;
  matchup: string;
  away_abbr: string;
  home_abbr: string;
  game_time_iso: string | null;
  snapshot: NbaGameSnapshot;
  prediction: NbaAutoModelOutput;
};

type ApiResponse = {
  as_of: string;
  sport: "nba";
  slate_date: string;
  provisional: true;
  notice: string;
  injury_ingest_enabled: boolean;
  totals: {
    games_count: number;
    tier_high: number;
    tier_medium: number;
    tier_low: number;
    tier_fallback: number;
  };
  games: AdminGameEntry[];
};

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function AdminNbaPreviewPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_credentials");
      if (saved) {
        const parsed = JSON.parse(saved) as { email: string; token: string };
        setEmail(parsed.email);
        setToken(parsed.token);
        setAuthed(true);
        return;
      }
    } catch {
      // ignore
    }
    // ─── TEMPORARY PREVIEW-BRANCH AUTH BYPASS ─────────────────────
    //
    // !!!  MUST BE REMOVED BEFORE MERGING nba-v0a -> main  !!!
    //
    // Mirrors the server-side bypass in
    // app/api/admin/nba-preview/route.ts. When the page is being
    // viewed on the Vercel preview deployment of the `nba-v0a`
    // branch, skip the login form so the operator can review Game 3
    // without locating their admin token. The API request still
    // succeeds because the server-side bypass returns data without
    // headers when VERCEL_GIT_COMMIT_REF === "nba-v0a".
    //
    // Production hostnames (oddsphereai.com, www.oddsphereai.com)
    // never match this pattern.
    if (
      typeof window !== "undefined" &&
      window.location.hostname.includes("git-nba-v0a")
    ) {
      setAuthed(true);
      // Empty credentials are fine — the server-side bypass on this
      // preview branch returns data without checking headers.
      return;
    }
  }, []);

  async function handleAuth() {
    setAuthError(null);
    const res = await fetch(`/api/admin/nba-preview?date=${todayET()}`, {
      headers: { "x-admin-email": email, "x-admin-token": token },
    });
    if (res.ok) {
      localStorage.setItem(
        "admin_credentials",
        JSON.stringify({ email, token }),
      );
      setAuthed(true);
    } else {
      const body = await res.text();
      setAuthError(`Auth failed (${res.status}): ${body}`);
    }
  }

  if (!authed) {
    return (
      <main
        style={{
          maxWidth: 480,
          margin: "80px auto",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>
          Admin · NBA Preview (v0a)
        </h1>
        <p style={{ color: "#7c2d12", fontSize: 13, marginBottom: 18 }}>
          INTERNAL ONLY — provisional NBA model output. Not member-facing.
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: 8,
              marginTop: 4,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{
              width: "100%",
              padding: 8,
              marginTop: 4,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <button
          onClick={handleAuth}
          style={{
            padding: "8px 16px",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Continue
        </button>
        {authError && (
          <p style={{ color: "#b00", marginTop: 16, fontSize: 14 }}>
            {authError}
          </p>
        )}
      </main>
    );
  }

  return (
    <NbaPreviewView
      email={email}
      token={token}
      onSignOut={() => {
        localStorage.removeItem("admin_credentials");
        setAuthed(false);
        setEmail("");
        setToken("");
      }}
    />
  );
}

function NbaPreviewView({
  email,
  token,
  onSignOut,
}: {
  email: string;
  token: string;
  onSignOut: () => void;
}) {
  const [date, setDate] = useState(todayET());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/nba-preview?date=${date}`, {
        headers: { "x-admin-email": email, "x-admin-token": token },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Fetch failed (${res.status}): ${await res.text()}`);
      }
      const body = (await res.json()) as ApiResponse;
      setData(body);
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date, email, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main
      style={{
        maxWidth: 1280,
        margin: "24px auto",
        padding: 20,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          background: "#fef2f2",
          border: "2px solid #b91c1c",
          color: "#7f1d1d",
          borderRadius: 6,
          marginBottom: 18,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        INTERNAL PREVIEW — NBA v0 — PROVISIONAL, NOT MEMBER-FACING
      </div>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Admin · NBA Preview (v0a)</h1>
        <button
          onClick={onSignOut}
          style={{
            padding: "6px 12px",
            background: "#fff",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Sign out
        </button>
      </header>

      <p style={{ color: "#666", margin: "0 0 14px", fontSize: 13 }}>
        Raw model output for NBA games. Confidence ceilings + thresholds
        are v0 placeholders — recalibrate once we have settled results.
        ESPN injuries fetched on every load; players with status
        &quot;unknown&quot; cap confidence + block Best Angle.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <label style={{ fontSize: 13 }}>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              marginLeft: 6,
              padding: 6,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <button
          onClick={reload}
          disabled={loading}
          style={{
            padding: "6px 14px",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: loading ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {loading ? "Loading…" : "Reload"}
        </button>
        {data && (
          <span style={{ color: "#999", fontSize: 12, marginLeft: "auto" }}>
            as of {new Date(data.as_of).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 4,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {data && (
        <>
          <SummaryStrip data={data} />
          <GamesGrid
            data={data}
            expanded={expanded}
            onToggle={toggleExpand}
          />
        </>
      )}
    </main>
  );
}

function SummaryStrip({ data }: { data: ApiResponse }) {
  const t = data.totals;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 8,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          padding: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <strong>{t.games_count}</strong> game(s) ·
        {" "}tier high={t.tier_high} ·
        medium={t.tier_medium} ·
        low={t.tier_low} ·
        fallback={t.tier_fallback}
        {" — injury ingest: "}
        <code>{data.injury_ingest_enabled ? "enabled" : "disabled"}</code>
      </div>
    </div>
  );
}

function GamesGrid({
  data,
  expanded,
  onToggle,
}: {
  data: ApiResponse;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  if (data.games.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#666",
          background: "#f9fafb",
          border: "1px dashed #d1d5db",
          borderRadius: 6,
        }}
      >
        No NBA games on the slate for {data.slate_date}.
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            <Th>Game</Th>
            <Th>Matchup</Th>
            <Th>Series</Th>
            <Th>Tier</Th>
            <Th>Posterior</Th>
            <Th>ML</Th>
            <Th>SPREAD</Th>
            <Th>TOTAL</Th>
            <Th>Injuries</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {data.games.map((g) => (
            <GameRow
              key={g.game_external_id}
              g={g}
              expanded={expanded.has(g.game_external_id)}
              onToggle={() => onToggle(g.game_external_id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color: "#475569",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  colSpan,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "6px 10px",
        borderBottom: "1px solid #f1f5f9",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function GameRow({
  g,
  expanded,
  onToggle,
}: {
  g: AdminGameEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const p = g.prediction;
  const s = g.snapshot.series;
  const seriesStr =
    s !== null
      ? `G${s.game_number} ${s.series_score_home}-${s.series_score_away}${s.is_elimination_for_home ? " (H elim)" : ""}${s.is_elimination_for_away ? " (A elim)" : ""}${s.venue_shift ? " ✱" : ""}`
      : "—";
  return (
    <>
      <tr>
        <Td>{g.game_external_id}</Td>
        <Td>
          <strong>{g.matchup}</strong>
        </Td>
        <Td>{seriesStr}</Td>
        <Td>
          <TierBadge tier={p.audit.data_quality_tier} />
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            ceil={p.audit.confidence_ceiling}, trust=
            {p.audit.trust_independent.toFixed(2)}
          </div>
        </Td>
        <Td>
          {g.away_abbr} {p.predicted_away_score} @ {g.home_abbr}{" "}
          {p.predicted_home_score}
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            T={p.predicted_total} · S(home)={p.predicted_spread_home}
          </div>
        </Td>
        <Td>
          <strong>{p.predicted_ml_winner}</strong> @ {p.ml_confidence}%
          {p.audit.ml_best_angle_eligible && (
            <span
              style={{
                marginLeft: 6,
                padding: "0 4px",
                background: "#dcfce7",
                color: "#15803d",
                borderRadius: 3,
                fontSize: 10,
              }}
            >
              BA
            </span>
          )}
        </Td>
        <Td>
          <strong>{p.predicted_spread_side}</strong> @ {p.spread_confidence}%
        </Td>
        <Td>
          <strong>{p.predicted_total_side}</strong> @ {p.total_confidence}%
        </Td>
        <Td>
          <div style={{ fontSize: 11 }}>
            H: out={p.audit.injury_out_count_home}, ?=
            {p.audit.injury_unknown_count_home}
          </div>
          <div style={{ fontSize: 11 }}>
            A: out={p.audit.injury_out_count_away}, ?=
            {p.audit.injury_unknown_count_away}
          </div>
        </Td>
        <Td>
          <button
            onClick={onToggle}
            style={{
              padding: "2px 8px",
              background: "#fff",
              color: "#475569",
              border: "1px solid #cbd5e1",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {expanded ? "Hide" : "Show"}
          </button>
        </Td>
      </tr>
      {expanded && (
        <tr style={{ background: "#fafafa" }}>
          <Td colSpan={10}>
            <DetailPanel g={g} />
          </Td>
        </tr>
      )}
    </>
  );
}

function TierBadge({
  tier,
}: {
  tier: "high" | "medium" | "low" | "fallback";
}) {
  const colors: Record<typeof tier, { bg: string; fg: string }> = {
    high: { bg: "#dcfce7", fg: "#166534" },
    medium: { bg: "#fef9c3", fg: "#854d0e" },
    low: { bg: "#fee2e2", fg: "#991b1b" },
    fallback: { bg: "#e5e7eb", fg: "#374151" },
  };
  const c = colors[tier];
  return (
    <span
      style={{
        padding: "1px 6px",
        background: c.bg,
        color: c.fg,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
      }}
    >
      {tier}
    </span>
  );
}

function DetailPanel({ g }: { g: AdminGameEntry }) {
  const p = g.prediction;
  const s = g.snapshot;
  return (
    <div style={{ fontSize: 12, color: "#1f2937" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Independent (Layer 1):</strong>{" "}
        {g.away_abbr} {p.audit.independent_away_score} @ {g.home_abbr}{" "}
        {p.audit.independent_home_score} · sd={p.audit.independent_home_sd}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Market baseline:</strong> total={p.audit.market_total ?? "—"} ·
        spread(home)={p.audit.market_spread_home ?? "—"} · ML no-vig home=
        {p.audit.market_home_ml_no_vig?.toFixed(3) ?? "—"} · away=
        {p.audit.market_away_ml_no_vig?.toFixed(3) ?? "—"}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Posterior:</strong> {g.away_abbr}{" "}
        {p.audit.posterior_away_score} @ {g.home_abbr}{" "}
        {p.audit.posterior_home_score} · total={p.audit.posterior_total} ·
        spread(home)={p.audit.posterior_spread_home}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Data quality:</strong> ratings_present=
        {String(s.data_quality.ratings_present)} · market_present=
        {String(s.data_quality.market_present)} · home_inj_known=
        {String(s.data_quality.home_injuries_known)} · away_inj_known=
        {String(s.data_quality.away_injuries_known)} · series_derived=
        {String(s.data_quality.series_context_derived)}
      </div>
      {p.audit.model_integrity_notes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <strong>Notes:</strong>
          <ul style={{ margin: "4px 0 0 16px" }}>
            {p.audit.model_integrity_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ marginBottom: 8 }}>
        <strong>Home injuries ({s.home_injuries.length}):</strong>{" "}
        {s.home_injuries.length === 0 ? (
          <em style={{ color: "#94a3b8" }}>none</em>
        ) : (
          s.home_injuries
            .map((i) => `${i.name} (${i.status})`)
            .join(", ")
        )}
      </div>
      <div>
        <strong>Away injuries ({s.away_injuries.length}):</strong>{" "}
        {s.away_injuries.length === 0 ? (
          <em style={{ color: "#94a3b8" }}>none</em>
        ) : (
          s.away_injuries
            .map((i) => `${i.name} (${i.status})`)
            .join(", ")
        )}
      </div>
    </div>
  );
}
