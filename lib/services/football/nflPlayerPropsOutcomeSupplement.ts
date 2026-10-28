export type NflPlayerPropsOutcomeSupplementRow = Readonly<{
  providerGameId: string;
  playerName: string;
  market: string;
  exactOfferCount: number;
  classification: "official_participated_zero" | "official_nonparticipant" | "unresolved";
  ledgerTreatment: "supplement_settled_actual_zero" | "exclude_from_settled_accuracy" | "remain_unmatched";
  actual: number | null;
}>;

export type NflPlayerPropsOutcomeSupplementIndex = Readonly<{
  release: string;
  rowsByScope: ReadonlyMap<string, NflPlayerPropsOutcomeSupplementRow>;
}>;

export type NflPlayerPropsOutcomeResolution = Readonly<{
  actual: number | null;
  disposition: "stored" | "supplemented" | "excluded" | "unresolved";
}>;

export function parseNflPlayerPropsOutcomeSupplement(
  value: unknown,
  expected: Readonly<{ season: number; week: number }>,
): NflPlayerPropsOutcomeSupplementIndex {
  if (!isObject(value) || value.readOnly !== true || value.productionWrites !== 0
    || value.lockedRecordMutations !== 0 || value.season !== expected.season
    || value.week !== expected.week || typeof value.release !== "string" || !Array.isArray(value.rows)) {
    throw new Error("NFL outcome supplement failed immutability or scope validation.");
  }
  const rowsByScope = new Map<string, NflPlayerPropsOutcomeSupplementRow>();
  for (const candidate of value.rows) {
    const row = parseRow(candidate);
    const key = outcomeSupplementScopeKey(row.providerGameId, row.playerName, row.market);
    const previous = rowsByScope.get(key);
    if (previous && (previous.ledgerTreatment !== row.ledgerTreatment || previous.actual !== row.actual)) {
      throw new Error(`NFL outcome supplement contains conflicting scope evidence for ${key}.`);
    }
    rowsByScope.set(key, row);
  }
  return { release: value.release, rowsByScope };
}

export function resolveNflPlayerPropsOutcome(args: Readonly<{
  storedActual: number | null;
  gameId: string;
  playerName: string;
  market: string;
  supplement: NflPlayerPropsOutcomeSupplementIndex | null;
}>): NflPlayerPropsOutcomeResolution {
  if (args.storedActual !== null) return { actual: args.storedActual, disposition: "stored" };
  const supplemental = args.supplement?.rowsByScope.get(
    outcomeSupplementScopeKey(args.gameId, args.playerName, args.market),
  );
  if (supplemental?.ledgerTreatment === "supplement_settled_actual_zero") {
    return { actual: 0, disposition: "supplemented" };
  }
  if (supplemental?.ledgerTreatment === "exclude_from_settled_accuracy") {
    return { actual: null, disposition: "excluded" };
  }
  return { actual: null, disposition: "unresolved" };
}

export function outcomeSupplementScopeKey(gameId: string, playerName: string, market: string): string {
  return `${gameId}|${normalize(playerName)}|${market}`;
}

function parseRow(value: unknown): NflPlayerPropsOutcomeSupplementRow {
  if (!isObject(value) || typeof value.providerGameId !== "string" || typeof value.playerName !== "string"
    || typeof value.market !== "string" || !Number.isInteger(value.exactOfferCount)
    || typeof value.classification !== "string" || typeof value.ledgerTreatment !== "string") {
    throw new Error("NFL outcome supplement contains a malformed row.");
  }
  const valid = (value.classification === "official_participated_zero"
      && value.ledgerTreatment === "supplement_settled_actual_zero" && value.actual === 0)
    || (value.classification === "official_nonparticipant"
      && value.ledgerTreatment === "exclude_from_settled_accuracy" && value.actual === null)
    || (value.classification === "unresolved"
      && value.ledgerTreatment === "remain_unmatched" && value.actual === null);
  if (!valid) throw new Error("NFL outcome supplement row violates classification/treatment semantics.");
  return value as NflPlayerPropsOutcomeSupplementRow;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
