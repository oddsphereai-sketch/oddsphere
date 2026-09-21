export function shouldRetainMlbPropOffer(args: {
  family: "pitcher" | "batter" | "milestone";
  recentLogCount: number;
}): boolean {
  return args.recentLogCount > 0 || args.family === "pitcher";
}
