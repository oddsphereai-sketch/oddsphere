/**
 * /lab/track-record → /lab/tracking (308 permanent).
 *
 * The polished member-facing tracking page is now canonical at
 * /lab/tracking (Phase 6B.2b). This route remains so old links keep
 * working but issues a permanent redirect — there is no duplicate
 * tracking page code behind it.
 */

import { permanentRedirect } from "next/navigation";

export default function LabTrackRecordRedirect(): never {
  permanentRedirect("/lab/tracking");
}
