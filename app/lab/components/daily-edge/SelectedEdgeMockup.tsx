/**
 * SelectedEdgeMockup — DESIGN-REVIEW ONLY (2026-06-17).
 *
 * A self-contained, hardcoded mockup of the redesigned Daily Edge → Selected
 * Edge "full read" so the layout/polish can be approved BEFORE any change to
 * the live reader. Renders nothing real: no DTO, no model/grading/tracking/DB
 * touch. Sample data = KC @ WSH. Rendered by /lab/selected-edge-preview.
 *
 * Redesign goals encoded here (per the approved spec):
 *   • 3 columns: Quick Read | Supporting Evidence (ONE vertical column) |
 *     Key Stats & Notes (market-specific). No 4-column evidence split.
 *   • Odds Move = compact open → prev → current/lock trail (not prose).
 *   • Source tucked into Model Edge (no separate BOOK row).
 *   • Market Read carries a tiny colored signal icon (green/yellow/neutral).
 *   • ML/Total keep full Market Pulse split bars; FI shows a clean
 *     "unavailable" splits state.
 *   • Right column stats swap per market (ML / Total / 1st Inning).
 *
 * NONE of this is wired into the live shell. Delete freely after approval.
 */

"use client";

import { useState } from "react";

type MarketKey = "moneyline" | "total" | "first_inning";
type SignalTone = "green" | "yellow" | "neutral";

// ─── Sample data: KC @ WSH ──────────────────────────────────────────────
const GAME = { away: "KC", home: "WSH", time: "7:05 PM ET" };

type Stat = { label: string; value: string; sub?: string };
type MarketMock = {
  verdict: string;
  verdictTone: "best_angle" | "lean" | "watchlist" | "caution";
  pick: string;
  modelEdge: { model: string; market: string; source: string; delta: string; deltaTone: "pos" | "neg" };
  splits: { money: number; bets: number; delta: number } | { unavailable: true };
  oddsMove: { open?: number; prev?: number; current?: number; locked?: boolean };
  lineRow: { label: string; value: string };
  marketRead: { tone: SignalTone; text: string };
  confidence: { modelPct: number; marketPct: number };
  pulse:
    | { kind: "bars"; sides: Array<{ label: string; money: number; bets: number }> }
    | { kind: "note"; text: string };
  keyStats: Stat[];
  why: string;
  risk: string;
};

const MOCK: Record<MarketKey, MarketMock> = {
  moneyline: {
    verdict: "Lean",
    verdictTone: "lean",
    pick: "Kansas City ML",
    modelEdge: { model: "57%", market: "49%", source: "betmgm", delta: "+8.4 pp", deltaTone: "pos" },
    splits: { money: 29, bets: 52, delta: -23 },
    oddsMove: { open: -115, prev: -143, current: -105, locked: false },
    lineRow: { label: "MONEYLINE", value: "KC -105" },
    marketRead: { tone: "yellow", text: "Sharp money against our side" },
    confidence: { modelPct: 57, marketPct: 49 },
    pulse: {
      kind: "bars",
      sides: [
        { label: "KC", money: 29, bets: 52 },
        { label: "WSH", money: 71, bets: 48 },
      ],
    },
    keyStats: [
      { label: "Starter (ERA)", value: "Ragans 3.10", sub: "vs Gore 3.45" },
      { label: "Bullpen", value: "KC top-8", sub: "WSH 22nd" },
      { label: "Lineup vs LHP", value: "KC .748 OPS", sub: "WSH .701" },
      { label: "Weather", value: "Calm", sub: "78°F, wind 4mph in" },
    ],
    why: "Model gives KC a clear edge on starter + bullpen quality the market hasn't fully priced.",
    risk: "Sharp money sits on WSH despite light public backing — fade risk if the line keeps drifting.",
  },
  total: {
    verdict: "Lean",
    verdictTone: "lean",
    pick: "Over 10.5",
    modelEdge: { model: "12.0", market: "10.5", source: "betmgm", delta: "+1.5 runs", deltaTone: "pos" },
    splits: { money: 61, bets: 57, delta: 4 },
    oddsMove: { open: -110, prev: -105, current: -108, locked: false },
    lineRow: { label: "TOTAL", value: "Over 9.5 → 10.5" },
    marketRead: { tone: "green", text: "Market moved toward our side" },
    confidence: { modelPct: 63, marketPct: 50 },
    pulse: {
      kind: "bars",
      sides: [
        { label: "Over", money: 61, bets: 57 },
        { label: "Under", money: 39, bets: 43 },
      ],
    },
    keyStats: [
      { label: "Weather", value: "Hot, wind out", sub: "+0.4 runs" },
      { label: "Park factor", value: "WSH 106", sub: "slight hitter" },
      { label: "Lineup vs starter", value: "Both above-avg", sub: "vs LHP" },
      { label: "Bullpen usage", value: "Both taxed", sub: "3-day load high" },
      { label: "Scoring env.", value: "Elevated", sub: "12.0 proj total" },
    ],
    why: "Projection sits a run and a half over the number; the line moving up to 10.5 confirms our Over read.",
    risk: "If wind flips in, run environment cools and the edge compresses quickly.",
  },
  first_inning: {
    verdict: "Watchlist",
    verdictTone: "watchlist",
    pick: "YRFI -139",
    modelEdge: { model: "58%", market: "52%", source: "betmgm", delta: "+6.0 pp", deltaTone: "pos" },
    splits: { unavailable: true },
    oddsMove: { open: -125, current: -139, locked: false },
    lineRow: { label: "1ST INNING LINE", value: "YRFI -139" },
    marketRead: { tone: "neutral", text: "Public-heavy, sharp unconfirmed" },
    confidence: { modelPct: 58, marketPct: 52 },
    pulse: {
      kind: "note",
      text: "First-inning public splits are not offered by our data providers.",
    },
    keyStats: [
      { label: "Proj. 1st-inn runs", value: "0.62", sub: "combined" },
      { label: "Starter 1st-inn ERA", value: "Ragans 2.40", sub: "Gore 3.10" },
      { label: "Starter 1st-inn WHIP", value: "Ragans 1.05", sub: "Gore 1.28" },
      { label: "Top-of-order", value: "WSH 1-3 hot", sub: ".310 last 14" },
      { label: "Lineup risk", value: "Confirmed", sub: "both posted" },
    ],
    why: "Both top-of-orders are producing and Gore has run a higher first-inning WHIP — leans toward a run scoring early.",
    risk: "First-inning markets are thin; one scratch to the top of the order moves this materially.",
  },
};

// ─── Small shared primitives ────────────────────────────────────────────
function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function EvLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1">{children}</p>
  );
}

function Divider() {
  return <div className="border-t border-white/[0.05]" />;
}

/** Tiny inline signal sign for Market Read — small, never a big badge. */
function SignalIcon({ tone }: { tone: SignalTone }) {
  if (tone === "green") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <circle cx="6" cy="6" r="6" fill="rgba(16,185,129,0.18)" />
        <path d="M3.4 6.2l1.7 1.7L8.7 4.3" stroke="#34d399" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "yellow") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <path d="M6 1.2l5 8.6H1z" fill="rgba(245,158,11,0.18)" stroke="#fbbf24" strokeWidth="1" strokeLinejoin="round" />
        <rect x="5.4" y="4.5" width="1.2" height="2.6" rx="0.6" fill="#fbbf24" />
        <circle cx="6" cy="8.2" r="0.7" fill="#fbbf24" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <circle cx="6" cy="6" r="5.4" fill="rgba(167,139,250,0.16)" stroke="rgba(167,139,250,0.55)" strokeWidth="1" />
      <circle cx="6" cy="6" r="1.5" fill="#a78bfa" />
    </svg>
  );
}

/**
 * Odds Move trail: open → prev → current/lock. Visual, not prose.
 * Drops prev when it equals open or current; collapses to 2 (open → current)
 * or 1 (current only) point. Never renders null/NaN/blank arrows.
 */
function OddsMoveTrail({ open, prev, current, locked }: MarketMock["oddsMove"]) {
  const pts: Array<{ v: number; label: string }> = [];
  if (isNum(open)) pts.push({ v: open, label: "OPEN" });
  if (isNum(prev) && prev !== open && prev !== current) pts.push({ v: prev, label: "PREV" });
  if (isNum(current)) pts.push({ v: current, label: locked ? "LOCK" : "CURRENT" });
  if (pts.length === 0) return null;
  return (
    <div>
      <EvLabel>Odds Move</EvLabel>
      <div className="flex items-end gap-1.5">
        {pts.map((p, i) => (
          <div key={p.label} className="flex items-end gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-gray-600 text-[13px] pb-3 leading-none">→</span>}
            <div className="flex flex-col items-center">
              <span className="tabular-nums font-bold text-[14px] text-gray-100 leading-tight">{fmtOdds(p.v)}</span>
              <span className="text-[8px] uppercase tracking-[0.12em] text-gray-500 mt-0.5">{p.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single money/bets split bar pair for one side. */
function SplitBars({ label, money, bets }: { label: string; money: number; bets: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="font-semibold text-gray-300">{label}</span>
        <span className="tabular-nums text-gray-500">
          <span className="text-gray-300">{money}%</span> money · <span className="text-gray-300">{bets}%</span> bets
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] uppercase tracking-wide text-gray-600 w-9">money</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
          <div className="h-full rounded-full bg-violet-400/70" style={{ width: `${money}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] uppercase tracking-wide text-gray-600 w-9">bets</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
          <div className="h-full rounded-full bg-sky-400/55" style={{ width: `${bets}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Top market cards (also the review toggle) ──────────────────────────
const MARKET_LABEL: Record<MarketKey, string> = {
  moneyline: "Moneyline",
  total: "Total",
  first_inning: "1st Inning",
};

function TopMarketCards({ selected, onSelect }: { selected: MarketKey; onSelect: (m: MarketKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(Object.keys(MARKET_LABEL) as MarketKey[]).map((k) => {
        const m = MOCK[k];
        const active = k === selected;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onSelect(k)}
            className={
              "text-left rounded-lg border px-3 py-2 transition-colors " +
              (active
                ? "border-violet-400/55 bg-violet-500/[0.14] shadow-[inset_0_0_0_1px_rgba(167,139,250,0.10)]"
                : "border-white/[0.06] bg-white/[0.02] hover:border-violet-400/30 hover:bg-violet-500/[0.05]")
            }
          >
            <div className="flex items-center justify-between">
              <span className={"text-[10px] uppercase tracking-[0.14em] font-bold " + (active ? "text-violet-100" : "text-gray-400")}>
                {MARKET_LABEL[k]}
              </span>
              <span className={"text-[9px] uppercase tracking-wide font-bold " + (active ? "text-violet-300" : "text-gray-600")}>
                {m.verdict}
              </span>
            </div>
            <div className="mt-1 text-[13px] font-bold text-gray-100 tabular-nums">{m.pick}</div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Column 1: Quick Read ───────────────────────────────────────────────
function QuickReadCol({ m }: { m: MarketMock }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-2.5">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-emerald-400/60" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-emerald-200/75">Quick Read</p>
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
        <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-gray-500 mb-1">The Pick</p>
        <p className="text-[18px] font-black text-white leading-tight" style={{ letterSpacing: "-0.01em" }}>{m.pick}</p>
        <p className="text-[11px] text-violet-300 font-semibold mt-0.5">{m.verdict}</p>
      </div>
      <p className="mt-3 text-[12.5px] text-gray-300 leading-relaxed">{m.why}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
          <p className="text-[8.5px] uppercase tracking-[0.14em] font-bold text-gray-500 mb-0.5">Model</p>
          <p className="text-[15px] font-bold text-emerald-300 tabular-nums">{m.modelEdge.model}</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
          <p className="text-[8.5px] uppercase tracking-[0.14em] font-bold text-gray-500 mb-0.5">Market</p>
          <p className="text-[15px] font-bold text-gray-300 tabular-nums">{m.modelEdge.market}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Column 2: Supporting Evidence (ONE vertical column) ────────────────
function SupportingEvidenceCol({ marketKey, m }: { marketKey: MarketKey; m: MarketMock }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-2.5">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/60" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/75">Supporting Evidence</p>
      </div>

      <div className="space-y-2.5">
        {/* Edge Stack (compact) */}
        <div className="rounded-lg border border-violet-400/15 bg-violet-500/[0.04] px-3 py-2">
          <EvLabel>Edge Stack</EvLabel>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-gray-300">Model favors our side</span>
            <span className={"text-[14px] font-bold tabular-nums " + (m.modelEdge.deltaTone === "pos" ? "text-emerald-300" : "text-amber-300")}>{m.modelEdge.delta}</span>
          </div>
        </div>

        {/* Model Edge — strongest evidence row; source tucked in, no BOOK row */}
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
          <EvLabel>Model Edge</EvLabel>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-gray-200">
              Model <span className="font-bold text-emerald-300 tabular-nums">{m.modelEdge.model}</span>
              <span className="text-gray-600 mx-1">vs</span>
              Market <span className="font-bold text-gray-200 tabular-nums">{m.modelEdge.market}</span>
              <span className="text-gray-600"> · </span>
              <span className="text-gray-500">{m.modelEdge.source}</span>
            </span>
            <span className={"text-[14px] font-bold tabular-nums shrink-0 " + (m.modelEdge.deltaTone === "pos" ? "text-emerald-300" : "text-amber-300")}>{m.modelEdge.delta}</span>
          </div>
        </div>

        <Divider />

        {/* Splits quick summary (renamed from MONEY VS BETS) */}
        <div>
          <EvLabel>Splits</EvLabel>
          {"unavailable" in m.splits ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-gray-400">Public split not offered for first-inning markets</span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">unavailable</span>
            </div>
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-gray-300 tabular-nums">
                Money <span className="font-semibold text-gray-200">{m.splits.money}%</span>
                <span className="text-gray-600 mx-1">/</span>
                Bets <span className="font-semibold text-gray-200">{m.splits.bets}%</span>
              </span>
              <span className={"text-[13px] font-bold tabular-nums " + (m.splits.delta < 0 ? "text-amber-300" : "text-emerald-300")}>
                {m.splits.delta > 0 ? `+${m.splits.delta}` : m.splits.delta}
              </span>
            </div>
          )}
        </div>

        <Divider />

        {/* Odds Move trail */}
        <OddsMoveTrail {...m.oddsMove} />

        <Divider />

        {/* Market-specific line row */}
        <div>
          <EvLabel>{m.lineRow.label}</EvLabel>
          <p className="text-[13.5px] font-bold text-gray-100 tabular-nums">{m.lineRow.value}</p>
        </div>

        <Divider />

        {/* Market Read with tiny signal icon */}
        <div>
          <EvLabel>Market Read</EvLabel>
          <div className="flex items-center gap-1.5">
            <SignalIcon tone={m.marketRead.tone} />
            <span className="text-[12.5px] text-gray-300">{m.marketRead.text}</span>
          </div>
        </div>

        <Divider />

        {/* Confidence vs Market */}
        <div>
          <EvLabel>Confidence vs Market</EvLabel>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] uppercase tracking-wide text-gray-600 w-12">model</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${m.confidence.modelPct}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-gray-400 w-8 text-right">{m.confidence.modelPct}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] uppercase tracking-wide text-gray-600 w-12">market</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                <div className="h-full rounded-full bg-gray-400/50" style={{ width: `${m.confidence.marketPct}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-gray-400 w-8 text-right">{m.confidence.marketPct}%</span>
            </div>
          </div>
        </div>

        <Divider />

        {/* Market Pulse / Public Splits */}
        <div>
          <EvLabel>Market Pulse · Public Splits</EvLabel>
          {m.pulse.kind === "bars" ? (
            <div className="space-y-2.5 mt-1">
              {m.pulse.sides.map((s) => (
                <SplitBars key={s.label} label={s.label} money={s.money} bets={s.bets} />
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-1.5 mt-0.5">
              <SignalIcon tone="neutral" />
              <span className="text-[12px] text-gray-400 leading-snug">{m.pulse.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Column 3: Key Stats & Notes (market-specific) ──────────────────────
function KeyStatsNotesCol({ m }: { m: MarketMock }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-2.5">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-sky-400/55" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-sky-200/70">Key Stats &amp; Notes</p>
      </div>

      <div className="space-y-1.5">
        {m.keyStats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 odd:bg-white/[0.015]">
            <span className="text-[11px] text-gray-500">{s.label}</span>
            <span className="text-right">
              <span className="text-[12.5px] font-semibold text-gray-200 tabular-nums">{s.value}</span>
              {s.sub && <span className="block text-[10px] text-gray-500 tabular-nums">{s.sub}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.04] px-3 py-2">
          <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-emerald-300/80 mb-0.5">Why</p>
          <p className="text-[12px] text-gray-300 leading-snug">{m.why}</p>
        </div>
        <div className="rounded-lg border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2">
          <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-amber-300/80 mb-0.5">Risk</p>
          <p className="text-[12px] text-gray-300 leading-snug">{m.risk}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main mockup card ───────────────────────────────────────────────────
export default function SelectedEdgeMockup() {
  const [market, setMarket] = useState<MarketKey>("moneyline");
  const m = MOCK[market];

  return (
    <section
      aria-label="Selected Edge (mockup)"
      className="relative bg-[#0D0D14] bg-gradient-to-b from-violet-500/[0.045] via-white/[0.005] to-black/[0.18] border border-violet-400/40 rounded-xl overflow-hidden shadow-[0_12px_36px_-12px_rgba(167,139,250,0.32),0_0_0_1px_rgba(167,139,250,0.10),inset_0_1px_0_0_rgba(167,139,250,0.10)]"
    >
      {/* Header */}
      <div className="px-5 pt-3.5 pb-3 border-b border-white/[0.05] bg-gradient-to-r from-violet-500/[0.07] via-violet-500/[0.015] to-transparent">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85" />
          <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/95">Selected Edge</h2>
          <span className="ml-2 text-[16px] font-bold text-gray-100">
            {GAME.away} <span className="text-gray-700 font-normal mx-0.5">@</span> {GAME.home}
          </span>
          <span className="text-[11px] text-gray-500 tabular-nums ml-2">{GAME.time}</span>
        </div>
        <div className="mt-3">
          <TopMarketCards selected={market} onSelect={setMarket} />
        </div>
      </div>

      {/* Body — 3 columns: Quick Read | Supporting Evidence | Key Stats & Notes */}
      <div className="px-4 sm:px-5 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,300px)] gap-5">
          <QuickReadCol m={m} />
          <SupportingEvidenceCol marketKey={market} m={m} />
          <KeyStatsNotesCol m={m} />
        </div>
      </div>
    </section>
  );
}
