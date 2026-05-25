"use client";

/**
 * /lab/track-record — analytical Track Record module page (Phase 6.2a).
 *
 * Lifted out of the LabApp section dispatcher. Renders TrackingView, which
 * fetches via useTracking. No sport URL state required — Tracking is
 * always cross-sport per V2.1 spec.
 *
 * Note: this is the PREMIUM analytical view. The PUBLIC marketing version
 * lives at /track-record and uses the "Performance Snapshot" framing (6.2b).
 */

import TrackingView from "../components/TrackingView";

export default function LabTrackRecordPage() {
  return <TrackingView />;
}
