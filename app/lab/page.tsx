/**
 * /lab — entry redirect (Phase 6.2a).
 *
 * The old query-param dispatcher (`/lab?section=edge`) is gone. /lab now
 * redirects to the default module page so the URL always reflects which
 * section the user is on, and browser back/forward navigation works the
 * way members expect.
 *
 * Per V2.1 spec Part 4: "Lab home (auto-redirect to /lab/daily-edge)".
 */

import { redirect } from "next/navigation";

export default function LabIndex() {
  redirect("/lab/daily-edge");
}
