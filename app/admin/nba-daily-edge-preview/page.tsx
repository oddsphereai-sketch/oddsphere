"use client";

/**
 * Phase 7B v0c — NBA Daily Edge-style PREVIEW page.
 *
 * INTERNAL / ADMIN-ONLY. NOT member-facing. Lives only on the nba-v0a
 * branch and inherits the same temporary preview-branch auth bypass as
 * /admin/nba-preview.
 *
 * Visual goal: matches the Daily Edge product feel (Hero / Best Angle /
 * Caution-style cards) but renders NBA-specific data (ML / spread /
 * total with model + market context, series context, ratings/lines
 * provenance).
 *
 * Data source: /api/admin/nba-preview?date=YYYY-MM-DD (ET-interpreted
 * date in the URL → ET-day UTC window on the server). Same auth bypass
 * applies, so this page does NOT show a login form on the nba-v0a
 * preview deployment.
 *
 * Removal: when nba-v0a is merged to main this entire route should be
 * deleted (or kept but gated behind a feature flag). Either way the
 * temporary auth bypass MUST be removed first.
 */

import { useCallback, useEffect, useState } from "react";

type ConflictBand =
  | "support"
  | "neutral"
  | "mild_conflict"
  | "strong_conflict"
  | "market_unavailable";

type Grade =
  | "best_angle"
  | "lean"
  | "watch"
  | "caution"
  | "no_market"
  | "held";

type MarketReviewRow = {
  market: "moneyline" | "spread" | "total";
  pick_side: "home" | "away" | "over" | "under" | null;
  pick_label: string;
  model_confidence: number;
  market_book: string | null;
  market_line: number | null;
  market_odds_american: number | null;
  market_odds_decimal: number | null;
  market_implied_prob: number | null;
  market_no_vig_prob: number | null;
  market_other_side_odds_american: number | null;
  model_prob_on_pick_side: number | null;
  edge_prob_pp: number | null;
  edge_points: number | null;
  conflict_band: ConflictBand;
  grade: Grade;
  effective_confidence: number;
  best_angle_eligible: boolean;
  rationale: string[];
};

type Provenance = {
  game_external_id: number;
  schedule_source: "espn_scoreboard";
  series_priors_found: boolean;
  prior_games_window_days: number;
  market_source: "sharpapi" | "none";
  market_book_priority: readonly string[];
  home_ratings: {
    team_id: number;
    season: number | null;
    season_type: "regular" | "playoffs" | null;
    source: string | null;
    source_url: string | null;
    fetched_at: string | null;
    populated: boolean;
  };
  away_ratings: {
    team_id: number;
    season: number | null;
    season_type: "regular" | "playoffs" | null;
    source: string | null;
    source_url: string | null;
    fetched_at: string | null;
    populated: boolean;
  };
  injuries_source: "espn" | "none";
  injuries_known_home: boolean;
  injuries_known_away: boolean;
};

type GameReview = {
  game_external_id: number;
  matchup: string;
  home_abbr: string;
  away_abbr: string;
  tip_iso_utc: string | null;
  tip_iso_et: string | null;
  series_line: string;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  projected_home_score: number | null;
  projected_away_score: number | null;
  projected_total: number | null;
  projected_home_spread: number | null;
  injuries_summary: string;
  provenance: Provenance;
  market_review_rows: MarketReviewRow[];
};

type ApiResponse = {
  as_of: string;
  sport: "nba";
  slate_date_et: string;
  utc_window: { startISO: string; endISO: string };
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
  game_reviews: GameReview[];
};

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

// ─── Palette tokens (Daily Edge-inspired) ──────────────────────────

const C = {
  pageBg: "#0b0d10",
  cardBg: "#13171c",
  cardBorder: "#22272e",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  accentEmerald: "#10b981",
  accentIndigo: "#818cf8",
  accentAmber: "#f59e0b",
  accentRose: "#fb7185",
  // Grade colors
  bestAngle: "#10b981",
  lean: "#818cf8",
  watch: "#94a3b8",
  caution: "#fb7185",
  noMarket: "#64748b",
};

function gradeColor(g: Grade): string {
  if (g === "best_angle") return C.bestAngle;
  if (g === "lean") return C.lean;
  if (g === "caution") return C.caution;
  if (g === "no_market" || g === "held") return C.noMarket;
  return C.watch;
}

function gradeLabel(g: Grade): string {
  if (g === "best_angle") return "Best Angle";
  if (g === "lean") return "Lean";
  if (g === "watch") return "Watch";
  if (g === "caution") return "Caution";
  if (g === "no_market") return "No Market";
  return "Held";
}

function bandLabel(b: ConflictBand): { text: string; color: string } {
  if (b === "support") return { text: "Market supports", color: C.accentEmerald };
  if (b === "neutral") return { text: "Market neutral", color: C.textMuted };
  if (b === "mild_conflict") return { text: "Market hedges", color: C.accentAmber };
  if (b === "strong_conflict") return { text: "Market conflicts", color: C.accentRose };
  return { text: "Market unavailable", color: C.textDim };
}

function tierLabel(t: string): { text: string; color: string } {
  if (t === "high") return { text: "HIGH data quality", color: C.accentEmerald };
  if (t === "medium") return { text: "Medium data quality", color: C.accentIndigo };
  if (t === "low") return { text: "Low data quality", color: C.accentAmber };
  return { text: "Fallback tier", color: C.accentRose };
}

function formatAmerican(n: number | null): string {
  if (n === null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function formatPp(pp: number | null, decimals = 1): string {
  if (pp === null) return "—";
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp.toFixed(decimals)}pp`;
}

function formatNum(n: number | null, decimals = 1): string {
  if (n === null) return "—";
  return n.toFixed(decimals);
}

function formatPct(p: number | null, decimals = 1): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(decimals)}%`;
}

// ─── Page shell + auth ─────────────────────────────────────────────

export default function NbaDailyEdgePreviewPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // Mirror the preview-branch auth bypass from /admin/nba-preview.
    // !!! MUST BE REMOVED BEFORE MERGING nba-v0a -> main !!!
    if (
      typeof window !== "undefined" &&
      window.location.hostname.includes("git-nba-v0a")
    ) {
      setAuthed(true);
      return;
    }
    try {
      const saved = localStorage.getItem("admin_credentials");
      if (saved) setAuthed(true);
    } catch {
      // ignore
    }
  }, []);

  if (!authed) {
    return (
      <main style={{ padding: 40, color: "#fff", background: "#0b0d10", minHeight: "100vh", fontFamily: "system-ui" }}>
        <p>Not authorized. Visit this on the nba-v0a preview deployment or sign in via /admin/nba-preview first.</p>
      </main>
    );
  }
  return <DailyEdgePreview />;
}

function DailyEdgePreview() {
  const [date, setDate] = useState(todayET());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      let savedEmail = "";
      let savedToken = "";
      try {
        const saved = localStorage.getItem("admin_credentials");
        if (saved) {
          const parsed = JSON.parse(saved) as { email: string; token: string };
          savedEmail = parsed.email;
          savedToken = parsed.token;
        }
      } catch {
        // ignore
      }
      const res = await fetch(`/api/admin/nba-preview?date=${date}`, {
        headers: { "x-admin-email": savedEmail, "x-admin-token": savedToken },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as ApiResponse;
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main
      style={{
        background: C.pageBg,
        minHeight: "100vh",
        color: C.text,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 80px" }}>
        {/* Internal banner */}
        <div
          style={{
            padding: "10px 14px",
            background: "linear-gradient(90deg, #4c0519, #7f1d1d)",
            border: "1px solid #be123c",
            color: "#fee2e2",
            borderRadius: 8,
            marginBottom: 18,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.1,
            textTransform: "uppercase",
          }}
        >
          🔒 Internal preview · NBA v0b · provisional · not member-facing · nba-v0a branch only
        </div>

        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>
              Daily Edge · NBA Preview
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
              Tonight&apos;s NBA Finals
            </h1>
            {data && (
              <div style={{ marginTop: 6, fontSize: 13, color: C.textMuted }}>
                ET slate {data.slate_date_et} · {data.totals.games_count} game{data.totals.games_count === 1 ? "" : "s"} · as of {new Date(data.as_of).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                padding: "6px 10px",
                background: C.cardBg,
                color: C.text,
                border: `1px solid ${C.cardBorder}`,
                borderRadius: 6,
                fontSize: 13,
              }}
            />
            <button
              onClick={reload}
              disabled={loading}
              style={{
                padding: "8px 16px",
                background: C.accentIndigo,
                color: "#0b0d10",
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: loading ? "wait" : "pointer",
                fontSize: 13,
              }}
            >
              {loading ? "Loading…" : "Reload"}
            </button>
          </div>
        </header>

        {error && (
          <div
            style={{
              padding: 12,
              background: "#3f1212",
              border: "1px solid #b91c1c",
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 13,
              color: "#fecaca",
            }}
          >
            {error}
          </div>
        )}

        {data && data.game_reviews.length === 0 && (
          <EmptyState />
        )}

        {data &&
          data.game_reviews.map((g) => (
            <GameCard key={g.game_external_id} game={g} />
          ))}

        {data && (
          <footer style={{ marginTop: 28, color: C.textDim, fontSize: 12 }}>
            <p>
              NBA Finals v0b: BBR ratings · ESPN schedule + series · SharpAPI odds.
              Thresholds are v0 placeholders; calibration pending.
              Game tip times shown in ET.
            </p>
          </footer>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: 32,
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 8,
        textAlign: "center",
        color: C.textMuted,
      }}
    >
      <p>No NBA games on this slate date. Try another date or re-run the seed operator.</p>
    </div>
  );
}

// ─── Game card ─────────────────────────────────────────────────────

function GameCard({ game }: { game: GameReview }) {
  const tier = tierLabel(game.data_quality_tier);
  // Find the best-graded market for prominence
  const sorted = [...game.market_review_rows].sort((a, b) => {
    const rank = (g: Grade): number => ({ best_angle: 0, lean: 1, watch: 2, caution: 3, no_market: 4, held: 5 })[g];
    return rank(a.grade) - rank(b.grade);
  });
  const leadRow = sorted[0];
  const leadColor = gradeColor(leadRow.grade);

  return (
    <article
      style={{
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderTop: `3px solid ${leadColor}`,
        borderRadius: 10,
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {/* Card header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${C.cardBorder}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.2, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>
              NBA Finals
            </div>
            <h2 style={{ margin: "4px 0 2px", fontSize: 22, fontWeight: 700 }}>
              {game.away_abbr} @ {game.home_abbr}
            </h2>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              {game.series_line} · {game.tip_iso_et ?? "—"}
            </div>
          </div>
          <div
            style={{
              padding: "4px 10px",
              background: tier.color + "20",
              color: tier.color,
              border: `1px solid ${tier.color}40`,
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            {tier.text}
          </div>
        </div>
      </div>

      {/* Projection summary */}
      <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, borderBottom: `1px solid ${C.cardBorder}` }}>
        <Stat label="Projected score" value={`${formatNum(game.projected_away_score, 1)} – ${formatNum(game.projected_home_score, 1)}`} />
        <Stat label="Projected total" value={formatNum(game.projected_total, 1)} />
        <Stat label="Projected spread" value={`${game.home_abbr} ${game.projected_home_spread !== null ? (game.projected_home_spread > 0 ? `+${game.projected_home_spread.toFixed(1)}` : game.projected_home_spread.toFixed(1)) : "—"}`} />
        <Stat label="Injuries" value={game.injuries_summary} small />
      </div>

      {/* 3 market sections */}
      <div style={{ padding: "8px 0" }}>
        {game.market_review_rows.map((row, i) => (
          <MarketSection key={row.market} row={row} game={game} isFirst={i === 0} />
        ))}
      </div>

      {/* Provenance footer */}
      <ProvenanceBar game={game} />
    </article>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1, color: C.textMuted, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: small ? 12 : 16, fontWeight: small ? 400 : 600, color: small ? C.textMuted : C.text }}>
        {value}
      </div>
    </div>
  );
}

function MarketSection({ row, game, isFirst }: { row: MarketReviewRow; game: GameReview; isFirst: boolean }) {
  const gColor = gradeColor(row.grade);
  const gLabel = gradeLabel(row.grade);
  const band = bandLabel(row.conflict_band);
  const marketName = row.market === "moneyline" ? "Moneyline" : row.market === "spread" ? "Spread" : "Total";
  return (
    <section
      style={{
        padding: "14px 20px",
        borderTop: isFirst ? "none" : `1px solid ${C.cardBorder}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            {marketName}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
            {row.pick_label}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Model {formatNum(row.model_confidence, 1)}% · effective {formatNum(row.effective_confidence, 1)}%
          </div>
        </div>

        <div
          style={{
            padding: "4px 12px",
            background: gColor + "20",
            color: gColor,
            border: `1px solid ${gColor}50`,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          {gLabel}{row.best_angle_eligible ? " ★" : ""}
        </div>
      </div>

      {/* Market context grid */}
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          padding: 12,
          background: "#0d1116",
          border: `1px solid ${C.cardBorder}`,
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <MarketStat
          label="Line"
          value={row.market_line !== null ? row.market_line.toString() : row.market === "moneyline" ? "—" : "—"}
        />
        <MarketStat
          label="Odds (pick / other)"
          value={`${formatAmerican(row.market_odds_american)} / ${formatAmerican(row.market_other_side_odds_american)}`}
        />
        <MarketStat
          label="No-vig prob (pick)"
          value={formatPct(row.market_no_vig_prob)}
        />
        <MarketStat
          label="Model edge"
          value={row.market === "moneyline" ? formatPp(row.edge_prob_pp) : row.edge_points !== null ? `${row.edge_points > 0 ? "+" : ""}${row.edge_points.toFixed(1)} pts` : "—"}
          color={row.edge_prob_pp !== null && row.edge_prob_pp > 4 ? C.accentEmerald : row.edge_prob_pp !== null && row.edge_prob_pp < -4 ? C.accentRose : C.text}
        />
      </div>

      {/* Band + rationale */}
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span
          style={{
            padding: "2px 8px",
            background: band.color + "20",
            color: band.color,
            border: `1px solid ${band.color}40`,
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          {band.text}
        </span>
        {row.rationale.length > 0 && (
          <span style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
            {row.rationale.join(" ")}
          </span>
        )}
      </div>

      {/* Aside: which book(s) — we just hint "see lines table" for now */}
      {row.market_book !== null && (
        <div style={{ marginTop: 6, fontSize: 11, color: C.textDim }}>
          Source: SharpAPI (multi-book aggregate; pick row uses highest-priority book per market)
        </div>
      )}
      {row.market_book === null && (
        <div style={{ marginTop: 6, fontSize: 11, color: C.accentAmber }}>
          ⚠ No market data for this market — pick is model-only.
        </div>
      )}
    </section>
  );
}

function MarketStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: color ?? C.text }}>
        {value}
      </div>
    </div>
  );
}

function ProvenanceBar({ game }: { game: GameReview }) {
  const p = game.provenance;
  const badges: Array<{ label: string; ok: boolean; hint?: string }> = [
    { label: "ESPN schedule", ok: true },
    {
      label: `BBR ratings (${p.home_ratings.populated && p.away_ratings.populated ? "both" : "partial"})`,
      ok: p.home_ratings.populated && p.away_ratings.populated,
      hint: p.home_ratings.source_url ?? undefined,
    },
    { label: "SharpAPI odds", ok: p.market_source === "sharpapi" },
    {
      label: p.injuries_source === "espn" ? "ESPN injuries" : "Injuries not enabled",
      ok: p.injuries_source === "espn",
      hint:
        p.injuries_source === "none"
          ? "Set NBA_INJURY_INGEST_ENABLED=true in env"
          : `H known: ${p.injuries_known_home} · A known: ${p.injuries_known_away}`,
    },
    {
      label: `Series priors: ${p.series_priors_found ? "found" : "none"}`,
      ok: p.series_priors_found,
    },
  ];
  return (
    <div
      style={{
        padding: "10px 20px",
        background: "#0d1116",
        borderTop: `1px solid ${C.cardBorder}`,
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        fontSize: 11,
      }}
    >
      {badges.map((b, i) => (
        <span
          key={i}
          title={b.hint ?? ""}
          style={{
            padding: "3px 8px",
            background: b.ok ? "#0d2818" : "#2b1a0d",
            color: b.ok ? C.accentEmerald : C.accentAmber,
            border: `1px solid ${b.ok ? "#0d4d2a" : "#5c3a17"}`,
            borderRadius: 999,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {b.ok ? "✓ " : "○ "}
          {b.label}
        </span>
      ))}
    </div>
  );
}
