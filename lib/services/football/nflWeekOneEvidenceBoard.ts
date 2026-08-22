import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readNflForwardEvidence,
} from "./nflForwardEvidenceStore";
import type {
  NflForwardPlaybookSplitSet,
  NflForwardStoredEvidence,
} from "./nflForwardEvidence";

export const NFL_WEEK_ONE_EVIDENCE_BOARD_RELEASE =
  "nfl_week_one_evidence_board_2026_08_22_r1" as const;

export type NflWeekOneEvidencePriceBoard = {
  sportsbook: string;
  observedAt: string;
  moneyline: {
    awayPrice: number;
    homePrice: number;
  };
  spread: {
    awayLine: number;
    homeLine: number;
    awayPrice: number;
    homePrice: number;
  };
  total: {
    line: number;
    overPrice: number;
    underPrice: number;
  };
};

export type NflWeekOneEvidenceGame = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartAt: string;
  capturedAt: string;
  stage: "opening" | "unlocked" | "t60";
  openingProvenance: "provider_opening" | "first_observed";
  opening: NflWeekOneEvidencePriceBoard;
  current: NflWeekOneEvidencePriceBoard;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  awayQuarterback: {
    name: string | null;
    status: "confirmed" | "projected" | "unknown";
  };
  homeQuarterback: {
    name: string | null;
    status: "confirmed" | "projected" | "unknown";
  };
  awayInjuryCount: number | null;
  homeInjuryCount: number | null;
  weatherStatus: string;
  venueName: string;
  healthHolds: string[];
};

export type NflWeekOneEvidenceBoard = {
  release: typeof NFL_WEEK_ONE_EVIDENCE_BOARD_RELEASE;
  season: number;
  week: number;
  capturedAt: string;
  games: NflWeekOneEvidenceGame[];
  coverage: {
    currentOddsGames: number;
    openingGames: number;
    playbookSplitGames: number;
    sharpSplitGames: number;
    injuryGames: number;
    expectedQuarterbacks: number;
    confirmedQuarterbacks: number;
    weatherReadyGames: number;
  };
  modelPromotionStatus: "blocked_pending_independent_validation";
  publicationEnabled: false;
  trackingEnabled: false;
};

export async function readCurrentNflWeekOneEvidenceBoard(args: {
  client: SupabaseClient;
  season?: number;
  week?: number;
}): Promise<NflWeekOneEvidenceBoard> {
  const season = args.season ?? 2026;
  const week = args.week ?? 1;
  const rows = await readNflForwardEvidence({ client: args.client, season, week });
  return buildNflWeekOneEvidenceBoard(rows);
}

export function buildNflWeekOneEvidenceBoard(
  rows: NflForwardStoredEvidence[],
): NflWeekOneEvidenceBoard {
  if (rows.length === 0) throw new Error("NFL Week 1 forward evidence is empty.");
  const latestByGame = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latestByGame.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latestByGame.set(row.providerGameId, row);
    }
  }
  const latest = [...latestByGame.values()];
  const expectedGames = Math.max(...rows.map((row) => row.payload.slateGameCount));
  if (latest.length !== expectedGames) {
    throw new Error(`NFL Week 1 evidence coverage is ${latest.length}/${expectedGames} games.`);
  }
  const season = latest[0]!.payload.season;
  const week = latest[0]!.payload.week;
  if (latest.some((row) => row.payload.season !== season || row.payload.week !== week)) {
    throw new Error("NFL Week 1 evidence contains mixed season/week identities.");
  }
  if (latest.some((row) => row.payload.decisions.publicationEnabled || row.payload.decisions.trackingEnabled)) {
    throw new Error("NFL evidence-only board cannot contain publication or tracking decisions.");
  }

  const games = latest
    .map((row): NflWeekOneEvidenceGame => {
      const payload = row.payload;
      const awayAvailability = payload.injuries?.teams.find((team) => team.abbreviation === payload.game.away.abbreviation);
      const homeAvailability = payload.injuries?.teams.find((team) => team.abbreviation === payload.game.home.abbreviation);
      return {
        providerGameId: payload.game.providerGameId,
        awayTeam: payload.game.away.abbreviation,
        homeTeam: payload.game.home.abbreviation,
        gameStartAt: payload.game.scheduledStart,
        capturedAt: payload.capturedAt,
        stage: payload.stage,
        openingProvenance: payload.market.operationalOpening.provenance,
        opening: priceBoard(payload.market.operationalOpening.quote),
        current: priceBoard(payload.market.current),
        playbookSplits: payload.market.playbookSplits,
        awayQuarterback: {
          name: payload.startersAndDepth.away.expectedStartingQuarterback?.name ?? null,
          status: payload.startersAndDepth.away.starterStatus,
        },
        homeQuarterback: {
          name: payload.startersAndDepth.home.expectedStartingQuarterback?.name ?? null,
          status: payload.startersAndDepth.home.starterStatus,
        },
        awayInjuryCount: awayAvailability?.players.length ?? null,
        homeInjuryCount: homeAvailability?.players.length ?? null,
        weatherStatus: payload.weather.status,
        venueName: payload.weather.venueName,
        healthHolds: [...payload.coverage.healthHolds],
      };
    })
    .sort((first, second) => Date.parse(first.gameStartAt) - Date.parse(second.gameStartAt));

  return {
    release: NFL_WEEK_ONE_EVIDENCE_BOARD_RELEASE,
    season,
    week,
    capturedAt: games.reduce(
      (latestAt, game) => Date.parse(game.capturedAt) > Date.parse(latestAt) ? game.capturedAt : latestAt,
      games[0]!.capturedAt,
    ),
    games,
    coverage: {
      currentOddsGames: games.length,
      openingGames: games.length,
      playbookSplitGames: latest.filter((row) => row.payload.coverage.playbookSplits).length,
      sharpSplitGames: latest.filter((row) => row.payload.coverage.sharpApiSplits).length,
      injuryGames: latest.filter((row) => row.payload.coverage.injuries).length,
      expectedQuarterbacks: latest.reduce((count, row) => count +
        Number(row.payload.startersAndDepth.away.expectedStartingQuarterback !== null) +
        Number(row.payload.startersAndDepth.home.expectedStartingQuarterback !== null), 0),
      confirmedQuarterbacks: latest.reduce((count, row) => count +
        Number(row.payload.startersAndDepth.away.starterStatus === "confirmed") +
        Number(row.payload.startersAndDepth.home.starterStatus === "confirmed"), 0),
      weatherReadyGames: latest.filter((row) =>
        row.payload.weather.status === "forecast_available" ||
        row.payload.weather.status === "controlled_indoor"
      ).length,
    },
    modelPromotionStatus: "blocked_pending_independent_validation",
    publicationEnabled: false,
    trackingEnabled: false,
  };
}

function priceBoard(value: NflForwardStoredEvidence["payload"]["market"]["current"]): NflWeekOneEvidencePriceBoard {
  const moneyline = value.moneyline;
  const spread = value.spread;
  const total = value.total;
  if (!moneyline || !spread || !total) {
    throw new Error(`NFL Week 1 quote ${value.providerGameId} is incomplete.`);
  }
  return {
    sportsbook: value.sportsbook,
    observedAt: value.observedAt,
    moneyline: {
      awayPrice: moneyline.awayPrice,
      homePrice: moneyline.homePrice,
    },
    spread: {
      awayLine: spread.awayLine,
      homeLine: spread.homeLine,
      awayPrice: spread.awayPrice,
      homePrice: spread.homePrice,
    },
    total: {
      line: total.line,
      overPrice: total.overPrice,
      underPrice: total.underPrice,
    },
  };
}
