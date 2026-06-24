/**
 * Playbook public-splits overlay helper.
 *
 * This is the safe promotion boundary for sports where SharpAPI already owns
 * EV/fair/steam/RLM rows but Playbook may be the preferred public bet% /
 * money% source.
 *
 * Contract:
 *   - Overlay ONLY public_betting_pct / public_money_pct / computed_at.
 *   - Preserve SharpAPI-owned EV, fair probability, steam, and RLM fields.
 *   - Missing/null Playbook public cells do not erase existing public fields.
 *   - Playbook-only rows may be appended as public-only rows from the mapper.
 */

import type { SharpSignalRecord } from "../interfaces/ISharpSignalProvider";

export type PlaybookPublicSplitsOverlayStats = {
  baseRecordsRead: number;
  overlayRecordsRead: number;
  recordsOutput: number;
  publicFieldsUpdated: number;
  playbookOnlyRowsAppended: number;
  overlayRowsSkippedNoPublicCells: number;
  duplicateOverlayRowsIgnored: number;
};

function signalKey(r: SharpSignalRecord): string {
  return `${r.game_external_id}::${r.market_type}::${r.side}`;
}

function hasPublicCell(r: SharpSignalRecord): boolean {
  return r.public_betting_pct !== null || r.public_money_pct !== null;
}

export function overlayPlaybookPublicSplits(
  baseRecords: readonly SharpSignalRecord[],
  playbookPublicRecords: readonly SharpSignalRecord[]
): { records: SharpSignalRecord[]; stats: PlaybookPublicSplitsOverlayStats } {
  const stats: PlaybookPublicSplitsOverlayStats = {
    baseRecordsRead: baseRecords.length,
    overlayRecordsRead: playbookPublicRecords.length,
    recordsOutput: 0,
    publicFieldsUpdated: 0,
    playbookOnlyRowsAppended: 0,
    overlayRowsSkippedNoPublicCells: 0,
    duplicateOverlayRowsIgnored: 0,
  };

  const overlayByKey = new Map<string, SharpSignalRecord>();
  for (const overlay of playbookPublicRecords) {
    if (!hasPublicCell(overlay)) {
      stats.overlayRowsSkippedNoPublicCells++;
      continue;
    }
    const key = signalKey(overlay);
    if (overlayByKey.has(key)) {
      stats.duplicateOverlayRowsIgnored++;
      continue;
    }
    overlayByKey.set(key, overlay);
  }

  const seenBaseKeys = new Set<string>();
  const records = baseRecords.map((base) => {
    const key = signalKey(base);
    seenBaseKeys.add(key);
    const overlay = overlayByKey.get(key);
    if (!overlay) return { ...base };

    const nextBetting = overlay.public_betting_pct ?? base.public_betting_pct;
    const nextMoney = overlay.public_money_pct ?? base.public_money_pct;
    const changed =
      nextBetting !== base.public_betting_pct ||
      nextMoney !== base.public_money_pct;
    if (!changed) return { ...base };

    stats.publicFieldsUpdated++;
    return {
      ...base,
      public_betting_pct: nextBetting,
      public_money_pct: nextMoney,
      computed_at: overlay.computed_at,
    };
  });

  for (const [key, overlay] of overlayByKey) {
    if (seenBaseKeys.has(key)) continue;
    records.push({ ...overlay });
    stats.playbookOnlyRowsAppended++;
  }

  stats.recordsOutput = records.length;
  return { records, stats };
}
