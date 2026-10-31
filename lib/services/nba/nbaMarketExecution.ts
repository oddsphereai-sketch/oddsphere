type Market = "moneyline" | "spread" | "total";
export type NbaExecutionExclusions = Record<Market, string[]>;
const markets = ["moneyline", "spread", "total"] as const;
const signature = (x: NbaExecutionExclusions) => JSON.stringify(markets.map(m => x[m]));

/** Exclude only the actual final execution book, not both possible sides.
 * There are at most 2^3 side selections. A cycle retires only the coupled
 * coordinates in that cycle, explicitly, rather than letting a target quote
 * become its own confirming evidence or silently excluding an opposite book.
 */
export function resolveNbaExecutionFixedPoint<T>(args: {
  initial: T;
  executionBooks: (candidate: T) => NbaExecutionExclusions;
  evaluate: (excluded: NbaExecutionExclusions, disabled: Market[]) => T;
}) {
  let exclusions = args.executionBooks(args.initial);
  const seen: NbaExecutionExclusions[] = [];
  for (let iteration = 0; iteration < 9; iteration++) {
    seen.push(exclusions);
    const candidate = args.evaluate(exclusions, []), next = args.executionBooks(candidate);
    if (signature(next) === signature(exclusions)) return { candidate, exclusions, iterations: iteration + 1, cycleMarkets: [] as Market[] };
    const start = seen.findIndex(x => signature(x) === signature(next));
    if (start >= 0) {
      const cycle = [...seen.slice(start), next];
      const disabled = new Set<Market>(markets.filter(m => new Set(cycle.map(x => JSON.stringify(x[m]))).size > 1));
      if (disabled.has("moneyline") || disabled.has("spread")) { disabled.add("moneyline"); disabled.add("spread"); }
      const finalExclusions = args.executionBooks(args.initial);
      let fallback = args.evaluate(finalExclusions, [...disabled]);
      const actual = args.executionBooks(fallback);
      if (signature(actual) !== signature(finalExclusions)) fallback = args.evaluate(actual, [...disabled]);
      if (signature(args.executionBooks(fallback)) !== signature(actual)) throw new Error("NBA target exclusion did not converge after explicit coordinate retirement");
      return { candidate: fallback, exclusions: actual, iterations: iteration + 2, cycleMarkets: [...disabled] };
    }
    exclusions = next;
  }
  throw new Error("NBA target exclusion exceeded finite side-selection states");
}
