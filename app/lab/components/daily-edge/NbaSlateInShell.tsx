"use client";

/**
 * NBA Daily Edge panel — renders inside /lab/daily-edge when
 * ?sport=nba is selected. Uses the same SportRail at the top so the
 * sport tabs feel identical to MLB. Body mirrors MLB visual rhythm:
 *   • Slate Control strip (date + game count)
 *   • Selected Edge Reader (top, non-sticky)
 *   • Slate Board grid below (1 card tonight: SA @ NY)
 *
 * Data: /api/admin/nba-preview?date=<today-ET>. Admin auth handled
 * via the existing middleware bypass (nba-v0a preview branch) +
 * page-side credential entry fallback when not on preview deploy.
 *
 * Internal/admin/preview-only. Member-facing UI must not surface
 * "v1", "research-prior", "calibration pending" tokens — none of
 * those appear here (we render only v0 picks tonight).
 */

import { useCallback, useEffect, useState } from "react";
import { SportRail } from "./DailyEdgeShell";
import type {
  NbaDailyEdgeDto,
  NbaDailyEdgeGameDto,
  MarketIntelligence,
} from "@/lib/services/nba/buildNbaDailyEdgeDto";
import type { RecommendationGrade } from "@/lib/services/nba/nbaMarketReview";

// ─── Visual tokens — mirror MLB Daily Edge palette (R-16H locked) ──

const GRADE_LABEL: Record<RecommendationGrade, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watch: "Watchlist",
  caution: "Caution",
  no_market: "No Market",
  held: "Held",
};
const GRADE_GLYPH: Record<RecommendationGrade, string> = {
  best_angle: "★",
  lean: "↗",
  watch: "◐",
  caution: "⚠",
  no_market: "·",
  held: "○",
};
const GRADE_TEXT: Record<RecommendationGrade, string> = {
  best_angle: "text-emerald-300",
  lean: "text-sky-300",
  watch: "text-indigo-300",
  caution: "text-amber-300",
  no_market: "text-gray-400",
  held: "text-gray-500",
};
const GRADE_BAND: Record<RecommendationGrade, string> = {
  best_angle: "from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent border-emerald-500/30",
  lean: "from-sky-500/[0.10] via-sky-500/[0.03] to-transparent border-sky-500/25",
  watch: "from-white/[0.04] via-white/[0.015] to-transparent border-white/[0.08]",
  caution: "from-amber-500/[0.12] via-amber-500/[0.04] to-transparent border-amber-500/30",
  no_market: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
  held: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
};
const GRADE_PILL: Record<RecommendationGrade, string> = {
  best_angle: "bg-emerald-500/[0.12] border-emerald-500/35",
  lean: "bg-sky-500/[0.09] border-sky-500/25",
  watch: "bg-indigo-500/[0.08] border-indigo-500/25",
  caution: "bg-amber-500/[0.10] border-amber-500/30",
  no_market: "bg-gray-900/40 border-gray-700/40",
  held: "bg-gray-900/40 border-gray-700/40",
};
const GRADE_GLOW: Record<RecommendationGrade, string> = {
  best_angle: "drop-shadow-[0_0_6px_rgba(110,231,183,0.55)]",
  lean: "",
  watch: "",
  caution: "drop-shadow-[0_0_5px_rgba(251,191,36,0.50)]",
  no_market: "",
  held: "",
};

// NBA team primary colors (used for slate card team-color strip).
const NBA_TEAM_COLOR: Record<string, string> = {
  NY: "#006BB6", NYK: "#006BB6",
  SA: "#C4CED4", SAS: "#C4CED4",
  BOS: "#007A33", LAL: "#552583", GSW: "#1D428A",
  MIA: "#98002E", DEN: "#0E2240", PHX: "#1D1160",
  OKC: "#007AC1", MIL: "#00471B", DAL: "#00538C",
};
function teamColor(abbr: string): string {
  return NBA_TEAM_COLOR[abbr.toUpperCase()] ?? "#4B5563";
}

// ESPN's public CDN logo URL. Their abbreviation slugs match the
// ESPN team external_ids we already seeded NBA with (NY, SA, etc.).
function nbaLogoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;
}

// ─── Formatting helpers ────────────────────────────────────────────

function fmtAmerican(o: number | null): string {
  if (o === null) return "—";
  return o > 0 ? `+${o}` : `${o}`;
}
function fmtProb(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}
function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}
function fmtLine(line: number | null): string {
  if (line === null) return "—";
  return line > 0 ? `+${line}` : `${line}`;
}
function todayEt(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// ─── Sub-components ────────────────────────────────────────────────

function TeamLogo({ abbr, size = 32 }: { abbr: string; size?: number }) {
  // Fallback: tinted disc with abbrev if logo fails to load. Using <img>
  // (not next/image) so we don't have to configure remote domains.
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden bg-white/[0.04] ring-1 ring-white/[0.06]"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nbaLogoUrl(abbr)}
        alt={abbr}
        width={size}
        height={size}
        className="object-contain"
        onError={(e) => {
          const t = e.target as HTMLImageElement;
          t.style.display = "none";
          t.parentElement!.textContent = abbr;
          t.parentElement!.className += " text-[10px] font-bold text-gray-300";
        }}
      />
    </span>
  );
}

function GradePill({ grade, label }: { grade: RecommendationGrade; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${GRADE_PILL[grade]} ${GRADE_TEXT[grade]}`}
    >
      <span className={GRADE_GLOW[grade]}>{GRADE_GLYPH[grade]}</span>
      {label}
    </span>
  );
}

function MarketChipInCard({
  marketLabel,
  intel,
  selected,
  onClick,
}: {
  marketLabel: string;
  intel: MarketIntelligence;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border transition-colors ${GRADE_PILL[intel.grade]} ${selected ? "ring-1 ring-violet-400/55" : ""}`}
    >
      <span className="flex items-center gap-1">
        <span className={`text-[10px] uppercase tracking-wider ${GRADE_TEXT[intel.grade]}`}>{marketLabel}</span>
        <span className={GRADE_TEXT[intel.grade]}>{GRADE_GLYPH[intel.grade]}</span>
      </span>
      <span className="text-xs text-gray-200 truncate">{intel.pick_label}</span>
    </button>
  );
}

function SlateCard({
  game,
  active,
  activeMarket,
  onSelectGame,
  onSelectMarket,
}: {
  game: NbaDailyEdgeGameDto;
  active: boolean;
  activeMarket: "ml" | "spread" | "total" | null;
  onSelectGame: () => void;
  onSelectMarket: (m: "ml" | "spread" | "total") => void;
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  return (
    <button
      type="button"
      onClick={onSelectGame}
      className={`w-full text-left rounded-xl border bg-[#0D0D14] transition-colors p-3 space-y-2.5 ${
        active
          ? "border-violet-400/60 shadow-[0_0_0_2px_rgba(167,139,250,0.18)]"
          : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      <div className="h-1 rounded-full overflow-hidden flex">
        <div style={{ background: teamColor(game.away_abbr), flex: 1 }} />
        <div style={{ background: teamColor(game.home_abbr), flex: 1 }} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo abbr={game.away_abbr} size={26} />
          <span className="text-gray-500 text-sm">@</span>
          <TeamLogo abbr={game.home_abbr} size={26} />
          <div className="text-sm font-semibold text-gray-100 truncate ml-1">
            {game.away_abbr} @ {game.home_abbr}
          </div>
        </div>
        <GradePill grade={topGrade} label={GRADE_LABEL[topGrade]} />
      </div>
      <div className="text-[11px] text-gray-500">
        {game.tip_display_et ?? "tip tbd"} · {game.series.text}
      </div>
      <div className="grid grid-cols-1 gap-1 pt-1">
        <MarketChipInCard
          marketLabel="ML"
          intel={intel.ml}
          selected={active && activeMarket === "ml"}
          onClick={() => onSelectMarket("ml")}
        />
        <MarketChipInCard
          marketLabel="Spread"
          intel={intel.spread}
          selected={active && activeMarket === "spread"}
          onClick={() => onSelectMarket("spread")}
        />
        <MarketChipInCard
          marketLabel="Total"
          intel={intel.total}
          selected={active && activeMarket === "total"}
          onClick={() => onSelectMarket("total")}
        />
      </div>
    </button>
  );
}

function MarketPanel({ market, intel }: { market: "ml" | "spread" | "total"; intel: MarketIntelligence }) {
  const grade = intel.grade;
  const longLabel = market === "ml" ? "Moneyline" : market === "spread" ? "Spread" : "Total";
  return (
    <div className={`rounded-xl border bg-gradient-to-b ${GRADE_BAND[grade]} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-400">{longLabel}</div>
          <div className={`text-2xl font-semibold mt-0.5 ${GRADE_TEXT[grade]} ${GRADE_GLOW[grade]}`}>
            {intel.pick_label}
          </div>
        </div>
        <div className="text-right">
          <GradePill grade={grade} label={GRADE_LABEL[grade]} />
          <div className="text-[10px] text-gray-500 mt-1">
            eff conf {intel.effective_confidence.toFixed(0)} / model {intel.model_confidence.toFixed(0)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Line</div>
          <div className="text-sm font-mono text-gray-200">
            {market === "ml" ? "—" : fmtLine(intel.consensus_line)}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Best Price</div>
          <div className="text-sm font-mono text-gray-200">{fmtAmerican(intel.current_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.current_price.sportsbook ?? "—"}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Other Side</div>
          <div className="text-sm font-mono text-gray-300">{fmtAmerican(intel.other_side_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.other_side_price.sportsbook ?? "—"}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300 uppercase tracking-wider">
          {intel.conflict_band.replace("_", " ")}
        </span>
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300">
          no-vig {fmtProb(intel.market_no_vig_prob_pick)}
        </span>
        {intel.opp_ev_percentage_pick !== null && (
          <span
            className={`px-2 py-0.5 rounded border uppercase tracking-wider ${
              intel.opp_ev_percentage_pick > 0
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-gray-800/40 border-gray-700/40 text-gray-400"
            }`}
          >
            EV {intel.opp_ev_percentage_pick > 0 ? "+" : ""}{intel.opp_ev_percentage_pick.toFixed(2)}%
          </span>
        )}
        {intel.opp_possibly_stale && (
          <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-300">
            possibly stale
          </span>
        )}
      </div>
      {intel.rationale.length > 0 && (
        <div className="border-t border-gray-800/40 pt-2 text-[11px] text-gray-400 space-y-1">
          {intel.rationale.map((r, i) => <div key={i}>· {r}</div>)}
        </div>
      )}
      <div className="text-[10px] text-gray-500 italic border-t border-gray-800/40 pt-2">
        {intel.movement_note}
      </div>
    </div>
  );
}

function PublicSplitsRow({ intel, label }: { intel: MarketIntelligence; label: string }) {
  const pick = intel.splits.pick_side;
  const other = intel.splits.other_side;
  if (pick === null && other === null) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
        <span>{label}</span>
        <span className="text-gray-500">{intel.pick_label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="space-y-1">
          <div className="text-gray-500">Pick — bets / handle</div>
          <div className="font-mono text-gray-200">{fmtPct(pick?.bets_pct ?? null)} / {fmtPct(pick?.handle_pct ?? null)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-gray-500">Other — bets / handle</div>
          <div className="font-mono text-gray-300">{fmtPct(other?.bets_pct ?? null)} / {fmtPct(other?.handle_pct ?? null)}</div>
        </div>
      </div>
    </div>
  );
}

function SelectedEdgeReader({
  game,
  selectedMarket,
  onMarketChange,
}: {
  game: NbaDailyEdgeGameDto;
  selectedMarket: "ml" | "spread" | "total";
  onMarketChange: (m: "ml" | "spread" | "total") => void;
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  return (
    <div className={`rounded-2xl border bg-[#0D0D14] bg-gradient-to-b ${GRADE_BAND[topGrade]} p-5 space-y-5`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TeamLogo abbr={game.away_abbr} size={44} />
          <span className="text-gray-500 text-2xl">@</span>
          <TeamLogo abbr={game.home_abbr} size={44} />
          <div className="ml-2">
            <div className="text-[11px] uppercase tracking-widest text-gray-400">{game.series.text}</div>
            <div className="text-2xl font-semibold text-gray-100 mt-0.5">
              {game.away_abbr} <span className="text-gray-500 text-xl">@</span> {game.home_abbr}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{game.tip_display_et ?? "tip tbd"}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl ${GRADE_TEXT[topGrade]} ${GRADE_GLOW[topGrade]}`}>
            {GRADE_GLYPH[topGrade]} {GRADE_LABEL[topGrade]}
          </div>
          <div className="text-[10px] text-gray-500 uppercase">top read</div>
        </div>
      </div>

      {/* Quick Read */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Quick Read</div>
        <div className="text-sm text-gray-100">{game.quick_read}</div>
      </div>

      {/* Projection strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Predicted Score</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">
            {Math.round(game.projection.away_score)} – {Math.round(game.projection.home_score)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">{game.away_abbr} @ {game.home_abbr}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Total</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">{game.projection.total.toFixed(1)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">market {intel.total.consensus_line ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Spread</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">
            {game.projection.spread_home > 0 ? "+" : ""}{game.projection.spread_home.toFixed(1)} <span className="text-xs text-gray-500">(home)</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">market {intel.spread.consensus_line ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Tier</div>
          <div className="text-sm text-gray-200 uppercase">{game.data_quality_tier}</div>
          {intel.sources.limited_book_coverage && (
            <div className="text-[10px] text-amber-300/80">
              ⚠ limited book coverage ({intel.sources.book_count} {intel.sources.book_count === 1 ? "book" : "books"})
            </div>
          )}
        </div>
      </div>

      {/* Market selector tabs (ML / Spread / Total) */}
      <div className="flex flex-wrap items-center gap-2">
        {(["ml", "spread", "total"] as const).map((m) => {
          const i = m === "ml" ? intel.ml : m === "spread" ? intel.spread : intel.total;
          const label = m === "ml" ? "Moneyline" : m === "spread" ? "Spread" : "Total";
          return (
            <button
              key={m}
              type="button"
              onClick={() => onMarketChange(m)}
              className={`px-3 py-1.5 rounded border text-xs ${
                selectedMarket === m
                  ? "border-violet-400/60 bg-violet-500/15 text-violet-100"
                  : `${GRADE_PILL[i.grade]} ${GRADE_TEXT[i.grade]}`
              }`}
            >
              <span>{label}</span>
              <span className="ml-1.5 opacity-75">{i.pick_label}</span>
            </button>
          );
        })}
      </div>

      {/* Selected market detail */}
      <MarketPanel market={selectedMarket} intel={selectedMarket === "ml" ? intel.ml : selectedMarket === "spread" ? intel.spread : intel.total} />

      {/* Public Splits */}
      {intel.sources.has_splits ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Public Splits · consensus</div>
          <PublicSplitsRow intel={intel.ml} label="Moneyline" />
          <PublicSplitsRow intel={intel.spread} label="Spread" />
          <PublicSplitsRow intel={intel.total} label="Total" />
          <div className="text-[10px] text-gray-600 border-t border-white/[0.04] pt-2">
            NBA rule: do not auto-follow handle, do not auto-fade public. Splits are a context signal.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-gray-500 italic">
          Public splits unavailable — SharpAPI returned no consensus row for this matchup.
        </div>
      )}

      {/* Source badges */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <SourceChip label={`ESPN schedule`} on={true} />
        <SourceChip label={`BBR ratings`} on={game.provenance.home_ratings.populated && game.provenance.away_ratings.populated} />
        <SourceChip label={`Lines (${intel.sources.book_count} books)`} on={intel.sources.has_lines} />
        <SourceChip label="Splits" on={intel.sources.has_splits} />
        <SourceChip label="EV / opps" on={intel.sources.has_opportunities} />
        <SourceChip label="Injuries (ESPN)" on={game.provenance.injuries_source === "espn"} />
        <SourceChip label="Series context" on={game.provenance.series_priors_found} />
        <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/35 text-amber-300 uppercase tracking-wider">
          internal preview
        </span>
      </div>
    </div>
  );
}

function SourceChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium uppercase tracking-wider ${
        on
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-gray-800/40 border-gray-700/40 text-gray-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-gray-500"}`} />
      {label}
    </span>
  );
}

// ─── Top-level NBA shell ──────────────────────────────────────────

export default function NbaSlateInShell() {
  const [date, setDate] = useState<string>(todayEt());
  const [dto, setDto] = useState<NbaDailyEdgeDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [adminToken, setAdminToken] = useState<string>("");
  const [selectedMarket, setSelectedMarket] = useState<"ml" | "spread" | "total">("ml");

  const isHostedPreview =
    typeof window !== "undefined" && window.location.hostname.endsWith(".vercel.app");

  const fetchDto = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (adminEmail !== "" && adminToken !== "") {
        headers["x-admin-email"] = adminEmail;
        headers["x-admin-token"] = adminToken;
      }
      const res = await fetch(`/api/admin/nba-preview?date=${date}`, { headers });
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        setDto(null);
        return;
      }
      const json = (await res.json()) as NbaDailyEdgeDto;
      setDto(json);
    } catch (e) {
      setError((e as Error).message);
      setDto(null);
    } finally {
      setLoading(false);
    }
  }, [date, adminEmail, adminToken]);

  useEffect(() => {
    if (isHostedPreview) {
      void fetchDto();
    }
  }, [isHostedPreview, fetchDto]);

  const game = dto?.games[0] ?? null;

  return (
    <div className="bg-[#0A0A0F] text-gray-200 min-h-screen">
      <SportRail sport="nba" />

      {/* Slate control strip — matches MLB's layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="uppercase tracking-widest text-gray-500">Slate ·</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-100"
          />
          <span className="text-gray-500">·</span>
          <span>{dto?.games.length ?? 0} {(dto?.games.length ?? 0) === 1 ? "game" : "games"}</span>
          <button
            type="button"
            onClick={() => void fetchDto()}
            className="ml-2 px-2.5 py-1 rounded bg-violet-500/15 border border-violet-400/30 text-[11px] text-violet-200 hover:bg-violet-500/25"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {!isHostedPreview && (
          <div className="flex items-center gap-1.5">
            <input
              type="email"
              placeholder="admin email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
            <input
              type="password"
              placeholder="admin token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
          </div>
        )}
      </div>

      {/* Internal preview notice */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-amber-200">
          NBA · internal preview · provisional · not member-facing
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-3 pb-10">
        {error !== null && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            ✗ {error}
          </div>
        )}
        {dto === null ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-gray-500">
            {loading ? "Loading NBA slate…" : "Enter admin credentials and click Refresh."}
          </div>
        ) : game === null ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-gray-500">
            No NBA games on this slate.
          </div>
        ) : (
          <>
            {/* Selected Edge Reader — top, non-sticky (matches MLB layout) */}
            <div className="mb-6">
              <SelectedEdgeReader
                game={game}
                selectedMarket={selectedMarket}
                onMarketChange={setSelectedMarket}
              />
            </div>

            {/* Slate Board header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">
                Slate · {dto.slate_date_et} ET
              </div>
              <div className="text-[10px] text-gray-500">
                {dto.games.length} {dto.games.length === 1 ? "game" : "games"}
              </div>
            </div>

            {/* Slate grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dto.games.map((g) => (
                <SlateCard
                  key={g.game_external_id}
                  game={g}
                  active={g.game_external_id === game.game_external_id}
                  activeMarket={g.game_external_id === game.game_external_id ? selectedMarket : null}
                  onSelectGame={() => { /* single-card slate tonight; no-op selection */ }}
                  onSelectMarket={(m) => setSelectedMarket(m)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="text-center pb-10">
        <p className="text-[11px] uppercase tracking-[0.16em] text-gray-600 font-medium">
          OddSphere · Daily Edge · NBA · Preview
        </p>
      </footer>
    </div>
  );
}
