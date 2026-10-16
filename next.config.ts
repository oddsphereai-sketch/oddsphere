import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // The deploy checks every production application module and its complete
    // transitive dependency graph. Operator scripts and executable test files
    // remain covered by their dedicated repository checks without inflating
    // the Vercel typecheck worker.
    tsconfigPath: "tsconfig.build.json",
  },
  outputFileTracingIncludes: {
    "/api/cron/nfl-forward-evidence": [
      "./lib/services/football/modelArtifacts/nflExactProviderScoreR11.json.gz",
    ],
  },
};

export default nextConfig;
