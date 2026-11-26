import { allocateNbaRegulationMinutes, nbaPlayerStateHash } from "./nbaPlayerStateLedger";
import type { NbaOriginalImpactPlayer, verifyNbaOriginalRoster } from "./nbaOriginalPlayerImpact";
import { NBA_ORIGINAL_PLAYER_IMPACT_RELEASE } from "./nbaOriginalPlayerImpact";

/** Explicit archival reconstruction. R1's first-observed ledger is unchanged. */
export const NBA_ARCHIVED_ROTATION_LEDGER_RELEASE = "nba_archived_rotation_2026_11_23_r7_bounded_source_receipts" as const;
type Roster = ReturnType<typeof verifyNbaOriginalRoster>;
export type NbaArchivedRotationGame = Roster & { season: number; impact: { release: string; sourceAvailableAt: string; sources: readonly { sha256: string; fetchedAt: string; sourceAvailableAt: string }[]; players: readonly NbaOriginalImpactPlayer[] } | null };
export type NbaArchivedMedicalSection = { gameId: string; teamId: number; startAt: string; sourceAvailableAt: string; fetchedAt: string; sha256: string;
  identitySources?: readonly { sha256: string; fetchedAt: string; sourceAvailableAt: string }[];
  excludedOutPlayers?: readonly { playerId: number; sourceName: string; rawStatus: "Out" }[];
  completeSubmitted: boolean; players: readonly { playerId: number; rawStatus: "Out" | "Questionable" | "Doubtful" | "Probable" | "Available" }[] };
type Target = { gameId: string; season: number; homeTeamId: number; awayTeamId: number; startAt: string; cutoff: string };
type Status = NbaArchivedMedicalSection["players"][number]["rawStatus"] | "not_listed_in_submitted_report";
type Player = { playerId: number; status: Status; participation: number; conditionalMinutes: number | null; net: number | null; pie: number | null;
  baselineMinutes: number; expectedMinutes: number; referenceMinutes: number;
  impactCoverage: { windowAppearances: number; observedAppearances: number; windowMinutes: number; observedMinutes: number; unavailableGameIds: string[] } };
type Team = { teamId: number; status: "complete" | "unknown"; reasons: string[]; players: Player[]; netShock: number | null; pieShock: number | null;
  overlapLoss: number | null; outMinuteShare: number | null; rosterChange: boolean | null;
  referenceRotation: { playerId: number; minutes: number; net: number | null; pie: number | null }[] };
const instant = (s: string) => { const n = Date.parse(s); if (!Number.isFinite(n)) throw Error("invalid_archival_clock"); return n; };
const day = (s: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant(s));
const unknown = (teamId: number, reason: string): Team => ({ teamId, status: "unknown", reasons: [reason], players: [], referenceRotation: [], netShock: null, pieShock: null, overlapLoss: null, outMinuteShare: null, rosterChange: null });
export function buildNbaArchivedRotation(args: { target: Target; games: readonly NbaArchivedRotationGame[]; medical: readonly NbaArchivedMedicalSection[];
  membershipUncertainties: readonly { day: string; teamId: number; reason: string }[] }) {
  const t = args.target, cutoff = instant(t.cutoff), cutoffDay = day(t.cutoff);
  if (!/^002\d{7}$/.test(t.gameId) || cutoff !== instant(t.startAt) - 3_600_000 || t.homeTeamId === t.awayTeamId) throw Error("invalid_archival_T60_target");
  if (args.games.length > 10_000 || args.medical.length > 30_000 || args.membershipUncertainties.length > 30_000) throw Error("archival_input_budget");
  // Filter identity and clocks BEFORE touching roster, impact or medical values.
  const prior = args.games.filter(g => g.gameId !== t.gameId && instant(g.startAt) < cutoff && instant(g.sourceAvailableAt) <= cutoff && g.season >= t.season - 1 && g.season <= t.season).sort((a, b) => instant(a.startAt) - instant(b.startAt) || a.gameId.localeCompare(b.gameId));
  const medical = args.medical.filter(m => m.gameId === t.gameId && instant(m.sourceAvailableAt) <= cutoff);
  const receipts = new Map<string, { sha256: string; fetchedAt: string; sourceAvailableAt: string }>();
  const retain = (r: { sha256: string; fetchedAt: string; sourceAvailableAt: string }) => {
    if (!/^[a-f0-9]{64}$/.test(r.sha256) || instant(r.fetchedAt) < instant(r.sourceAvailableAt)) throw Error("invalid_archival_receipt");
    receipts.set(r.sha256, { sha256: r.sha256, fetchedAt: r.fetchedAt, sourceAvailableAt: r.sourceAvailableAt });
  };
  const team = (teamId: number): Team => {
    try {
      const teamGames = prior.filter(g => g.teams.some(s => s.teamId === teamId));
      const roster = teamGames.at(-1); if (!roster) throw Error("missing_prior_original_roster");
      retain(roster);
      const members = roster.teams.find(s => s.teamId === teamId)!.players;
      if (members.length < 5 || new Set(members.map(p => p.playerId)).size !== members.length) throw Error("incomplete_native_membership");
      // Date-only/current movement sources may only flag uncertainty. They
      // cannot establish an invented old publication or intraday membership.
      const rosterDay = day(roster.startAt);
      if (args.membershipUncertainties.some(m => m.day <= cutoffDay && m.day >= rosterDay && m.teamId === teamId)) throw Error("unresolved_membership_interval");
      const reports = medical.filter(m => m.teamId === teamId).sort((a, b) => instant(b.sourceAvailableAt) - instant(a.sourceAvailableAt));
      const report = reports[0]; if (!report || !report.completeSubmitted || instant(report.startAt) !== instant(t.startAt)) throw Error("missing_complete_exact_medical_section");
      if (reports.some(r => r !== report && r.sourceAvailableAt === report.sourceAvailableAt && r.sha256 !== report.sha256)) throw Error("ambiguous_medical_edition");
      retain(report);
      for (const r of report.identitySources ?? []) { if (instant(r.sourceAvailableAt) > cutoff) throw Error("postcutoff_medical_identity"); retain(r); }
      const statuses = new Map<number, Status>();
      for (const p of report.players) { if (statuses.has(p.playerId) || !["Out", "Questionable", "Doubtful", "Probable", "Available"].includes(p.rawStatus)) throw Error("invalid_medical_identity_or_status"); statuses.set(p.playerId, p.rawStatus); }
      if ([...statuses.keys()].some(id => !members.some(p => p.playerId === id))) throw Error("medical_player_not_on_prior_roster");
      for (const p of members) if (!statuses.has(p.playerId)) statuses.set(p.playerId, "not_listed_in_submitted_report");
      const recent = teamGames.slice(-10), referenceIds = new Set(recent.flatMap(g => g.teams.find(s => s.teamId === teamId)!.players.filter(p => p.played && p.seconds > 0).map(p => p.playerId)));
      type Profile = { participation: number; conditionalMinutes: number | null; net: number | null; pie: number | null; weight: number; impactCoverage: Player["impactCoverage"] };
      const profiles = new Map<number, Profile>();
      for (const id of new Set([...members.map(p => p.playerId), ...referenceIds])) {
        const appearances = prior.flatMap(g => g.teams.flatMap(s => s.players.filter(p => p.playerId === id && p.played && p.seconds > 0).map(p => ({ game: g, teamId: s.teamId, player: p }))));
        const sample = [...appearances.filter(a => a.game.season === t.season - 1).slice(-10), ...appearances.filter(a => a.game.season === t.season).slice(-10)];
        const emptyCoverage = { windowAppearances: sample.length, observedAppearances: 0, windowMinutes: 0, observedMinutes: 0, unavailableGameIds: [] as string[] };
        if (!sample.length) { profiles.set(id, { participation: 0, conditionalMinutes: null, net: null, pie: null, weight: 0, impactCoverage: emptyCoverage }); continue; }
        const lastTeam = appearances.at(-1)!.teamId, exposure = prior.filter(g => g.teams.some(s => s.teamId === lastTeam)).slice(-10);
        const participation = exposure.filter(g => g.teams.find(s => s.teamId === lastTeam)!.players.some(p => p.playerId === id && p.played && p.seconds > 0)).length / exposure.length;
        // Observed zero participation gives zero allocation, not invented zero
        // impact. A dormant roster member cannot block an unrelated rotation.
        if (participation === 0) { profiles.set(id, { participation, conditionalMinutes: null, net: null, pie: null, weight: 0, impactCoverage: emptyCoverage }); continue; }
        let minutes = 0, net = 0, pie = 0, observedMinutes = 0, observedAppearances = 0; const unavailableGameIds: string[] = [];
        for (const a of sample) {
          retain(a.game);
          const total = a.game.teams.find(s => s.teamId === a.teamId)!.players.reduce((n, p) => n + p.seconds, 0), m = a.player.seconds / 60 * (14400 / total);
          minutes += m;
          const impact = a.game.impact;
          if (!impact || impact.release !== NBA_ORIGINAL_PLAYER_IMPACT_RELEASE || instant(impact.sourceAvailableAt) > cutoff) { unavailableGameIds.push(a.game.gameId); continue; }
          const p = impact.players.find(p => p.playerId === id);
          if (!p || p.issues.length || p.estimatedNet === null || p.pie === null || !Number.isFinite(p.estimatedNet) || !Number.isFinite(p.pie)) { unavailableGameIds.push(a.game.gameId); continue; }
          for (const r of impact.sources) retain(r);
          observedMinutes += m; observedAppearances++; net += m * p.estimatedNet; pie += m * p.pie;
        }
        // Estimate from observed, individually validated impact only, inside
        // the unchanged fixed appearance windows. Missing metrics stay missing;
        // they are neither zero-filled nor replaced by older outside-window rows.
        if (observedMinutes <= 0) throw Error("no_validated_player_impact_in_window");
        profiles.set(id, { participation, conditionalMinutes: minutes / sample.length, weight: participation * minutes / sample.length, net: net / observedMinutes, pie: pie / observedMinutes,
          impactCoverage: { windowAppearances: sample.length, observedAppearances, windowMinutes: minutes, observedMinutes, unavailableGameIds } });
      }
      const baseline = allocateNbaRegulationMinutes(new Map(members.map(p => [p.playerId, profiles.get(p.playerId)!.weight]))), reference = allocateNbaRegulationMinutes(new Map([...referenceIds].map(id => [id, profiles.get(id)!.weight])));
      if (!baseline || !reference) throw Error("incoherent_archival_reference_rotation");
      const expected = new Map(baseline); let freed = 0;
      for (const [id, m] of baseline) if (statuses.get(id) === "Out") { freed += m; expected.set(id, 0); }
      const capacity = new Map([...baseline].filter(([id, m]) => ["Available", "not_listed_in_submitted_report"].includes(statuses.get(id)!) && m < 48).map(([id, m]) => [id, 48 - m]));
      let remaining = freed;
      for (let i = 0; i <= members.length && remaining > 1e-8; i++) {
        const weight = [...capacity.keys()].reduce((n, id) => n + profiles.get(id)!.weight, 0); if (!weight) throw Error("unavailable_archival_replacement_minutes");
        let added = 0;
        for (const [id, cap] of [...capacity]) { const m = Math.min(cap, remaining * profiles.get(id)!.weight / weight); expected.set(id, expected.get(id)! + m); capacity.set(id, cap - m); added += m; if (cap - m <= 1e-9) capacity.delete(id); }
        remaining -= added;
      }
      if (remaining > 1e-7 || Math.abs([...expected.values()].reduce((a, b) => a + b, 0) - 240) > 1e-7) throw Error("incoherent_archival_240_minutes");
      let netShock = 0, pieShock = 0, overlap = 0;
      for (const id of new Set([...baseline.keys(), ...reference.keys()])) {
        const e = expected.get(id) ?? 0, r = reference.get(id) ?? 0, p = profiles.get(id)!;
        if ((e > 0 || r > 0) && (p.net === null || p.pie === null)) throw Error("positive_rotation_without_impact");
        if (e !== r) { netShock += (e - r) * p.net! / 240; pieShock += (e - r) * p.pie! / 240; } overlap += Math.min(e, r);
      }
      return { teamId, status: "complete", reasons: [], netShock, pieShock, overlapLoss: Math.max(0, 1 - overlap / 240), outMinuteShare: freed / 240,
        rosterChange: [...new Set([...baseline.keys(), ...reference.keys()])].some(id => (baseline.get(id) ?? 0) > 0 !== ((reference.get(id) ?? 0) > 0)),
        referenceRotation: [...reference].sort(([a], [b]) => a - b).map(([playerId, minutes]) => ({ playerId, minutes, net: profiles.get(playerId)!.net, pie: profiles.get(playerId)!.pie })),
        players: [...baseline].sort(([a], [b]) => a - b).map(([playerId, baselineMinutes]) => ({ playerId, status: statuses.get(playerId)!, ...profiles.get(playerId)!, baselineMinutes, expectedMinutes: expected.get(playerId)!, referenceMinutes: reference.get(playerId) ?? 0 })) };
    } catch (e) { return unknown(teamId, e instanceof Error ? e.message : String(e)); }
  };
  let home = team(t.homeTeamId), away = team(t.awayTeamId);
  if (home.status === "complete" && away.status === "complete" && home.players.some(p => away.players.some(q => q.playerId === p.playerId))) { home = unknown(t.homeTeamId, "conflicting_native_membership"); away = unknown(t.awayTeamId, "conflicting_native_membership"); }
  const features = home.status === "complete" && away.status === "complete" ? [home.netShock! - away.netShock!, home.netShock! + away.netShock!, home.pieShock! - away.pieShock!, home.pieShock! + away.pieShock!, home.overlapLoss! - away.overlapLoss!, home.overlapLoss! + away.overlapLoss!] : null;
  const core = { release: NBA_ARCHIVED_ROTATION_LEDGER_RELEASE, reconstruction: "verified_original_publication_actual_current_retrieval" as const, target: t,
    status: features ? "complete" as const : "unknown" as const, teams: [home, away], features, receipts: [...receipts.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) };
  return { ...core, hash: nbaPlayerStateHash(core) };
}
export type NbaArchivedRotationSnapshot = ReturnType<typeof buildNbaArchivedRotation>;
export const NBA_ARCHIVED_ROTATION_SCHEMA_HASH = nbaPlayerStateHash({ release: NBA_ARCHIVED_ROTATION_LEDGER_RELEASE, impactRelease: NBA_ORIGINAL_PLAYER_IMPACT_RELEASE, features: ["estimated_net_difference", "estimated_net_sum", "on_court_pie_difference", "on_court_pie_sum", "overlap_difference", "overlap_sum"], appearancesPerSeason: 10, exposureGames: 10, regulationMinutes: 240, playerCap: 48, outOnly: true, clockMode: "verified_original_publication_actual_current_retrieval" });
export function qualifyNbaArchivedRotation(rows: readonly NbaArchivedRotationSnapshot[], proof?: { schemaHash: string; ledgerHash: string; mutationSuiteSha256: string; receiptsVerified: boolean }) {
  const ledgerHash = nbaPlayerStateHash([...rows].sort((a, b) => a.hash.localeCompare(b.hash))), ids = new Set<string>(), issues: string[] = [], bySeason: Record<number, { complete: number; unknown: number }> = {};
  let selectionComplete = 0, selectionVerifiedChanges = 0;
  for (const row of rows) {
    const { hash, ...core } = row; if (nbaPlayerStateHash(core) !== hash) issues.push("archival_snapshot_hash_mismatch");
    if (row.release !== NBA_ARCHIVED_ROTATION_LEDGER_RELEASE || instant(row.target.cutoff) !== instant(row.target.startAt) - 3_600_000) issues.push("invalid_archival_release_or_cutoff");
    if (row.receipts.some(r => !/^[a-f0-9]{64}$/.test(r.sha256) || instant(r.sourceAvailableAt) > instant(row.target.cutoff) || instant(r.fetchedAt) < instant(r.sourceAvailableAt))) issues.push("invalid_archival_source_clock_or_hash");
    if (row.status === "complete") {
      if (!row.features || row.features.length !== 6 || !row.features.every(Number.isFinite) || row.teams.length !== 2) issues.push("invalid_archival_feature_vector");
      for (const t of row.teams) {
        const positiveImpact = (minutes: number, net: number | null, pie: number | null) => minutes === 0 || net !== null && pie !== null && Number.isFinite(net) && Number.isFinite(pie);
        if (t.status !== "complete" || !t.players.length || new Set(t.players.map(p => p.playerId)).size !== t.players.length || new Set(t.referenceRotation.map(p => p.playerId)).size !== t.referenceRotation.length ||
          t.players.some(p => !Number.isFinite(p.baselineMinutes) || !Number.isFinite(p.expectedMinutes) || p.baselineMinutes < 0 || p.baselineMinutes > 48 || p.expectedMinutes < 0 || p.expectedMinutes > 48 || p.status === "Out" && p.expectedMinutes !== 0 || !positiveImpact(p.expectedMinutes, p.net, p.pie)) ||
          t.referenceRotation.some(p => !Number.isFinite(p.minutes) || p.minutes < 0 || p.minutes > 48 || !positiveImpact(p.minutes, p.net, p.pie)) ||
          Math.abs(t.players.reduce((n, p) => n + p.expectedMinutes, 0) - 240) > 1e-7 || Math.abs(t.players.reduce((n, p) => n + p.baselineMinutes, 0) - 240) > 1e-7 || Math.abs(t.referenceRotation.reduce((n, p) => n + p.minutes, 0) - 240) > 1e-7) { issues.push("invalid_archival_rotation_evidence"); continue; }
        const net = t.players.reduce((n, p) => n + (p.expectedMinutes ? p.expectedMinutes * p.net! / 240 : 0), 0) - t.referenceRotation.reduce((n, p) => n + (p.minutes ? p.minutes * p.net! / 240 : 0), 0);
        const pie = t.players.reduce((n, p) => n + (p.expectedMinutes ? p.expectedMinutes * p.pie! / 240 : 0), 0) - t.referenceRotation.reduce((n, p) => n + (p.minutes ? p.minutes * p.pie! / 240 : 0), 0);
        if (t.netShock === null || t.pieShock === null || Math.abs(net - t.netShock) > 1e-9 || Math.abs(pie - t.pieShock) > 1e-9) issues.push("archival_impact_replay_mismatch");
      }
      const [h, a] = row.teams;
      const expected = h && a ? [h.netShock! - a.netShock!, h.netShock! + a.netShock!, h.pieShock! - a.pieShock!, h.pieShock! + a.pieShock!, h.overlapLoss! - a.overlapLoss!, h.overlapLoss! + a.overlapLoss!] : [];
      if (!row.features || expected.some((v, i) => !Number.isFinite(v) || Math.abs(v - row.features![i]!) > 1e-9)) issues.push("archival_feature_replay_mismatch");
    } else if (row.features !== null) issues.push("unknown_archival_row_has_features");
    if (ids.has(row.target.gameId)) issues.push("duplicate_archival_game"); ids.add(row.target.gameId);
    const cohort = bySeason[row.target.season] ??= { complete: 0, unknown: 0 }; cohort[row.status]++;
    if ([2023, 2024].includes(row.target.season) && row.status === "complete") { selectionComplete++; if (row.teams.some(t => t.rosterChange || t.outMinuteShare! > 0)) selectionVerifiedChanges++; }
  }
  if (selectionComplete < 1000) issues.push("selection_complete_below_1000"); if (selectionVerifiedChanges < 300) issues.push("verified_change_games_below_300");
  if (!proof || proof.schemaHash !== NBA_ARCHIVED_ROTATION_SCHEMA_HASH || proof.ledgerHash !== ledgerHash || !proof.receiptsVerified || !/^[a-f0-9]{64}$/.test(proof.mutationSuiteSha256)) issues.push("archival_frozen_proof_missing");
  return { release: NBA_ARCHIVED_ROTATION_LEDGER_RELEASE, ledgerHash, schemaHash: NBA_ARCHIVED_ROTATION_SCHEMA_HASH, bySeason, selectionComplete, selectionVerifiedChanges, issues: [...new Set(issues)], mayFit: issues.length === 0 };
}
