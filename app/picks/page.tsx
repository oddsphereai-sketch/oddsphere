/**
 * /picks → /track-record (308 permanent, V2.1 spec Part 4).
 *
 * The public "picks" surface no longer exists — its role was replaced by
 * the marketing-grade /track-record snapshot, and the real picks live
 * behind premium at /lab/daily-edge. permanentRedirect (308) so external
 * links update over time.
 */

import { permanentRedirect } from "next/navigation";

export default function PicksRedirect() {
  permanentRedirect("/track-record");
}
