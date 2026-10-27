/**
 * Per-sport public-splits capability registry — the SINGLE place that encodes,
 * for every sport/model, where public splits come from and how far they may be
 * trusted. The dual-source observation layer, resolved read, UI, and grade
 * modifier all consult this so the architecture is shared across sports, not
 * MLB/WNBA-special-cased. Adding a sport = adding one entry here.
 *
 * `status` gates model/grade authority. `displayStatus`, when present, is a
 * separate audited member-rendering gate:
 *   - "supported"      : verified; may be observed, displayed, and (where the
 *                        model-impact gate has cleared) influence grades.
 *   - "audit_required" : a provider lists the sport but model-impact quality
 *                        is not verified. SAFE to OBSERVE; may render only
 *                        when a separate displayStatus audit has cleared it.
 *   - "unsupported"    : no trusted public-splits source. Never display public
 *                        splits; bars stay empty (honest "unavailable").
 *
 * `sharpSignalsProvider` records who currently fills sharp_signals.public_* for
 * the sport (provenance for the observation mirror): MLB=SharpAPI, WNBA=Playbook.
 */

export type PublicSplitsStatus = "supported" | "audit_required" | "unsupported";

export type SportSplitsCapability = {
  /** Who currently populates sharp_signals.public_* for this sport. */
  sharpSignalsProvider: "sharpapi" | "playbook" | "none";
  /** Playbook provides public splits for this sport (provider-level coverage). */
  playbookSplits: boolean;
  /** SharpAPI provides public splits for this sport. */
  sharpApiSplits: boolean;
  status: PublicSplitsStatus;
  /**
   * Separately audited member-display authority. This may be `supported`
   * while `status` remains `audit_required`: rendering verified source rows
   * does not authorize those rows to alter a model, grade, or stake.
   */
  displayStatus?: PublicSplitsStatus;
  note: string;
};

export const PUBLIC_SPLITS_CAPABILITY: Record<string, SportSplitsCapability> = {
  mlb: {
    sharpSignalsProvider: "sharpapi", playbookSplits: true, sharpApiSplits: true,
    status: "supported",
    note: "Model-impacting now; dual-source target. SharpAPI extreme money% vs Playbook balanced -> agreement confidence modifier (Phase 3).",
  },
  wnba: {
    sharpSignalsProvider: "playbook", playbookSplits: true, sharpApiSplits: false,
    status: "supported",
    note: "Playbook fills the gap (no SharpAPI WNBA splits). Display-only today; not in grades until a WNBA model-impact audit clears it.",
  },
  soccer: {
    sharpSignalsProvider: "sharpapi", playbookSplits: false, sharpApiSplits: true,
    status: "unsupported",
    note: "World Cup/intl: Playbook does NOT cover; SharpAPI /splits is empty_as_of_probe. No public splits unless separately verified.",
  },
  ucl: {
    sharpSignalsProvider: "none", playbookSplits: false, sharpApiSplits: false,
    status: "unsupported",
    note: "Same as soccer — verify a real source before any public-split use.",
  },
  nba: {
    sharpSignalsProvider: "none", playbookSplits: true, sharpApiSplits: false,
    status: "audit_required",
    displayStatus: "supported",
    note: "Display-only approved 2026-10-16 after a 48/48 current-board game-market audit of complete coherent Playbook pairs. Model/grade use remains audit_required pending immutable forward validation.",
  },
  nhl: {
    sharpSignalsProvider: "none", playbookSplits: true, sharpApiSplits: false,
    status: "supported",
    note: "Playbook owns Public Consensus. Owls owns fresh named-book splits through Market Intelligence V2; no active SharpAPI split request remains.",
  },
  nfl: {
    sharpSignalsProvider: "none", playbookSplits: true, sharpApiSplits: false,
    status: "audit_required",
    note: "Playbook strong NFL coverage; the app sport is a stub. Audit before use.",
  },
  cfb: {
    sharpSignalsProvider: "none", playbookSplits: true, sharpApiSplits: false,
    status: "audit_required",
    note: "Playbook ncaaf; app stub. Audit before use.",
  },
  cbb: {
    sharpSignalsProvider: "none", playbookSplits: true, sharpApiSplits: false,
    status: "audit_required",
    note: "Playbook ncaab; app stub. Audit before use.",
  },
};

const UNKNOWN: SportSplitsCapability = {
  sharpSignalsProvider: "none", playbookSplits: false, sharpApiSplits: false,
  status: "unsupported", note: "unknown sport — treated as unsupported (no public splits).",
};

export function publicSplitsCapability(sport: string): SportSplitsCapability {
  return PUBLIC_SPLITS_CAPABILITY[sport] ?? UNKNOWN;
}

/** Observe Playbook splits for this sport? (read-only; includes audit_required for data-gathering, excludes unsupported). */
export function shouldObservePlaybook(sport: string): boolean {
  const c = publicSplitsCapability(sport);
  return c.playbookSplits && c.status !== "unsupported";
}

/** May public splits be DISPLAYED / promoted for this sport? (verified only). */
export function publicSplitsSupported(sport: string): boolean {
  return publicSplitsCapability(sport).status === "supported";
}

/**
 * May verified public splits be rendered to members? This deliberately does
 * not grant model/grade authority; `publicSplitsSupported` remains the only
 * model-impact gate.
 */
export function publicSplitsDisplaySupported(sport: string): boolean {
  const capability = publicSplitsCapability(sport);
  return (capability.displayStatus ?? capability.status) === "supported";
}
