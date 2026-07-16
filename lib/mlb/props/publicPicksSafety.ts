export type PublicPicksMode = {
  mode: "disabled" | "mock_preview" | "display_enabled";
  allowMockPreview: boolean;
  displayEnabled: boolean;
};

export function getPublicPicksMode(env: NodeJS.ProcessEnv = process.env): PublicPicksMode {
  const displayEnabled = env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true";
  const publicApiEnabled = env.ODDSPHERE_PROPS_PUBLIC_API_ENABLED === "true";
  if (displayEnabled && publicApiEnabled) return { mode: "display_enabled", allowMockPreview: false, displayEnabled };
  return { mode: "disabled", allowMockPreview: false, displayEnabled };
}

export function isPublicRecommendationVisible(args: {
  recommendationStatus: string;
  createdAt?: string | null;
  now?: string;
  maxAgeSeconds?: number;
}): boolean {
  if (args.recommendationStatus !== "recommended") return false;
  if (!args.createdAt) return true;
  const ageSeconds = (new Date(args.now ?? new Date().toISOString()).getTime() - new Date(args.createdAt).getTime()) / 1000;
  return ageSeconds <= (args.maxAgeSeconds ?? 900);
}
