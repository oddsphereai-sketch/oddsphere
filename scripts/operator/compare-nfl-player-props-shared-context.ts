import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { NflForwardStoredEvidence } from "../../lib/services/football/nflForwardEvidence";
import type { NflPlayerPropsObservationSnapshot } from "../../lib/services/football/nflPlayerPropsContract";
import {
  buildNflPlayerPropsInferenceContextFromForwardEvidence,
  type NflPlayerPropsInferenceContext,
} from "../../lib/services/football/nflPlayerPropsInferenceContext";
import type { NflPlayerPropsExactOffer } from "../../lib/services/football/nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
} from "../../lib/services/football/nflPlayerPropsRuntime";

async function main(): Promise<void> {
  const observation = await json<NflPlayerPropsObservationSnapshot>(required("--observation"));
  const direct = await json<NflPlayerPropsInferenceContext>(required("--context"));
  const exact = await json<{ evaluatedAt: string; offers: NflPlayerPropsExactOffer[] }>(required("--exact-board"));
  const evidence = direct.games.map((game, index) => ({
    id: `parity-${index}`,
    providerGameId: game.canonicalGameId,
    stage: "unlocked",
    capturedAt: direct.capturedAt,
    gameStartAt: game.scheduledStart,
    payloadSha256: createHash("sha256").update(JSON.stringify(game)).digest("hex"),
    payload: {
      schemaRelease: "nfl_forward_evidence_snapshot_2026_08_23_r3_member",
      season: direct.season,
      week: direct.week,
      capturedAt: direct.capturedAt,
      game: {
        providerGameId: game.canonicalGameId,
        scheduledStart: game.scheduledStart,
        away: { abbreviation: game.awayTeam },
        home: { abbreviation: game.homeTeam },
      },
      market: { currentBooks: game.mainMarket.currentBooks },
      startersAndDepth: { away: game.awayDepth, home: game.homeDepth },
      injuries: game.injuries,
      coverage: { rosterAndDepth: true },
    },
  })) as unknown as NflForwardStoredEvidence[];
  const shared = buildNflPlayerPropsInferenceContextFromForwardEvidence({
    snapshot: observation,
    evidence,
    capturedAt: direct.capturedAt,
  });
  const directFeatures = buildNflPlayerPropsRuntimeFeatureRows({ snapshot: observation, context: direct });
  const sharedFeatures = buildNflPlayerPropsRuntimeFeatureRows({ snapshot: observation, context: shared });
  const directBoard = buildNflPlayerPropsRuntimeBoard({ offers: exact.offers, features: directFeatures, evaluatedAt: exact.evaluatedAt });
  const sharedBoard = buildNflPlayerPropsRuntimeBoard({ offers: exact.offers, features: sharedFeatures, evaluatedAt: exact.evaluatedAt });
  const featureParity = JSON.stringify(directFeatures) === JSON.stringify(sharedFeatures);
  const boardParity = JSON.stringify(directBoard) === JSON.stringify(sharedBoard);
  if (!featureParity || !boardParity) throw new Error(`NFL props shared-context parity failed: features=${featureParity}, board=${boardParity}`);
  console.log(JSON.stringify({
    featureParity,
    boardParity,
    featureRows: sharedFeatures.length,
    counts: sharedBoard.counts,
    directContextProviderBudget: direct.requestBudget.totalMaximum,
    productionContextProviderBudget: shared.requestBudget.totalMaximum,
  }, null, 2));
}

function required(flag: string): string {
  const prefix = `${flag}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}
async function json<T>(filename: string): Promise<T> { return JSON.parse(await readFile(filename, "utf8")) as T; }

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
