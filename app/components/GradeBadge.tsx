/**
 * GradeBadge — V2.1 6.3 final-grade pill.
 *
 * Renders one of the 7 grade categories with its canonical emoji, label, and
 * color. The `context` prop selects between Daily Edge and Player Props
 * label vocabularies per V2.1 spec Part 6 — four grades have surface-
 * specific names (Best Signal vs Elite Prop, Sharp Confirmed vs Confirmed
 * Edge, Market-Led Signal vs Market-Led, Sharp Conflict vs Caution). The
 * three "neutral" grades (Model Only, Market Watch, Public Smoke) share
 * one label on both surfaces.
 *
 * Colors per V2.1 6.3:
 *   best_signal / sharp_confirmed → emerald-500 (#22C55E)
 *   market_led / market_watch     → sky-500     (#38BDF8) cyan
 *   model_only                    → gray-500    (#94A3B8)
 *   public_smoke                  → violet-500  (#A78BFA)
 *   sharp_conflict                → amber-500   (#F59E0B)
 *
 * Backgrounds tint at 15% opacity, borders at 40%, so the pill reads on
 * the dark Lab + public marketing surfaces alike.
 */

import type { Grade } from "@/lib/types/domain/Grade";

export type GradeContext = "daily-edge" | "player-props";

type GradeMeta = {
  emoji: string;
  text: string;
  bg: string;
  border: string;
};

/**
 * Visual treatment for the "No Pick" state — fires when the badge receives
 * `grade={null}` (Fix 1.3, framework §"Edge Case Handling — Model didn't
 * pick the market"). Distinct from every Grade variant: muted gray, em-dash
 * glyph, no emoji. The label is "No Pick" in both surface contexts —
 * Daily Edge and Player Props use the same label since "no model
 * prediction generated" is the same concept on both surfaces.
 */
const NO_PICK_META: GradeMeta = {
  emoji: "—",
  text: "text-gray-400",
  bg: "bg-gray-500/10",
  border: "border-gray-500/30",
};

const NO_PICK_LABEL = "No Pick";

/**
 * Emoji + color treatment per grade — invariant across surface contexts.
 */
const META: Record<Grade, GradeMeta> = {
  best_signal: {
    emoji: "🔥",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  sharp_confirmed: {
    emoji: "✅",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  market_led: {
    emoji: "⚡",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  model_only: {
    emoji: "📊",
    text: "text-gray-300",
    bg: "bg-gray-500/15",
    border: "border-gray-500/40",
  },
  market_watch: {
    emoji: "👀",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  public_smoke: {
    emoji: "💨",
    text: "text-violet-300",
    bg: "bg-violet-500/15",
    border: "border-violet-500/40",
  },
  sharp_conflict: {
    emoji: "⚠️",
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
  },
};

/**
 * Surface-specific label maps. V2.1 Part 6 mandates different names for
 * Daily Edge vs Player Props on four of the seven grades — the other three
 * share one label.
 */
const LABELS: Record<GradeContext, Record<Grade, string>> = {
  "daily-edge": {
    best_signal: "Best Signal",
    sharp_confirmed: "Sharp Confirmed",
    market_led: "Market-Led Signal",
    model_only: "Model Only",
    market_watch: "Market Watch",
    public_smoke: "Public Smoke",
    sharp_conflict: "Sharp Conflict",
  },
  "player-props": {
    best_signal: "Elite Prop",
    sharp_confirmed: "Confirmed Edge",
    market_led: "Market-Led",
    model_only: "Model Only",
    market_watch: "Market Watch",
    public_smoke: "Public Smoke",
    sharp_conflict: "Caution",
  },
};

/**
 * Display label for an optional market suffix appended to the badge text
 * (V2.1.1 / Phase 6.3.5d clarity item 1). Used on the Daily Edge card
 * headline to surface which market the headline grade is "about" —
 * "✅ Sharp Confirmed · Moneyline" reads more honestly than just
 * "✅ Sharp Confirmed" when the row's other markets carry different grades.
 *
 * Per-tile badges (emojiOnly mode) ignore this prop — the tile's market
 * is implicit from its position in the 3-tile grid.
 */
const MARKET_LABEL: Record<
  "moneyline" | "total" | "first_inning_total",
  string
> = {
  moneyline: "Moneyline",
  total: "Total",
  first_inning_total: "1st Inning",
};

const SIZE_CLASSES = {
  sm: "text-[11px] px-2 py-0.5 gap-1",
  md: "text-xs px-2.5 py-1 gap-1.5",
} as const;

export type GradeBadgeProps = {
  /**
   * Fix 1.3 (Gap-21/26/27): accepts `null` for the "No Pick" / "Unavailable"
   * state per SHARP_SIGNAL_FRAMEWORK.md §"Edge Case Handling". When null the
   * badge renders muted gray with em-dash glyph and "No Pick" label; the
   * `market` suffix is suppressed since there's no grade to qualify.
   */
  grade: Grade | null;
  /**
   * Which surface vocabulary to render. Daily Edge uses "Best Signal" /
   * "Market-Led Signal" / etc.; Player Props uses "Elite Prop" / "Market-Led" /
   * etc. per V2.1 Part 6 table. Ignored when grade is null — "No Pick" is
   * the same label on both surfaces.
   */
  context: GradeContext;
  size?: keyof typeof SIZE_CLASSES;
  /** Show only the emoji (compact mode). Useful in dense tables and on
   * per-tile badges where the market is implicit. */
  emojiOnly?: boolean;
  /**
   * Optional market suffix. When provided AND emojiOnly is false AND grade
   * is non-null, the badge text reads "{grade label} · {market label}".
   * Used on the Daily Edge card headline (V2.1.1). NULL or absent → no
   * suffix. Also suppressed when grade is null.
   */
  market?: "moneyline" | "total" | "first_inning_total" | null;
};

export default function GradeBadge({
  grade,
  context,
  size = "md",
  emojiOnly = false,
  market,
}: GradeBadgeProps) {
  const meta = grade === null ? NO_PICK_META : META[grade];
  const label = grade === null ? NO_PICK_LABEL : LABELS[context][grade];
  // Suppress market suffix on no-pick: a market qualifier would imply
  // there IS market context to qualify, which is the dishonesty the
  // framework is trying to prevent.
  const marketSuffix =
    market && grade !== null ? ` · ${MARKET_LABEL[market]}` : "";
  return (
    <span
      role="status"
      aria-label={`Grade: ${label}${marketSuffix}`}
      className={[
        "inline-flex items-center font-semibold tracking-tight rounded-full border whitespace-nowrap",
        SIZE_CLASSES[size],
        meta.text,
        meta.bg,
        meta.border,
      ].join(" ")}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      {!emojiOnly && (
        <span>
          {label}
          {marketSuffix}
        </span>
      )}
    </span>
  );
}

/** All 7 grades in canonical priority order — exported for the dev preview + legend. */
export const ALL_GRADES: Grade[] = [
  "best_signal",
  "sharp_confirmed",
  "market_led",
  "model_only",
  "market_watch",
  "public_smoke",
  "sharp_conflict",
];
