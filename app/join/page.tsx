/**
 * /join → /pricing (308 permanent, V2.1 spec Part 4).
 *
 * V1 funnels the entire member-acquisition flow through the single pricing
 * card; "/join" was the prior URL used in some marketing copy and external
 * links. permanentRedirect (308) is used because the route move is
 * intentional and unlikely to revert — search engines cache the destination.
 */

import { permanentRedirect } from "next/navigation";

export default function JoinRedirect() {
  permanentRedirect("/pricing");
}
