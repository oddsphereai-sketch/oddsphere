import type { Sport } from "@/lib/types/domain/Sport";

export function SportIcon({ sport, size = 18, active }: { sport: Sport; size?: number; active: boolean }) {
  const opacity = active ? 1 : 0.55;

  if (sport === "mlb") {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}>
      <circle cx="10" cy="10" r="8.5" fill="#f5f5f4" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4" />
      <path d="M4.5 6.5 Q10 10 15.5 6.5" stroke="#dc2626" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M4.5 13.5 Q10 10 15.5 13.5" stroke="#dc2626" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </svg>;
  }

  if (sport === "nba" || sport === "cbb" || sport === "wnba") {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}>
      <circle cx="10" cy="10" r="8.5" fill="#ea580c" />
      <line x1="10" y1="1.5" x2="10" y2="18.5" stroke="#1c1917" strokeWidth="0.8" />
      <line x1="1.5" y1="10" x2="18.5" y2="10" stroke="#1c1917" strokeWidth="0.8" />
      <path d="M2.5 10 Q10 4 17.5 10 M2.5 10 Q10 16 17.5 10" stroke="#1c1917" strokeWidth="0.8" fill="none" />
    </svg>;
  }

  if (sport === "nfl" || sport === "cfb") {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}>
      <path d="M2.5 10 Q10 1.5 17.5 10 Q10 18.5 2.5 10 Z" fill="#92400e" />
      <line x1="10" y1="6.5" x2="10" y2="13.5" stroke="#fafaf9" strokeWidth="0.9" />
      <line x1="8.4" y1="8" x2="11.6" y2="8" stroke="#fafaf9" strokeWidth="0.6" />
      <line x1="8.4" y1="10" x2="11.6" y2="10" stroke="#fafaf9" strokeWidth="0.6" />
      <line x1="8.4" y1="12" x2="11.6" y2="12" stroke="#fafaf9" strokeWidth="0.6" />
    </svg>;
  }

  if (sport === "nhl") {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}>
      <ellipse cx="10" cy="11.5" rx="8" ry="3.2" fill="#0f172a" />
      <ellipse cx="10" cy="8.5" rx="8" ry="3.2" fill="#1e293b" stroke="#64748b" strokeWidth="0.4" />
    </svg>;
  }

  if (sport === "soccer" || sport === "ucl") {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}>
      <circle cx="10" cy="10" r="8.5" fill="#f5f5f4" stroke="rgba(0,0,0,0.22)" strokeWidth="0.4" />
      <polygon points="10,5.5 13,7.7 11.9,11.2 8.1,11.2 7,7.7" fill="#111827" />
    </svg>;
  }

  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0" style={{ opacity }}><circle cx="10" cy="10" r="8.5" fill="#52525b" /></svg>;
}
