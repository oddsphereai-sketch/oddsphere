/**
 * SelectedEdgeMockup — DESIGN-REVIEW ONLY (2026-06-17, v2 from reference image).
 *
 * Faithful, self-contained mockup of the redesigned Daily Edge → Selected Edge
 * "full read" so the layout/polish can be approved BEFORE any change to the
 * live reader. Hardcoded KC @ WSH sample data; toggles ML / Total / 1st Inning.
 * Renders nothing real — no DTO, no model/grading/tracking/DB touch. Rendered
 * by /lab/selected-edge-preview. Delete freely after approval.
 *
 * Layout (3 columns under the market-card row):
 *   Quick Read  |  Supporting Evidence (ONE column)  |  Key Stats & Notes
 */

"use client";

import { useState } from "react";

type MarketKey = "moneyline" | "total" | "first_inning";
type SignalTone = "green" | "yellow" | "neutral";
type Delta = "pos" | "neg" | "neutral";

const GRADE_LADDER = ["NO PLAY", "CAUTION", "WATCHLIST", "LEAN", "BEST ANGLE"] as const;

// ─── Sample data: KC @ WSH ──────────────────────────────────────────────
const GAME = {
  away: "KC",
  home: "WSH",
  awayColor: "#004687",
  homeColor: "#AB0003",
  awayPitcher: "Luinder Avila (RHP)",
  homePitcher: "Zack Littell (RHP)",
  time: "1:05 PM",
};

type Stat =
  | { kind: "teams"; label: string; kc: string; wsh: string; tag?: string }
  | { kind: "single"; label: string; value: string; tag?: string };

type MarketMock = {
  tab: { label: string; pick: string; pct: number };
  action: { label: string; tone: SignalTone };
  quick: {
    projLabel: string;
    projAway: string;
    projHome: string;
    bigPick: string;
    gauge: number;
    probLabel: string;
    prob: string;
    edge: string;
    edgeTone: Delta;
    rec: string;
    odds: string;
    mkt: string;
    read: string;
    caution: string;
    gradeIndex: number;
  };
  ev: {
    sub: string;
    modelEdge: { model: string; market: string; source: string; delta: string; deltaTone: Delta };
    book: string;
    splits: { money: number; bets: number; delta: number } | { unavailable: string };
    oddsMove: { open?: number; prev?: number; current?: number; locked?: boolean };
    line: { label: string; value: string };
    marketRead: { tone: SignalTone; text: string };
    conf: { confidence: number; confNote: string; market: number; mktNote: string; edge: string; edgeNote: string; edgeTone: Delta };
    pulse:
      | { kind: "bars"; leftLabel: string; rightLabel: string; money: [number, number]; bets: [number, number] }
      | { kind: "note"; text: string };
  };
  stats: Stat[];
  why: string;
  risk: string;
};

const MOCK: Record<MarketKey, MarketMock> = {
  moneyline: {
    tab: { label: "Moneyline", pick: "WSH", pct: 57 },
    action: { label: "Watchlist", tone: "neutral" },
    quick: {
      projLabel: "Projected Score",
      projAway: "5.8",
      projHome: "6.3",
      bigPick: "WSH",
      gauge: 57,
      probLabel: "Win Prob",
      prob: "57%",
      edge: "No edge",
      edgeTone: "neutral",
      rec: "28",
      odds: "-135",
      mkt: "Moneyline",
      read: "Worth tracking: the model leans WSH on the moneyline at 57% confidence — the read is interesting but not clean enough to act on.",
      caution: "Where it gets less clean: nothing major, but tighter pricing post-lineup can change the math.",
      gradeIndex: 2,
    },
    ev: {
      sub: "Moneyline",
      modelEdge: { model: "55%", market: "55%", source: "betmgm", delta: "+0.0 pt", deltaTone: "neutral" },
      book: "Reference price from betmgm",
      splits: { money: 77, bets: 80, delta: -3 },
      oddsMove: { open: -135, prev: -143, current: -105, locked: false },
      line: { label: "Moneyline", value: "WSH -135" },
      marketRead: { tone: "neutral", text: "Public-heavy, sharp unconfirmed" },
      conf: { confidence: 55, confNote: "model prob", market: 55, mktNote: "betmgm", edge: "No edge", edgeNote: "model prob vs no-vig market", edgeTone: "neutral" },
      pulse: { kind: "bars", leftLabel: "WSH", rightLabel: "KC", money: [77, 23], bets: [80, 20] },
    },
    stats: [
      { kind: "teams", label: "Starter ERA", kc: "6.19", wsh: "5.32", tag: "WSH better" },
      { kind: "teams", label: "Bullpen quality", kc: "7% worse than lg avg", wsh: "League average" },
      { kind: "teams", label: "Lineup vs starter", kc: "League average", wsh: "+4% better" },
      { kind: "single", label: "Weather adjust", value: "Neutral" },
    ],
    why: "Driver: model's win-probability edge vs the market price.",
    risk: "Risk: late line moves or lineup changes can tighten the edge.",
  },
  total: {
    tab: { label: "Total", pick: "Over 10.5", pct: 57 },
    action: { label: "Caution", tone: "yellow" },
    quick: {
      projLabel: "Projected Score",
      projAway: "5.8",
      projHome: "6.3",
      bigPick: "Over 10.5",
      gauge: 57,
      probLabel: "Model Prob",
      prob: "57%",
      edge: "+8.4%",
      edgeTone: "pos",
      rec: "62",
      odds: "-105",
      mkt: "Total",
      read: "The model likes Over on the total at 57% confidence, but our signals conflict. Treat as caution, not a play.",
      caution: "One split source shows money pressure against the pick.",
      gradeIndex: 1,
    },
    ev: {
      sub: "Total",
      modelEdge: { model: "57%", market: "48%", source: "betmgm", delta: "+1.5 runs", deltaTone: "pos" },
      book: "Reference price from betmgm",
      splits: { money: 29, bets: 52, delta: -23 },
      oddsMove: { open: -115, prev: -143, current: -105, locked: false },
      line: { label: "Total", value: "9.5 → 10.5" },
      marketRead: { tone: "yellow", text: "Sharp money against our side" },
      conf: { confidence: 57, confNote: "model prob", market: 49, mktNote: "betmgm", edge: "+8.4 pp", edgeNote: "model prob vs no-vig market", edgeTone: "pos" },
      pulse: { kind: "bars", leftLabel: "Over", rightLabel: "Under", money: [29, 71], bets: [52, 48] },
    },
    stats: [
      { kind: "single", label: "Weather adjust", value: "Neutral" },
      { kind: "single", label: "Park factor", value: "Slightly hitter-friendly", tag: "+4% runs" },
      { kind: "teams", label: "Lineup vs starter", kc: "-2% worse", wsh: "+5% better" },
      { kind: "teams", label: "Bullpen usage", kc: "3rd game in 5 days", wsh: "Fully rested" },
      { kind: "single", label: "Scoring environment", value: "Above average", tag: "+6% runs" },
    ],
    why: "Driver: park and matchup factors push the total up.",
    risk: "Risk: sharp money and rising line suggest caution.",
  },
  first_inning: {
    tab: { label: "1st Inning", pick: "YRFI", pct: 52 },
    action: { label: "Lean", tone: "green" },
    quick: {
      projLabel: "Projected 1st Inning Runs",
      projAway: "1.80",
      projHome: "0.50",
      bigPick: "YRFI",
      gauge: 52,
      probLabel: "Model Prob",
      prob: "52%",
      edge: "-2.0%",
      edgeTone: "neg",
      rec: "15",
      odds: "-139",
      mkt: "1st Inning",
      read: "Soft lean toward YRFI on the first inning at 52% confidence. The model leans this way but it's not a hammer.",
      caution: "Where it gets less clean: lineup not yet confirmed — model used projected order.",
      gradeIndex: 3,
    },
    ev: {
      sub: "1st Inning",
      modelEdge: { model: "52%", market: "54%", source: "ballybet", delta: "-2.0 pt", deltaTone: "neg" },
      book: "Reference price from ballybet",
      splits: { unavailable: "Public split — not offered for first-inning markets" },
      oddsMove: { open: -124, current: -139, locked: false },
      line: { label: "1st Inning Line", value: "Over 0.5" },
      marketRead: { tone: "green", text: "Market moved toward our side" },
      conf: { confidence: 52, confNote: "model prob", market: 54, mktNote: "ballybet", edge: "-2.0 pp", edgeNote: "model prob vs no-vig market", edgeTone: "neg" },
      pulse: { kind: "note", text: "Public splits are not offered for first-inning markets — model, price, and projected order are the primary inputs." },
    },
    stats: [
      { kind: "single", label: "Projected 1st-inn runs", value: "1.06 combined", tag: "Toss-up" },
      { kind: "teams", label: "Starter 1st-inn ERA", kc: "24.75 (5 starts)", wsh: "1.80 (10 starts)", tag: "WSH better" },
      { kind: "teams", label: "Starter 1st-inn WHIP", kc: "3.25 (5 starts)", wsh: "0.50 (10 starts)", tag: "WSH better" },
      { kind: "teams", label: "Top-of-order matchup", kc: "Average", wsh: "Above average", tag: "WSH advantage" },
    ],
    why: "Driver: stronger top-of-order and better first-inning arms.",
    risk: "Risk: lineup not yet confirmed — model used projected order.",
  },
};

// ─── Primitives ─────────────────────────────────────────────────────────
function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function deltaClass(t: Delta): string {
  return t === "pos" ? "text-emerald-300" : t === "neg" ? "text-rose-300" : "text-gray-400";
}

function TeamBadge({ abbr, color }: { abbr: string; color: string }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[8.5px] font-black text-white shrink-0" style={{ background: color }}>
      {abbr}
    </span>
  );
}

function SignalIcon({ tone, size = 12 }: { tone: SignalTone; size?: number }) {
  if (tone === "green") {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <circle cx="6" cy="6" r="6" fill="rgba(16,185,129,0.18)" />
        <path d="M3.4 6.2l1.7 1.7L8.7 4.3" stroke="#34d399" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "yellow") {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <path d="M6 1.2l5 8.6H1z" fill="rgba(245,158,11,0.18)" stroke="#fbbf24" strokeWidth="1" strokeLinejoin="round" />
        <rect x="5.4" y="4.5" width="1.2" height="2.6" rx="0.6" fill="#fbbf24" />
        <circle cx="6" cy="8.2" r="0.7" fill="#fbbf24" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <circle cx="6" cy="6" r="5.4" fill="rgba(167,139,250,0.16)" stroke="rgba(167,139,250,0.55)" strokeWidth="1" />
      <circle cx="6" cy="6" r="1.5" fill="#a78bfa" />
    </svg>
  );
}

/** Small muted glyphs for the Supporting Evidence rows (decorative). */
function RowGlyph({ name }: { name: string }) {
  const s = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4 } as const;
  const common = "text-violet-300/55 shrink-0";
  switch (name) {
    case "model":
      return <svg {...s} className={common}><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.2" /></svg>;
    case "book":
      return <svg {...s} className={common}><rect x="3" y="3" width="10" height="10" rx="1.5" /><path d="M8 3v10" /></svg>;
    case "splits":
      return <svg {...s} className={common}><circle cx="5.5" cy="6" r="2" /><circle cx="10.5" cy="6" r="2" /><path d="M2.5 13c0-2 6-2 6 0M9.5 13c0-2 4-2 4 0" /></svg>;
    case "odds":
      return <svg {...s} className={common}><path d="M2 11l4-4 3 3 5-6" /><path d="M11 4h3v3" /></svg>;
    case "line":
      return <svg {...s} className={common}><path d="M3 8h10" /><circle cx="6" cy="8" r="1.4" fill="currentColor" /></svg>;
    case "read":
      return <svg {...s} className={common}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></svg>;
    default:
      return <svg {...s} className={common}><circle cx="8" cy="8" r="6" /></svg>;
  }
}

function ConfidenceGauge({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true" className="shrink-0">
      <circle cx="29" cy="29" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4.5" />
      <circle
        cx="29"
        cy="29"
        r={r}
        fill="none"
        stroke="#a78bfa"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 29 29)"
      />
      <text x="29" y="34" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">{value}</text>
    </svg>
  );
}

/** Odds Move trail: open → prev → current/lock. Drops redundant prev. */
function OddsMoveTrail({ open, prev, current, locked }: MarketMock["ev"]["oddsMove"]) {
  const pts: Array<{ v: number; label: string }> = [];
  if (isNum(open)) pts.push({ v: open, label: "OPEN" });
  if (isNum(prev) && prev !== open && prev !== current) pts.push({ v: prev, label: "PREV" });
  if (isNum(current)) pts.push({ v: current, label: locked ? "LOCK" : "CURRENT" });
  if (pts.length === 0) return null;
  return (
    <div className="flex items-end gap-1.5">
      {pts.map((p, i) => (
        <div key={p.label} className="flex items-end gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-gray-600 text-[12px] pb-3 leading-none">→</span>}
          <div className="flex flex-col items-center">
            <span className="tabular-nums font-bold text-[13px] text-gray-100 leading-tight">{fmtOdds(p.v)}</span>
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-gray-500 mt-0.5">{p.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PulseBar({ leftLabel, leftPct, rightLabel, rightPct, caption }: { leftLabel: string; leftPct: number; rightLabel: string; rightPct: number; caption: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[9.5px] text-gray-400 truncate w-20">{leftLabel}</span>
        <span className="text-[9.5px] tabular-nums text-gray-300 w-7 text-right">{leftPct}%</span>
        <div className="flex-1 h-2 rounded-full bg-sky-400/15 overflow-hidden">
          <div className="h-full bg-violet-400/65" style={{ width: `${leftPct}%` }} />
        </div>
        <span className="text-[9.5px] tabular-nums text-gray-300 w-7">{rightPct}%</span>
        <span className="text-[9.5px] text-gray-400 truncate w-20 text-right">{rightLabel}</span>
      </div>
      <p className="text-center text-[7.5px] uppercase tracking-[0.12em] text-gray-600 mt-0.5">{caption}</p>
    </div>
  );
}

// ─── Top market cards (also the review toggle) ──────────────────────────
function TopMarketCards({ selected, onSelect }: { selected: MarketKey; onSelect: (m: MarketKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(Object.keys(MOCK) as MarketKey[]).map((k) => {
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
              <span className={"text-[9.5px] uppercase tracking-[0.14em] font-bold " + (active ? "text-violet-100" : "text-gray-400")}>
                {m.tab.label}
              </span>
              {!active && m.action.tone !== "neutral" && <SignalIcon tone={m.action.tone} size={11} />}
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[13px] font-bold text-gray-100 tabular-nums">{m.tab.pick}</span>
              <span className={"text-[12px] font-bold tabular-nums " + (active ? "text-violet-200" : "text-gray-500")}>{m.tab.pct}%</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Column 1: Quick Read ───────────────────────────────────────────────
function QuickReadCol({ m }: { m: MarketMock }) {
  const q = m.quick;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-2.5">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-emerald-400/60" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-emerald-200/75">Quick Read</p>
      </div>

      {/* Teams + pitchers */}
      <div className="flex items-center gap-2">
        <TeamBadge abbr={GAME.away} color={GAME.awayColor} />
        <span className="text-[13px] font-bold text-gray-200">{GAME.away}</span>
        <span className="text-gray-600 text-[11px]">@</span>
        <span className="text-[13px] font-bold text-gray-200">{GAME.home}</span>
        <TeamBadge abbr={GAME.home} color={GAME.homeColor} />
      </div>
      <p className="text-[10.5px] text-gray-500 mt-1">{GAME.awayPitcher} <span className="text-gray-700">vs</span> {GAME.homePitcher}</p>

      {/* Projection */}
      <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
        <p className="text-[8.5px] uppercase tracking-[0.14em] font-bold text-gray-500 mb-1">{q.projLabel}</p>
        <p className="text-[14px] font-black text-white tabular-nums">
          <span className="text-[10px] text-gray-500 font-bold mr-1">{GAME.away}</span>{q.projAway}
          <span className="text-gray-700 mx-2">—</span>
          {q.projHome}<span className="text-[10px] text-gray-500 font-bold ml-1">{GAME.home}</span>
        </p>
      </div>

      {/* Big pick + gauge */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[22px] font-black text-white leading-none" style={{ letterSpacing: "-0.01em" }}>{q.bigPick}</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[10px]">
            <span><span className="uppercase tracking-wide text-gray-500 mr-1">{q.probLabel}</span><span className="font-bold text-gray-100 tabular-nums">{q.prob}</span></span>
            <span><span className="uppercase tracking-wide text-gray-500 mr-1">edge</span><span className={"font-bold tabular-nums " + deltaClass(q.edgeTone)}>{q.edge}</span></span>
            <span><span className="uppercase tracking-wide text-gray-500 mr-1">rec</span><span className="font-bold text-gray-100 tabular-nums">{q.rec}</span></span>
          </div>
          <p className="text-[10px] text-gray-400 tabular-nums mt-0.5">{q.odds} <span className="uppercase tracking-wide text-gray-600">{q.mkt}</span></p>
        </div>
        <ConfidenceGauge value={q.gauge} />
      </div>

      {/* Read + caution */}
      <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">{q.read}</p>
      <div className="mt-2 flex items-start gap-1.5">
        <SignalIcon tone="yellow" />
        <p className="text-[11.5px] text-amber-200/80 leading-snug">{q.caution}</p>
      </div>

      {/* Play grade ladder */}
      <div className="mt-3 pt-2.5 border-t border-white/[0.05]">
        <p className="text-[8.5px] uppercase tracking-[0.14em] font-bold text-gray-500 mb-1.5">Play Grade</p>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[9.5px] uppercase tracking-[0.08em]">
          {GRADE_LADDER.map((g, i) => (
            <span key={g} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-700">·</span>}
              <span className={i === q.gradeIndex ? "font-bold text-violet-200" : "text-gray-600"}>{g}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Supporting Evidence row helper ─────────────────────────────────────
function EvRow({ glyph, label, children, right, rightTone }: { glyph: string; label: string; children: React.ReactNode; right?: string; rightTone?: Delta }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <RowGlyph name={glyph} />
      <span className="text-[8.5px] uppercase tracking-[0.1em] font-bold text-gray-500 w-[68px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-[11.5px] text-gray-300">{children}</div>
      {right !== undefined && <span className={"text-[12px] font-bold tabular-nums shrink-0 " + (rightTone ? deltaClass(rightTone) : "text-gray-400")}>{right}</span>}
    </div>
  );
}

// ─── Column 2: Supporting Evidence (ONE vertical column) ────────────────
function SupportingEvidenceCol({ m }: { m: MarketMock }) {
  const ev = m.ev;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-1">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/60" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/75">Supporting Evidence</p>
      </div>
      <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-gray-500/80 mb-1.5">Edge Stack · {ev.sub}</p>

      <div className="divide-y divide-white/[0.04]">
        <EvRow glyph="model" label="Model Edge" right={ev.modelEdge.delta} rightTone={ev.modelEdge.deltaTone}>
          Model <span className="font-bold text-gray-100 tabular-nums">{ev.modelEdge.model}</span>
          <span className="text-gray-600"> · </span>Market <span className="font-bold text-gray-100 tabular-nums">{ev.modelEdge.market}</span>
          <span className="text-gray-600"> · </span><span className="text-gray-500">{ev.modelEdge.source}</span>
        </EvRow>

        <EvRow glyph="book" label="Book"><span className="text-gray-400">{ev.book}</span></EvRow>

        <EvRow
          glyph="splits"
          label="Splits"
          right={"unavailable" in ev.splits ? "Unavailable" : (ev.splits.delta > 0 ? `+${ev.splits.delta}` : `${ev.splits.delta}`)}
          rightTone={"unavailable" in ev.splits ? "neutral" : ev.splits.delta < 0 ? "neg" : "pos"}
        >
          {"unavailable" in ev.splits ? (
            <span className="text-gray-400">{ev.splits.unavailable}</span>
          ) : (
            <span className="tabular-nums">Money <span className="font-semibold text-gray-200">{ev.splits.money}%</span> <span className="text-gray-600">/</span> Bets <span className="font-semibold text-gray-200">{ev.splits.bets}%</span></span>
          )}
        </EvRow>

        <EvRow glyph="odds" label="Odds Move"><OddsMoveTrail {...ev.oddsMove} /></EvRow>

        <EvRow glyph="line" label={ev.line.label}><span className="font-bold text-gray-100 tabular-nums">{ev.line.value}</span></EvRow>

        <EvRow glyph="read" label="Market Read">
          <span className="flex items-center gap-1.5"><SignalIcon tone={ev.marketRead.tone} /><span>{ev.marketRead.text}</span></span>
        </EvRow>
      </div>

      {/* Confidence vs Market box */}
      <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
        <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">Confidence vs Market</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-gray-500 w-16">Confidence</span>
            <span className="text-[11px] tabular-nums font-bold text-gray-100 w-8">{ev.conf.confidence}%</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden"><div className="h-full bg-emerald-400/65" style={{ width: `${ev.conf.confidence}%` }} /></div>
            <span className="text-[9px] text-gray-600 w-16 text-right">{ev.conf.confNote}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-gray-500 w-16">Market</span>
            <span className="text-[11px] tabular-nums font-bold text-gray-100 w-8">{ev.conf.market}%</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden"><div className="h-full bg-gray-400/50" style={{ width: `${ev.conf.market}%` }} /></div>
            <span className="text-[9px] text-gray-600 w-16 text-right">{ev.conf.mktNote}</span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[9px] uppercase tracking-wide text-gray-500 w-16">Edge</span>
            <span className={"text-[11px] tabular-nums font-bold " + deltaClass(ev.conf.edgeTone)}>{ev.conf.edge}</span>
            <span className="text-[9px] text-gray-600 ml-auto">{ev.conf.edgeNote}</span>
          </div>
        </div>
      </div>

      {/* Market Pulse box */}
      <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
        <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-1.5">Market Pulse · Public Splits</p>
        {ev.pulse.kind === "bars" ? (
          <div className="space-y-2">
            <PulseBar leftLabel={ev.pulse.leftLabel} leftPct={ev.pulse.money[0]} rightLabel={ev.pulse.rightLabel} rightPct={ev.pulse.money[1]} caption="% of Money" />
            <PulseBar leftLabel={ev.pulse.leftLabel} leftPct={ev.pulse.bets[0]} rightLabel={ev.pulse.rightLabel} rightPct={ev.pulse.bets[1]} caption="% of Bets" />
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <SignalIcon tone="neutral" />
            <div>
              <p className="text-[11px] font-semibold text-gray-300">Not available for first-inning market</p>
              <p className="text-[10.5px] text-gray-500 leading-snug mt-0.5">{ev.pulse.text}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Column 3: Key Stats & Notes (market-specific) ──────────────────────
function StatLine({ s }: { s: Stat }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.06em] text-gray-500 w-24 shrink-0 leading-tight pt-0.5">{s.label}</span>
      <div className="flex-1 min-w-0">
        {s.kind === "teams" ? (
          <div className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-gray-500 w-9">{GAME.away}</span>
              <span className="text-[11.5px] font-semibold text-gray-200 tabular-nums text-right flex-1">{s.kc}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-gray-500 w-9">{GAME.home}</span>
              <span className="text-[11.5px] font-semibold text-gray-200 tabular-nums text-right flex-1">{s.wsh}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] font-semibold text-gray-200 text-right">{s.value}</p>
        )}
      </div>
      {s.tag && <span className="text-[10px] font-bold text-emerald-300 shrink-0 w-20 text-right leading-tight pt-0.5">{s.tag}</span>}
    </div>
  );
}

function KeyStatsNotesCol({ m }: { m: MarketMock }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] mb-1.5">
        <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-sky-400/55" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-sky-200/70">Key Stats &amp; Notes</p>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {m.stats.map((s) => <StatLine key={s.label} s={s} />)}
      </div>

      <div className="mt-3 pt-2 border-t border-white/[0.06]">
        <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-gray-500/85 mb-2">Market Notes</p>
        <div className="space-y-2">
          <div>
            <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-emerald-300/80 mb-0.5">Why</p>
            <p className="text-[11.5px] text-gray-300 leading-snug">{m.why}</p>
          </div>
          <div>
            <p className="text-[8.5px] uppercase tracking-[0.16em] font-bold text-amber-300/80 mb-0.5">Risk</p>
            <p className="text-[11.5px] text-gray-300 leading-snug">{m.risk}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main mockup card ───────────────────────────────────────────────────
function ActionChip({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-[9px] uppercase tracking-[0.12em] font-bold text-gray-300">
      <SignalIcon tone={tone} size={10} />
      {label}
    </span>
  );
}

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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span aria-hidden="true" className="w-1 h-3.5 rounded-full bg-violet-400/85" />
            <h2 className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-violet-200/95">Selected Edge</h2>
            <span className="hidden sm:inline text-[11px] text-gray-500 ml-1">Click any market below to update this read.</span>
          </div>
          <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-violet-400/60 bg-violet-500/[0.18] text-[10px] uppercase tracking-[0.14em] font-bold text-violet-50 whitespace-nowrap">
            Collapse read <span aria-hidden="true">↑</span>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[16px] font-bold text-gray-100">
            {GAME.away} <span className="text-gray-700 font-normal mx-0.5">@</span> {GAME.home}
          </span>
          <ActionChip label={m.action.label} tone={m.action.tone} />
          <span className="text-[11px] text-gray-500 tabular-nums">{GAME.time}</span>
        </div>
        <div className="mt-3">
          <TopMarketCards selected={market} onSelect={setMarket} />
        </div>
      </div>

      {/* Body — 3 columns */}
      <div className="px-4 sm:px-5 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(230px,290px)_minmax(0,1fr)_minmax(230px,320px)] gap-5">
          <QuickReadCol m={m} />
          <SupportingEvidenceCol m={m} />
          <KeyStatsNotesCol m={m} />
        </div>
      </div>
    </section>
  );
}
