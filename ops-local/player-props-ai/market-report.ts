/** Deterministic research compression. Every player/market remains; raw offers stay in the local archive. */
import type { Evidence, GamePacket, Json, Quote } from "./catalog";
import { digest, instant, invariant, validatePacket } from "./core";

const probability = (odds: number) => odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
const order = (a: Quote, b: Quote) => instant(a.observedAt) - instant(b.observedAt) || instant(a.receivedAt) - instant(b.receivedAt) || a.id.localeCompare(b.id);
function pair(rows: Quote[], earliest: boolean) {
  const sorted = [...rows].sort(order), side = (s: string) => earliest ? sorted.find(q => q.side === s) : sorted.filter(q => q.side === s).at(-1);
  const over = side("over"), under = side("under");
  // Exact-line/book/provider caller grouping and contemporaneous legs are mandatory.
  if (!over || !under || Math.abs(instant(over.observedAt) - instant(under.observedAt)) > 5 * 60_000) return null;
  const o = probability(over.american), u = probability(under.american);
  return { line: over.line, over: over.american, under: under.american, fairOver: o / (o + u),
    overObservedAt: over.observedAt, underObservedAt: under.observedAt, evidence: [over.id, under.id] };
}
export function compileMarketReport(packet: GamePacket): GamePacket {
  validatePacket(packet);
  const retained = new Set<string>(), aggregate: Evidence[] = [];
  const players = packet.players.map(player => {
    const evidence = [...player.evidence];
    for (const market of player.markets) {
      const rows = packet.quotes.filter(q => q.playerId === player.id && q.market === market);
      const model = player.evidence.find(e => e.kind === "independent_model" && e.value && typeof e.value === "object" && !Array.isArray(e.value) && e.value.market === market);
      const value = model?.value as { line?: number } | undefined;
      const lines = [...new Set(rows.map(q => q.line))].sort((a, b) => a - b);
      const paired = lines.map(line => ({ line, refs: [...new Set(rows.map(q => `${q.provider}|${q.book}`))].flatMap(source => {
        const atLine = rows.filter(q => `${q.provider}|${q.book}` === source && q.line === line), p = pair(atLine, false);
        return p ? [p] : [];
      }) }));
      // Prefer the declared exact model line. A fallback is labelled inferred, never an invented model head.
      const fallback = [...paired].filter(p => p.refs.length).sort((a, b) => b.refs.length - a.refs.length ||
        Math.abs(a.refs.reduce((n, p) => n + p.fairOver, 0) / a.refs.length - 0.5) - Math.abs(b.refs.reduce((n, p) => n + p.fairOver, 0) / b.refs.length - 0.5) || a.line - b.line)[0]?.line ?? lines[Math.floor(lines.length / 2)] ?? null;
      const anchor = typeof value?.line === "number" ? value.line : fallback;
      for (const q of rows) if (q.line === anchor) retained.add(q.id);
      const sources = [...new Set(rows.map(q => `${q.provider}|${q.book}`))];
      const books = sources.map(source => {
        const bookRows = rows.filter(q => `${q.provider}|${q.book}` === source);
        const ladder = lines.flatMap(line => { const p = pair(bookRows.filter(q => q.line === line), false); return p ? [p] : []; });
        const selected = new Map<number, (typeof ladder)[number]>();
        for (const p of [0.25, 0.5, 0.75]) {
          const nearest = [...ladder].sort((a, b) => Math.abs(a.fairOver - p) - Math.abs(b.fairOver - p))[0];
          if (nearest) selected.set(nearest.line, nearest);
        }
        const atAnchor = bookRows.filter(q => q.line === anchor);
        return { provider: bookRows[0].provider, book: bookRows[0].book,
          retainedStates: bookRows.length, distinctLines: new Set(bookRows.map(q => q.line)).size,
          earliestObservedAt: [...bookRows].sort(order)[0].observedAt, latestObservedAt: [...bookRows].sort(order).at(-1)!.observedAt,
          anchorEarliestRetainedPair: pair(atAnchor, true), anchorLatestRetainedPair: pair(atAnchor, false),
          representativeLadderPoints: [...selected.values()], pairedLadderLines: ladder.length,
          nonMonotonePairs: ladder.slice(1).filter((p, i) => p.fairOver > ladder[i].fairOver + 1e-9).length,
          oneSidedYes: bookRows.filter(q => q.side === "yes").length ? [...bookRows].sort(order).filter(q => q.side === "yes").map(q => ({ id: q.id, line: q.line, american: q.american, observedAt: q.observedAt })).filter((_, i, a) => i === 0 || i === a.length - 1) : [],
        };
      });
      const report: Evidence = { id: `market-report:${player.id}:${market}`, kind: "market", availableAt: packet.cutoff,
        source: "offline deterministic exact-line/book price report r1; not a calibrated forecast",
        value: { market, anchorLine: anchor, anchorSource: typeof value?.line === "number" ? "timestamped_independent_model" : "inferred_from_retained_offers",
          rawTraceDigest: digest(rows), rawTraceStates: rows.length, fullAnchorTraceStates: rows.filter(q => q.line === anchor).length,
          books, limitations: ["raw alternate-line histories retained locally; AI sees a deterministic summary of those histories", "nearest ladder samples are observed pairs, not interpolated quantiles", "no money/bet splits inferred from odds", "no attribution of who moved first beyond retained timestamps", "stale leg/age checks still required at execution"] } as unknown as Json };
      evidence.push(report); aggregate.push(report);
    }
    return { ...player, evidence };
  });
  invariant(aggregate.length === packet.players.reduce((n, p) => n + p.markets.length, 0), "Lost a player/market report");
  const result = { ...packet, players, quotes: packet.quotes.filter(q => retained.has(q.id)),
    sourceLimitations: [...packet.sourceLimitations, "AI input uses deterministic alternate-ladder summaries; raw full anchor-line chronology preserved; summary utility must be evaluated"] };
  validatePacket(result);
  return result;
}
