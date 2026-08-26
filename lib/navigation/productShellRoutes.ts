const PRODUCT_SHELL_EXACT_ROUTES = new Set([
  "/mlb/props",
  "/player-props",
  "/dev/mlb-props-preview",
  "/dev/nfl-props-preview",
  "/dev/experience-preview",
  "/dev/football-preview",
  "/dev/tracking-preview",
  "/dev/premier-league-preview",
  "/dev/relaunch-review",
  "/dev/device-review",
]);

export function usesProductShell(pathname: string): boolean {
  return pathname.startsWith("/lab") || pathname.startsWith("/admin") || PRODUCT_SHELL_EXACT_ROUTES.has(pathname);
}
