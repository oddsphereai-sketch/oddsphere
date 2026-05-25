/**
 * GradeBadge — V2.1 6.3 final-grade pill.
 *
 * Renders one of the 7 grade categories with its canonical emoji, label, and
 * color. Built standalone in Phase 6.3d; wired into Daily Edge in 6.4 and
 * Player Props in 6.5.
 *
 * Colors per V2.1 6.3:
 *   best_signal / sharp_confirmed → green-500   (#22C55E)
 *   market_led / market_watch     → sky-400     (#38BDF8)  cyan
 *   model_only                    → gray-400    (#94A3B8)
 *   public_smoke                  → violet-400  (#A78BFA)
 *   sharp_conflict                → amber-500   (#F59E0B)
 *
 * Backgrounds use a tinted layer on top of the dark surface so the pill
 * reads on the dark Lab + public marketing surfaces alike.
 */

import type { Grade } from "@/lib/types/domain/Grade";

type GradeMeta = {
  emoji: string;
  label: string;
  /** Foreground text color (Tailwind). */
  text: string;
  /** Background tint (Tailwind, with /15 opacity). */
  bg: string;
  /** Border color. */
  border: string;
};

const META: Record<Grade, GradeMeta> = {
  best_signal: {
    emoji: "🔥",
    label: "Best Signal",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  sharp_confirmed: {
    emoji: "✅",
    label: "Sharp Confirmed",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  market_led: {
    emoji: "⚡",
    label: "Market-Led",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  model_only: {
    emoji: "📊",
    label: "Model Only",
    text: "text-gray-300",
    bg: "bg-gray-500/15",
    border: "border-gray-500/40",
  },
  market_watch: {
    emoji: "👀",
    label: "Market Watch",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  public_smoke: {
    emoji: "💨",
    label: "Public Smoke",
    text: "text-violet-300",
    bg: "bg-violet-500/15",
    border: "border-violet-500/40",
  },
  sharp_conflict: {
    emoji: "⚠️",
    label: "Sharp Conflict",
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
  },
};

const SIZE_CLASSES = {
  sm: "text-[11px] px-2 py-0.5 gap-1",
  md: "text-xs px-2.5 py-1 gap-1.5",
} as const;

export type GradeBadgeProps = {
  grade: Grade;
  size?: keyof typeof SIZE_CLASSES;
  /** Show only the emoji (compact mode). Useful in dense tables. */
  emojiOnly?: boolean;
};

export default function GradeBadge({
  grade,
  size = "md",
  emojiOnly = false,
}: GradeBadgeProps) {
  const meta = META[grade];
  return (
    <span
      role="status"
      aria-label={`Grade: ${meta.label}`}
      className={[
        "inline-flex items-center font-semibold tracking-tight rounded-full border whitespace-nowrap",
        SIZE_CLASSES[size],
        meta.text,
        meta.bg,
        meta.border,
      ].join(" ")}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      {!emojiOnly && <span>{meta.label}</span>}
    </span>
  );
}

/** All 7 grades in canonical priority order — exported for the dev preview. */
export const ALL_GRADES: Grade[] = [
  "best_signal",
  "sharp_confirmed",
  "market_led",
  "model_only",
  "market_watch",
  "public_smoke",
  "sharp_conflict",
];
