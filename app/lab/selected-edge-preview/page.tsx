/**
 * /lab/selected-edge-preview — DESIGN REVIEW ONLY (2026-06-17).
 *
 * Standalone, screenshotable mockup of the redesigned Daily Edge → Selected
 * Edge "full read". Renders SelectedEdgeMockup (hardcoded KC @ WSH sample
 * data). NOT linked from anywhere and NOT wired into the live Daily Edge —
 * production behavior is untouched. Delete this route + the mockup component
 * once the design is approved and folded into the real reader.
 */

import SelectedEdgeMockup from "../components/daily-edge/SelectedEdgeMockup";

export const metadata = { title: "Selected Edge — Design Preview" };

export default function SelectedEdgePreviewPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-4 py-2.5">
        <p className="text-[12px] text-amber-200/90">
          <span className="font-bold uppercase tracking-wide text-[10px] mr-2">Mockup</span>
          Design-review preview only — hardcoded KC @ WSH sample data. Not live; the production Daily Edge is unchanged.
          Toggle the three market cards (Moneyline / Total / 1st Inning) to review each selected state.
        </p>
      </div>
      <SelectedEdgeMockup />
    </div>
  );
}
