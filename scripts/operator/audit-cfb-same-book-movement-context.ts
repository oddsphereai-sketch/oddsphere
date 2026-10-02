#!/usr/bin/env tsx

/** Read-only current-board comparison isolating opening/current sportsbook identity. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  currentCfbMovementContextBook,
} from "../../lib/services/football/cfbForwardEvidenceWriter";
import { applyCfbMarketSharpAwareGrades } from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { preferredCfbTargetBook } from "../../lib/services/football/cfbSharpApiOdds";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import type { CfbV1DecisionBundle, CfbV1Grade } from "../../lib/services/football/cfbV1Decision";
import {
  applyCfbVerifiedAvailabilityGradeCap,
  verifiedCfbQuarterbackAvailability,
} from "../../lib/services/football/cfbVerifiedAvailability";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const stored = await readCfbForwardWriterEvidence({ client, season: 2026 });
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof stored.evidence)[number]>();
  for (const row of stored.evidence) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }

  const rows = [...latest.values()].flatMap((row) => {
    const payload = row.payload;
    const rawBundle = {
      ...payload.decisions,
      evaluatedBets: payload.decisions.evaluatedBets.map((decision) => ({
        ...decision,
        grade: decision.probabilityGrade,
        gradeAdjustment: null,
      })),
    } as unknown as CfbV1DecisionBundle;
    const common = {
      bundle: rawBundle,
      homeTeam: payload.game.home.abbreviation,
      sharpSplits: payload.market.sharpApiSplits ?? [],
      playbookLine: payload.market.playbookLine,
      publicSplits: payload.market.playbookSplits,
      operationalOpening: payload.market.operationalOpening,
    };
    const incumbentCurrent = preferredCfbTargetBook(payload.market.currentBooks);
    const sameBookCurrent = currentCfbMovementContextBook(payload.market.currentBooks, payload.market.operationalOpening);
    const incumbent = applyCfbMarketSharpAwareGrades({ ...common, current: incumbentCurrent });
    const candidate = applyCfbVerifiedAvailabilityGradeCap({
      bundle: applyCfbMarketSharpAwareGrades({ ...common, current: sameBookCurrent }),
      availability: verifiedCfbQuarterbackAvailability(payload.game.providerGameId),
    });
    const candidateByMarket = new Map(candidate.evaluatedBets.map((decision) => [decision.market, decision]));
    return incumbent.evaluatedBets.map((decision) => {
      const next = candidateByMarket.get(decision.market)!;
      return {
        providerGameId: row.providerGameId,
        game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        market: decision.market,
        openingBook: payload.market.operationalOpening?.quote.sportsbook ?? null,
        incumbentCurrentBook: incumbentCurrent?.sportsbook ?? null,
        sameBookCurrentBook: sameBookCurrent?.sportsbook ?? null,
        side: decision.side,
        incumbentGrade: decision.grade,
        candidateGrade: next.grade,
        incumbentMovement: decision.gradeAdjustment?.movementDirection ?? null,
        candidateMovement: next.gradeAdjustment?.movementDirection ?? null,
      };
    });
  });
  const promotions = rows.filter((row) => rank(row.candidateGrade) > rank(row.incumbentGrade));
  const demotions = rows.filter((row) => rank(row.candidateGrade) < rank(row.incumbentGrade));
  const changedMovement = rows.filter((row) => row.incumbentMovement !== row.candidateMovement);
  const delaware = rows.filter((row) => row.providerGameId === "457727");
  console.log(JSON.stringify({
    release: "cfb_same_book_movement_availability_audit_2026_10_02_r2",
    readOnly: true,
    providerRequests: 0,
    writes: 0,
    games: latest.size,
    markets: rows.length,
    incumbentActionable: rows.filter((row) => actionable(row.incumbentGrade)).length,
    candidateActionable: rows.filter((row) => actionable(row.candidateGrade)).length,
    promotions: promotions.length,
    demotions: demotions.length,
    changedMovement: changedMovement.length,
    promotionRows: promotions,
    demotionRows: demotions,
    delaware,
  }, null, 2));
}

function rank(grade: CfbV1Grade): number { return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 : 1; }
function actionable(grade: CfbV1Grade): boolean { return grade === "Best Angle" || grade === "Lean"; }

void main();
