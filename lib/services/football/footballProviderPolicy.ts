export const FOOTBALL_PROVIDER_POLICY_RELEASE = "football_provider_policy_2026_08_19_r1" as const;

export type FootballProvider = "balldontlie" | "playbook" | "sharpapi" | "nflverse" | "collegefootballdata";

export const FOOTBALL_PROVIDER_POLICY = {
  release: FOOTBALL_PROVIDER_POLICY_RELEASE,
  scheduleAndIdentity: {
    preferred: ["balldontlie"] as FootballProvider[],
    rule: "Sports-specific provider identity is canonical; every secondary market event must reconcile to it.",
  },
  historicalResearchStats: {
    nfl: ["nflverse", "balldontlie"] as FootballProvider[],
    ncaaf: ["collegefootballdata", "balldontlie"] as FootballProvider[],
    rule: "Bulk season files are cached once locally; provider APIs fill audited gaps rather than serving member reads.",
  },
  currentTeamPlayerStats: {
    preferred: ["balldontlie", "playbook"] as FootballProvider[],
    rule: "Select field-by-field on freshness, definition, null rate, and identity match; never average duplicate stats.",
  },
  namedSportsbookPrices: {
    candidates: ["balldontlie", "sharpapi"] as FootballProvider[],
    rule: "Choose complete synchronized two-way pairs by event/book/market/line/time; coverage and freshness decide, not a global provider winner.",
  },
  consensusLines: {
    contextOnly: ["playbook"] as FootballProvider[],
    rule: "Playbook consensus is context and fallback point-line evidence, never a named sportsbook price or proof of movement.",
  },
  publicConsensusSplits: {
    candidates: ["playbook"] as FootballProvider[],
    rule: "Label as consensus bets/money with books-used and freshness; missing timestamps or incoherent pairs fail closed.",
  },
  sourceBookSplits: {
    candidates: ["sharpapi"] as FootballProvider[],
    rule: "Keep each book separate. Circa/DraftKings/BetMGM percentages are source-book observations, not verified bettor identity or automatic sharp-money labels.",
  },
  movementAndClosing: {
    candidates: ["sharpapi", "balldontlie"] as FootballProvider[],
    rule: "Movement comes only from stored chronological observations of the same named source; closing data is evaluation-only after the pregame lock.",
  },
  playerPropPrices: {
    candidates: ["sharpapi", "balldontlie"] as FootballProvider[],
    rule: "Run coverage and settlement audits by prop family; do not choose one provider globally or use provider projections as labels.",
  },
} as const;
