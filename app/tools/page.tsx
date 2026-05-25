/**
 * /tools → /lab (308 permanent, V2.1 spec Part 4).
 *
 * "Tools" was the old umbrella name for the calculator/utility set; in V2.1
 * everything analytical now lives inside The Lab (premium app shell), so
 * the orphan route redirects to the Lab index — which itself redirects to
 * /lab/daily-edge as the canonical landing tab.
 */

import { permanentRedirect } from "next/navigation";

export default function ToolsRedirect() {
  permanentRedirect("/lab");
}
