export type MlbPropsReleaseOrder = {
  releaseId: string;
  dateRank: number;
  revision: number;
};

const MLB_PROPS_RELEASE_PATTERN = /^mlb_props_(\d{4})_(\d{2})_(\d{2})_r(\d+)$/;

export function parseMlbPropsReleaseOrder(releaseId: string | null | undefined): MlbPropsReleaseOrder | null {
  if (!releaseId) return null;
  const match = MLB_PROPS_RELEASE_PATTERN.exec(releaseId);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const revision = Number(match[4]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    !Number.isInteger(revision)
    || revision < 0
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    releaseId,
    dateRank: year * 10_000 + month * 100 + day,
    revision,
  };
}

export function compareMlbPropsReleaseIds(
  left: string | null | undefined,
  right: string | null | undefined,
): number | null {
  const leftOrder = parseMlbPropsReleaseOrder(left);
  const rightOrder = parseMlbPropsReleaseOrder(right);
  if (!leftOrder || !rightOrder) return null;
  if (leftOrder.dateRank !== rightOrder.dateRank) return leftOrder.dateRank - rightOrder.dateRank;
  return leftOrder.revision - rightOrder.revision;
}

export function assertMlbPropsReleaseDoesNotRegress(args: {
  candidateReleaseId: string | null | undefined;
  currentReleaseId: string | null | undefined;
  candidateTimestamp?: string | null;
  currentTimestamp?: string | null;
}): void {
  const candidate = parseMlbPropsReleaseOrder(args.candidateReleaseId);
  if (!candidate) {
    throw new Error(`Refusing to publish an invalid MLB props release: ${args.candidateReleaseId ?? "missing"}.`);
  }
  if (!args.currentReleaseId) return;
  const current = parseMlbPropsReleaseOrder(args.currentReleaseId);
  if (!current) {
    throw new Error(`Refusing to replace an unrecognized MLB props release: ${args.currentReleaseId}.`);
  }
  const comparison = compareMlbPropsReleaseIds(candidate.releaseId, current.releaseId);
  if (comparison !== null && comparison < 0) {
    throw new Error(
      `MLB props release downgrade blocked: ${candidate.releaseId} cannot replace ${current.releaseId}.`,
    );
  }
  if (comparison === 0 && args.candidateTimestamp && args.currentTimestamp) {
    const candidateMs = Date.parse(args.candidateTimestamp);
    const currentMs = Date.parse(args.currentTimestamp);
    if (!Number.isFinite(candidateMs) || !Number.isFinite(currentMs) || candidateMs < currentMs) {
      throw new Error(
        `MLB props snapshot timestamp regression blocked for ${candidate.releaseId}: `
        + `${args.candidateTimestamp} cannot replace ${args.currentTimestamp}.`,
      );
    }
  }
}
