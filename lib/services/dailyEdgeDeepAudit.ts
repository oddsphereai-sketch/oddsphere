import { isDisplayableAmericanOdds } from "../streaming/oddsSanity";
import { verifiedTrailMovementDirection } from "./dailyEdge/verifiedTrailMovement";

export const DAILY_EDGE_DEEP_AUDIT_SPORTS = [
  "mlb",
  "wnba",
  "soccer",
  "ucl",
  "nfl",
  "cfb",
  "nhl",
  "nba",
] as const;

// The audit deliberately inspects heterogeneous versioned DTO payloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type DailyEdgeAuditSeverity = "critical" | "warning";

export type DailyEdgeDeepAuditIssue = {
  severity: DailyEdgeAuditSeverity;
  reason: string;
  action: string;
  sport: string;
  matchup: string;
  market: string;
  pick: string | null;
  grade: string | null;
  verdict: string | null;
  details: Record<string, unknown>;
};

export type DailyEdgeDeepAuditSummary = {
  sports: Record<string, {
    games: number;
    markets: number;
    reads: number;
    sharpRows: number;
  }>;
  totalGames: number;
  totalMarkets: number;
  criticalIssues: number;
  warnings: number;
  badOddsRejected: number;
  stalePricesRejected: number;
  sourceChainTrailsHidden: number;
  issueCounts: Record<string, number>;
};

export type DailyEdgeDeepAuditResult = {
  ok: boolean;
  generatedAt: string;
  summary: DailyEdgeDeepAuditSummary;
  issues: DailyEdgeDeepAuditIssue[];
};

type Direction = "support" | "resistance" | "neutral";

const CRITICAL_REASONS = new Set([
  "implausible_displayed_american_odds",
  "stale_price_displayed_as_current",
  "current_quote_not_recently_verified",
  "odds_trail_chronology_inverted",
  "odds_trail_terminal_price_mismatch",
  "odds_trail_terminal_book_mismatch",
  "provider_opening_not_before_game",
  "active_reader_omits_verified_movement",
  "active_reader_movement_wrong_for_visible_trail",
  "active_reader_movement_without_visible_move",
  "source_chain_previous_not_current",
  "market_read_direction_wrong_for_visible_trail",
  "directional_read_without_visible_move",
  "projection_led_contradicts_visible_trail",
  "sharp_money_contradicts_market_read",
  "locked_price_not_frozen",
  "market_read_uses_hidden_price",
  "best_angle_low_recommendation_score",
  "lean_low_recommendation_score",
  "no_play_positive_edge_needs_explanation",
  "grade_copy_actionable_but_rec_weak",
  "grade_contradicts_market_resistance",
]);

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isPlausibleDisplayedAmericanOdds(
  sport: string,
  slot: string,
  american: number | null,
): boolean {
  if (isDisplayableAmericanOdds(american)) return true;
  // Heavy favorites can legitimately exceed the generic streaming guard in
  // several sports (for example, WNBA and three-way soccer moneylines). This
  // audit-only allowance does not admit a price into a model or provider
  // pipeline; source-chain and same-market coherence are checked separately.
  const market = marketLabel(sport, slot);
  const isTeamWinnerMarket = market === "moneyline" || market === "1x2";
  const extendedMaximum = sport === "cfb"
    ? 100_000
    : sport === "nfl" || sport === "soccer" || sport === "ucl"
      ? 10_000
      : 2_500;
  return isTeamWinnerMarket &&
    american !== null &&
    Number.isInteger(american) &&
    Math.abs(american) >= 100 &&
    Math.abs(american) <= extendedMaximum;
}

function implied(american: number | null): number | null {
  if (american === null || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function pct(v: unknown): number | null {
  const value = n(v);
  if (value === null) return null;
  return value > 1 ? value : value * 100;
}

function readDirection(label: unknown): Direction {
  const lower = String(label ?? "").toLowerCase();
  if (lower.includes("support")) return "support";
  if (lower.includes("resistance")) return "resistance";
  return "neutral";
}

function isProjectionLedRead(label: unknown): boolean {
  const normalized = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  return normalized === "projection led";
}

function sharpDirection(summary: unknown): Direction {
  const lower = String(summary ?? "").toLowerCase();
  if (lower.includes("with our pick")) return "support";
  if (lower.includes("against our pick")) return "resistance";
  return "neutral";
}

function matchup(game: Row): string {
  return `${game.awayTeam ?? game.away_team ?? "away"}@${game.homeTeam ?? game.home_team ?? "home"}`;
}

function marketLabel(sport: string, slot: string): string {
  if (["wnba", "nba", "nhl", "nfl", "cfb"].includes(sport) && slot === "first_inning") return "spread";
  if ((sport === "soccer" || sport === "ucl") && slot === "first_inning") return "btts";
  if ((sport === "soccer" || sport === "ucl") && slot === "moneyline") return "1x2";
  if ((sport === "soccer" || sport === "ucl") && slot === "spread") return "double_chance";
  return slot;
}

function selectedPublicSplit(market: Row): Row | null {
  const splits = Array.isArray(market.publicSplits) ? market.publicSplits as Row[] : [];
  const pick = String(market.pick ?? "").toLowerCase();
  const side = String(market.side ?? market.modelSide ?? "").toLowerCase();
  return splits.find((s) => String(s.side ?? "").toLowerCase() === side) ??
    splits.find((s) => String(s.label ?? "").toLowerCase() === pick) ??
    null;
}

function selectedRecommendationConsensusSplit(market: Row): Row | null {
  const splits = Array.isArray(market.recommendationDecision?.consensusSplits?.rows)
    ? market.recommendationDecision.consensusSplits.rows as Row[]
    : [];
  const pick = String(market.pick ?? "").toLowerCase();
  const side = String(market.side ?? market.modelSide ?? "").toLowerCase();
  return splits.find((s) => String(s.side ?? "").toLowerCase() === side) ??
    splits.find((s) => String(s.label ?? "").toLowerCase() === pick) ??
    null;
}

function priceDirection(open: number | null, current: number | null): Direction {
  if (open === null || current === null) return "neutral";
  if (Math.abs(current - open) < 5) return "neutral";
  const a = implied(open);
  const b = implied(current);
  if (a === null || b === null || Math.abs(b - a) < 0.01) return "neutral";
  return b > a ? "support" : "resistance";
}

function pointDirection(slot: string, pick: string | null, prev: number | null, next: number | null): Direction {
  if (prev === null || next === null || Math.abs(next - prev) < 0.01) return "neutral";
  const p = String(pick ?? "").toLowerCase();
  if (slot === "total") {
    if (p.startsWith("over")) return next > prev ? "support" : "resistance";
    if (p.startsWith("under")) return next < prev ? "support" : "resistance";
  }
  if (slot === "spread" || slot === "first_inning") {
    return next < prev ? "support" : "resistance";
  }
  return "neutral";
}

function visibleDirection(sport: string, slot: string, market: Row): Direction {
  const marketName = marketLabel(sport, slot);
  const previousLine = n(market.lastMoveLinePrev);
  const currentLine = n(market.lastMoveLineNext);
  const lineDir = sport === "wnba" && marketName === "spread" && previousLine !== null && currentLine !== null
    ? Math.abs(currentLine - previousLine) < 0.01
      ? "neutral"
      : currentLine > previousLine ? "support" : "resistance"
    : pointDirection(marketName, market.pick ?? null, previousLine, currentLine);
  if (lineDir !== "neutral") return lineDir;
  return priceDirection(effectiveOpenAmerican(market), effectiveTerminalAmerican(market));
}

function hasVisibleMovement(sport: string, slot: string, market: Row): boolean {
  return visibleDirection(sport, slot, market) !== "neutral" ||
    (n(market.lastMovePrevAmerican) !== null && n(market.lastMoveNextAmerican) !== null);
}

function effectiveOpenAmerican(market: Row): number | null {
  return n(market.lineOpenAmerican) ??
    n(market.oddspherePostedAmerican) ??
    n(market.marketReadV2?.movement?.firstTrackedPrice) ??
    n(Array.isArray(market.oddsTrail) ? market.oddsTrail[0]?.american : null);
}

function effectiveTerminalAmerican(market: Row): number | null {
  const locked = market.lockedLineAt != null ||
    n(market.lockedLineAmerican) !== null ||
    market.priceUnavailableAtLock === true;
  return locked
    ? n(market.lockedLineAmerican) ?? n(market.priceAmerican) ?? n(market.marketReadV2?.movement?.currentPrice)
    : n(market.currentPriceAmerican) ?? n(market.marketReadV2?.movement?.currentPrice) ?? n(market.priceAmerican) ??
      n(Array.isArray(market.oddsTrail) ? market.oddsTrail.at(-1)?.american : null);
}

function issueSeverity(reason: string): DailyEdgeAuditSeverity {
  return CRITICAL_REASONS.has(reason) ? "critical" : "warning";
}

function actionFor(reason: string): string {
  switch (reason) {
    case "implausible_displayed_american_odds":
      return "block_display_of_bad_odds";
    case "stale_price_displayed_as_current":
    case "current_quote_not_recently_verified":
      return "hide_stale_price_or_use_fresher_trusted_price";
    case "odds_trail_chronology_inverted":
    case "odds_trail_terminal_price_mismatch":
    case "odds_trail_terminal_book_mismatch":
    case "provider_opening_not_before_game":
      return "repair_same_book_event_price_trail";
    case "active_reader_omits_verified_movement":
    case "active_reader_movement_wrong_for_visible_trail":
    case "active_reader_movement_without_visible_move":
      return "repair_active_reader_movement_input";
    case "source_chain_previous_not_current":
      return "hide_bad_odds_move_previous_stop";
    case "market_read_direction_wrong_for_visible_trail":
    case "directional_read_without_visible_move":
    case "projection_led_contradicts_visible_trail":
    case "market_read_uses_hidden_price":
      return "downgrade_or_rewrite_market_read_to_visible_trail";
    case "sharp_money_contradicts_market_read":
      return "hide_sharp_money_row";
    case "best_angle_copy_denies_market_resistance":
    case "legacy_or_provider_copy_leak":
    case "best_angle_low_recommendation_score":
    case "lean_low_recommendation_score":
    case "no_play_positive_edge_needs_explanation":
    case "grade_copy_actionable_but_rec_weak":
    case "grade_contradicts_market_resistance":
      return "normalize_final_actionability_before_render";
    case "locked_price_not_frozen":
      return "fail_publish_and_preserve_locked_snapshot";
    default:
      return "admin_warning";
  }
}

function shouldAuditMarket(sport: string, slot: string): boolean {
  if (sport === "mlb") return slot === "moneyline" || slot === "total" || slot === "first_inning";
  if (sport === "wnba") return slot === "moneyline" || slot === "total" || slot === "first_inning";
  if (sport === "soccer" || sport === "ucl") {
    return slot === "moneyline" || slot === "total" || slot === "first_inning" || slot === "spread";
  }
  return true;
}

export function auditDailyEdgeBoards(
  boardsBySport: Record<string, Row>,
  opts: { generatedAt?: string } = {},
): DailyEdgeDeepAuditResult {
  const auditNowMs = Date.parse(opts.generatedAt ?? new Date().toISOString());
  const issues: DailyEdgeDeepAuditIssue[] = [];
  const summary: DailyEdgeDeepAuditSummary = {
    sports: {},
    totalGames: 0,
    totalMarkets: 0,
    criticalIssues: 0,
    warnings: 0,
    badOddsRejected: 0,
    stalePricesRejected: 0,
    sourceChainTrailsHidden: 0,
    issueCounts: {},
  };

  const push = (
    reason: string,
    sport: string,
    game: Row,
    slot: string,
    market: Row,
    details: Record<string, unknown> = {},
  ) => {
    const severity = issueSeverity(reason);
    summary.issueCounts[reason] = (summary.issueCounts[reason] ?? 0) + 1;
    if (severity === "critical") summary.criticalIssues += 1;
    else summary.warnings += 1;
    if (reason === "implausible_displayed_american_odds") summary.badOddsRejected += 1;
    if (reason === "stale_price_displayed_as_current" || reason === "current_quote_not_recently_verified") {
      summary.stalePricesRejected += 1;
    }
    if (reason === "source_chain_previous_not_current") summary.sourceChainTrailsHidden += 1;
    issues.push({
      severity,
      reason,
      action: actionFor(reason),
      sport,
      matchup: matchup(game),
      market: marketLabel(sport, slot),
      pick: typeof market.pick === "string" ? market.pick : null,
      grade: typeof market.grade === "string" ? market.grade : null,
      verdict: typeof market.verdict?.key === "string" ? market.verdict.key : null,
      details,
    });
  };

  for (const [sport, board] of Object.entries(boardsBySport)) {
    const games = Array.isArray(board?.games) ? board.games as Row[] : [];
    summary.sports[sport] = { games: games.length, markets: 0, reads: 0, sharpRows: 0 };
    summary.totalGames += games.length;

    for (const game of games) {
      for (const [slot, marketRaw] of Object.entries(game.markets ?? {})) {
        if (!shouldAuditMarket(sport, slot)) continue;
        const market = marketRaw as Row;
        summary.sports[sport]!.markets += 1;
        summary.totalMarkets += 1;
        const read = market.marketReadV2 && typeof market.marketReadV2 === "object"
          ? market.marketReadV2 as Row
          : null;
        const recommendationRead = market.recommendationDecision?.resolvedMarketRead &&
          typeof market.recommendationDecision.resolvedMarketRead === "object"
          ? market.recommendationDecision.resolvedMarketRead as Row
          : null;
        const hasActiveRead = read !== null || recommendationRead !== null ||
          typeof market.marketSignal === "string" || typeof market.sharpStatus === "string";
        if (hasActiveRead) summary.sports[sport]!.reads += 1;
        const sharpMoney = read?.sourceSummary?.sharpMoney ?? null;
        const recommendationSharpRows = Array.isArray(market.recommendationDecision?.sharpBookSplits?.rows)
          ? market.recommendationDecision.sharpBookSplits.rows.length
          : 0;
        if (sharpMoney || recommendationSharpRows > 0 || Array.isArray(market.sportsbookSplits) && market.sportsbookSplits.length > 0) {
          summary.sports[sport]!.sharpRows += 1;
        }

        const displayedOdds = [
          ["first", n(market.lineOpenAmerican)],
          ["previous", n(market.lastMovePrevAmerican)],
          ["moveNext", n(market.lastMoveNextAmerican)],
          ["current", n(market.priceAmerican)],
          ["locked", n(market.lockedLineAmerican)],
          ["readFirst", n(read?.movement?.firstTrackedPrice)],
          ["readCurrent", n(read?.movement?.currentPrice)],
        ] as const;
        for (const [field, value] of displayedOdds) {
          if (!isPlausibleDisplayedAmericanOdds(sport, slot, value) && value !== null) {
            push("implausible_displayed_american_odds", sport, game, slot, market, { field, value });
          }
        }

        const terminalPrice = effectiveTerminalAmerican(market);
        const nonActionableNoPlay =
          market.verdict?.key === "no_play" &&
          (market.recommendationConfidence === null || market.pick === "Toss-Up");
        if (terminalPrice === null && market.priceUnavailableAtLock !== true && market.held !== true && !nonActionableNoPlay) {
          push("missing_display_price", sport, game, slot, market, { priceAmerican: market.priceAmerican ?? null });
        }
        if (n(market.priceAmerican) !== null && market.priceIsStale === true && game.lockState !== "locked") {
          push("stale_price_displayed_as_current", sport, game, slot, market, {
            price: market.priceAmerican,
            observedAt: market.priceObservedAt ?? null,
          });
        }

        const isUnlocked = game.lockState !== "locked" && market.lockedLineAt == null;
        const gameStartMs = Date.parse(String(game.gameStartAt ?? game.gameTime ?? ""));
        const currentObservedAt = typeof market.currentPriceObservedAt === "string"
          ? market.currentPriceObservedAt
          : typeof market.priceObservedAt === "string"
            ? market.priceObservedAt
            : null;
        const currentObservedMs = Date.parse(currentObservedAt ?? "");
        const explicitlyCheckedAt = typeof market.marketPrediction?.freshnessCheckedAt === "string"
          ? market.marketPrediction.freshnessCheckedAt
          : null;
        const explicitlyCheckedMs = Date.parse(explicitlyCheckedAt ?? "");
        const nearKickoff = Number.isFinite(gameStartMs)
          && Number.isFinite(auditNowMs)
          && gameStartMs >= auditNowMs
          && gameStartMs - auditNowMs <= 48 * 60 * 60_000;
        const currentTooOld = Number.isFinite(currentObservedMs)
          && Number.isFinite(auditNowMs)
          && auditNowMs - currentObservedMs > 180 * 60_000;
        const recentlyVerified = Number.isFinite(explicitlyCheckedMs)
          && Number.isFinite(auditNowMs)
          && auditNowMs - explicitlyCheckedMs <= 180 * 60_000;
        if (isUnlocked && nearKickoff && n(market.currentPriceAmerican) !== null && currentTooOld && !recentlyVerified) {
          push("current_quote_not_recently_verified", sport, game, slot, market, {
            observedAt: currentObservedAt,
            ageMinutes: Math.round((auditNowMs - currentObservedMs) / 60_000),
            freshnessCheckedAt: explicitlyCheckedAt,
          });
        }

        const trail = Array.isArray(market.oddsTrail) ? market.oddsTrail as Row[] : [];
        const firstStop = trail[0] ?? null;
        const terminalStop = trail.at(-1) ?? null;
        const firstObservedMs = Date.parse(String(firstStop?.observedAt ?? ""));
        const terminalObservedMs = Date.parse(String(terminalStop?.observedAt ?? ""));
        if (
          isUnlocked && trail.length > 1
          && Number.isFinite(firstObservedMs) && Number.isFinite(terminalObservedMs)
          && firstObservedMs > terminalObservedMs
        ) {
          push("odds_trail_chronology_inverted", sport, game, slot, market, {
            firstObservedAt: firstStop?.observedAt ?? null,
            terminalObservedAt: terminalStop?.observedAt ?? null,
          });
        }
        const displayedCurrent = n(market.currentPriceAmerican) ?? n(market.priceAmerican);
        const terminalAmerican = n(terminalStop?.american);
        if (isUnlocked && displayedCurrent !== null && terminalAmerican !== null && displayedCurrent !== terminalAmerican) {
          push("odds_trail_terminal_price_mismatch", sport, game, slot, market, {
            displayedCurrent,
            terminalAmerican,
          });
        }
        const displayedBook = String(market.currentPriceSportsbook ?? market.marketSource ?? "")
          .toLowerCase().replace(/[^a-z0-9]/g, "");
        const terminalBook = String(terminalStop?.sportsbook ?? "")
          .toLowerCase().replace(/[^a-z0-9]/g, "");
        if (isUnlocked && displayedBook && terminalBook && displayedBook !== terminalBook) {
          push("odds_trail_terminal_book_mismatch", sport, game, slot, market, {
            displayedBook: market.currentPriceSportsbook ?? market.marketSource ?? null,
            terminalBook: terminalStop?.sportsbook ?? null,
          });
        }
        if (
          isUnlocked
          && firstStop?.source === "provider_opening"
          && Number.isFinite(firstObservedMs)
          && Number.isFinite(gameStartMs)
          && firstObservedMs >= gameStartMs
        ) {
          push("provider_opening_not_before_game", sport, game, slot, market, {
            openingObservedAt: firstStop.observedAt ?? null,
            gameStartAt: game.gameStartAt ?? game.gameTime ?? null,
          });
        }

        const activeMovement = market.recommendationDecision?.lineMovement;
        const activeMovementDirection: Direction = activeMovement === "support" || activeMovement === "resistance"
          ? activeMovement
          : "neutral";
        const declaredWriterDirection: Direction = market.writerMovementDirection === "support" || market.writerMovementDirection === "resistance"
          ? market.writerMovementDirection
          : "neutral";
        const readerUsesDisplayedTrail = market.readerMovementSource === "displayed_same_book_trail";
        if (readerUsesDisplayedTrail) {
          const namedMarket = marketLabel(sport, slot);
          const displayedDirection = namedMarket === "moneyline" || namedMarket === "spread" || namedMarket === "total"
            ? verifiedTrailMovementDirection({
                market: namedMarket,
                pick: market.pick ?? null,
                trail: Array.isArray(market.oddsTrail) ? market.oddsTrail : [],
              })
            : "neutral";
          if (displayedDirection !== "neutral" && activeMovement == null) {
            push("active_reader_omits_verified_movement", sport, game, slot, market, {
              displayedDirection,
              readerMovementSource: market.readerMovementSource,
            });
          }
          if (activeMovementDirection !== "neutral" && displayedDirection === "neutral") {
            push("active_reader_movement_without_visible_move", sport, game, slot, market, {
              activeMovement: activeMovementDirection,
              writerMovementDirection: declaredWriterDirection,
            });
          }
          if (activeMovementDirection !== "neutral" && displayedDirection !== "neutral" && activeMovementDirection !== displayedDirection) {
            push("active_reader_movement_wrong_for_visible_trail", sport, game, slot, market, {
              activeMovement: activeMovementDirection,
              displayedDirection,
              writerMovementDirection: declaredWriterDirection,
            });
          }
        }

        const prev = n(market.lastMovePrevAmerican);
        const moveNext = n(market.lastMoveNextAmerican);
        const current = terminalPrice;
        if (prev !== null && moveNext !== null && current !== null && moveNext !== current) {
          push("source_chain_previous_not_current", sport, game, slot, market, { previous: prev, moveNext, current });
        }

        const readDir = readDirection(read?.label);
        const visibleDir = visibleDirection(sport, slot, market);
        if (readDir !== "neutral" && !hasVisibleMovement(sport, slot, market)) {
          push("directional_read_without_visible_move", sport, game, slot, market, {
            readLabel: read?.label ?? null,
            explanation: read?.explanation ?? null,
          });
        }
        if (readDir !== "neutral" && visibleDir !== "neutral" && readDir !== visibleDir) {
          push("market_read_direction_wrong_for_visible_trail", sport, game, slot, market, {
            readLabel: read?.label ?? null,
            visibleDirection: visibleDir,
            first: effectiveOpenAmerican(market),
            current: terminalPrice,
            linePrevious: market.lastMoveLinePrev ?? null,
            lineCurrent: market.lastMoveLineNext ?? null,
          });
        }
        if (read !== null && isProjectionLedRead(read.label) && visibleDir !== "neutral") {
          push("projection_led_contradicts_visible_trail", sport, game, slot, market, {
            readLabel: read?.label ?? null,
            visibleDirection: visibleDir,
            first: effectiveOpenAmerican(market),
            current: terminalPrice,
            linePrevious: market.lastMoveLinePrev ?? null,
            lineCurrent: market.lastMoveLineNext ?? null,
          });
        }
        const readCurrent = n(read?.movement?.currentPrice);
        if (readDir !== "neutral" && readCurrent !== null && current !== null && readCurrent !== current) {
          push("market_read_uses_hidden_price", sport, game, slot, market, {
            readCurrent,
            displayedCurrent: current,
          });
        }

        const sharpDir = sharpDirection(sharpMoney);
        if (sharpDir !== "neutral" && readDir !== "neutral" && sharpDir !== readDir) {
          push("sharp_money_contradicts_market_read", sport, game, slot, market, {
            sharpMoney,
            readLabel: read?.label ?? null,
          });
        }
        const readText = `${read?.label ?? ""} ${read?.explanation ?? ""} ${read?.sourceSummary?.priceAction ?? ""}`.toLowerCase();
        if (/sharpapi|playbook|provider|resolver|source conflict|dk\/circa|draftkings\/circa/.test(readText)) {
          push("legacy_or_provider_copy_leak", sport, game, slot, market, { readText: readText.slice(0, 240) });
        }

        const split = selectedPublicSplit(market);
        const consensusMoney = pct(read?.consensus?.moneyPct);
        const consensusBets = pct(read?.consensus?.betsPct);
        if (split && (consensusMoney !== null || consensusBets !== null)) {
          const splitMoney = n(split.moneyPct);
          const splitBets = n(split.betsPct);
          if (
            (consensusMoney !== null && splitMoney !== null && Math.abs(consensusMoney - splitMoney) > 1) ||
            (consensusBets !== null && splitBets !== null && Math.abs(consensusBets - splitBets) > 1)
          ) {
            push("consensus_bar_mismatch", sport, game, slot, market, {
              selectedSplit: { moneyPct: splitMoney, betsPct: splitBets },
              readConsensus: { moneyPct: consensusMoney, betsPct: consensusBets },
            });
          }
        }
        const recommendationSplit = selectedRecommendationConsensusSplit(market);
        if (split && recommendationSplit) {
          const splitMoney = n(split.moneyPct);
          const splitBets = n(split.betsPct);
          const recommendationMoney = n(recommendationSplit.moneyPct);
          const recommendationBets = n(recommendationSplit.betsPct);
          if (
            (splitMoney !== null && recommendationMoney !== null && Math.abs(splitMoney - recommendationMoney) > 1) ||
            (splitBets !== null && recommendationBets !== null && Math.abs(splitBets - recommendationBets) > 1)
          ) {
            push("consensus_reader_mismatch", sport, game, slot, market, {
              collapsedConsensus: { moneyPct: splitMoney, betsPct: splitBets },
              expandedConsensus: { moneyPct: recommendationMoney, betsPct: recommendationBets },
            });
          }
        }

        const bestAngle = market.verdict?.key === "best_angle" || market.grade === "best_signal";
        const rec = n(market.recommendationConfidence);
        if (bestAngle && rec !== null && rec < 60) {
          push("best_angle_low_recommendation_score", sport, game, slot, market, {
            recommendationConfidence: rec,
            capReasons: market.capReasons ?? [],
          });
        }
        if (market.verdict?.key === "lean" && rec !== null && rec < 45) {
          push("lean_low_recommendation_score", sport, game, slot, market, {
            recommendationConfidence: rec,
            capReasons: market.capReasons ?? [],
          });
        }
        const actionableCopy = String(market.guidedGuide ?? "").toLowerCase();
        if ((market.verdict?.key === "best_angle" || market.verdict?.key === "lean") && rec !== null && rec < 45) {
          push("grade_copy_actionable_but_rec_weak", sport, game, slot, market, {
            recommendationConfidence: rec,
            guide: market.guidedGuide ?? null,
          });
        }
        const noMajorResistanceCopy = String(market.guidedGuide ?? "").toLowerCase().includes("no major market resistance") ||
          String(market.riskLine ?? "").toLowerCase().includes("no major market resistance");
        if (bestAngle && readDir === "resistance" && noMajorResistanceCopy) {
          push("best_angle_copy_denies_market_resistance", sport, game, slot, market, {
            guide: market.guidedGuide ?? null,
            risk: market.riskLine ?? null,
          });
        }
        if ((market.verdict?.key === "best_angle" || market.verdict?.key === "lean") && readDir === "resistance" && actionableCopy.includes("clean read")) {
          push("grade_contradicts_market_resistance", sport, game, slot, market, {
            guide: market.guidedGuide ?? null,
            readLabel: read?.label ?? null,
          });
        }
        if (market.verdict?.key === "no_play" && n(market.modelMarketGapPct) !== null && (market.modelMarketGapPct as number) > 2) {
          const capReasons = Array.isArray(market.capReasons) ? market.capReasons : [];
          const displayReason = String(market.displayReason ?? market.guidedGuide ?? "").toLowerCase();
          const neutralFirstInningDecision =
            slot === "first_inning" &&
            (String(market.pick ?? "").toLowerCase() === "toss-up" ||
              displayReason.includes("toss-up") ||
              displayReason.includes("no actionable side") ||
              displayReason.includes("coin-flip"));
          const hasExplicitCapReason = capReasons.some((reason) =>
            typeof reason === "string" && reason.trim().length > 0);
          const hasExplicitEconomicExplanation =
            displayReason.includes("because") ||
            displayReason.includes("too thin") ||
            displayReason.includes("not enough value") ||
            displayReason.includes("does not leave enough value") ||
            displayReason.includes("doesn't leave enough value");
          if (!neutralFirstInningDecision && !hasExplicitCapReason && !hasExplicitEconomicExplanation) {
            push("no_play_positive_edge_needs_explanation", sport, game, slot, market, {
              modelMarketGapPct: market.modelMarketGapPct,
              capReasons,
              displayReason: market.displayReason ?? null,
              guide: market.guidedGuide ?? null,
            });
          }
        }
        const neutralLockedFirstInning =
          slot === "first_inning" &&
          market.verdict?.key === "no_play" &&
          String(market.pick ?? "").toLowerCase() === "toss-up" &&
          market.priceAmerican === null;
        if (
          game.lockState === "locked" &&
          n(market.lockedLineAmerican) !== null &&
          n(market.priceAmerican) !== n(market.lockedLineAmerican) &&
          !neutralLockedFirstInning
        ) {
          push("locked_price_not_frozen", sport, game, slot, market, {
            priceAmerican: market.priceAmerican,
            lockedLineAmerican: market.lockedLineAmerican,
          });
        }
      }
    }
  }

  return {
    ok: summary.criticalIssues === 0,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    summary,
    issues,
  };
}
