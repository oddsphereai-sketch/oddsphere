"use client";

import { useState } from "react";

const ESPN_MLB_SLUG: Record<string, string> = {
  CWS: "chw",
  ATH: "oak",
};

const LOGO_FILTER: Record<string, string> = {
  SD: "brightness(1.45) saturate(0.95)",
};

export function mlbEspnLogoUrl(abbreviation: string): string {
  const slug = ESPN_MLB_SLUG[abbreviation] ?? abbreviation.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`;
}

export default function ProductTeamBadge({ abbreviation, size = 32, showLabel = false }: { abbreviation: string; size?: number; showLabel?: boolean }) {
  const [errored, setErrored] = useState(false);
  const filter = LOGO_FILTER[abbreviation];

  return <span className="inline-flex shrink-0 items-center gap-2">
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/10" style={{ width: size, height: size }} aria-label={abbreviation}>
      {errored ? <span className="font-bold tracking-tight text-violet-100" style={{ fontSize: Math.max(9, Math.floor(size * 0.34)) }}>{abbreviation}</span> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={mlbEspnLogoUrl(abbreviation)} alt={abbreviation} width={Math.max(1, size - 4)} height={Math.max(1, size - 4)} className="rounded-full object-contain" style={{ width: Math.max(1, size - 4), height: Math.max(1, size - 4), ...(filter ? { filter } : {}) }} onError={() => setErrored(true)} />}
    </span>
    {showLabel ? <span className="text-sm font-semibold tracking-tight text-gray-200">{abbreviation}</span> : null}
  </span>;
}
