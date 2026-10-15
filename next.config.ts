import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/cron/nfl-forward-evidence": [
      "./lib/services/football/modelArtifacts/nflExactProviderScoreR11.json.gz",
    ],
  },
};

export default nextConfig;
