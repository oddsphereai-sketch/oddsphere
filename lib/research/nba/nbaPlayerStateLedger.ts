import { createHash } from "node:crypto";

/** Offline only. No production caller, persistence, provider or outcome join. */
export const NBA_PLAYER_STATE_LEDGER_RELEASE = "nba_player_state_ledger_2026_11_20_r1_expected_rotation" as const;
type Provider = "balldontlie" | "espn" | "official_nba";
type Status = "available" | "out" | "questionable" | "probable" | "unknown";
type Native = `${Provider}:${string}`;
type Receipt = { id: string; provider: Provider; publishedAt: string; fetchedAt: string; effectiveAt: string;
  payloadSha256: string; collectorRelease: string };
type Identity = { kind: "identity"; nativePlayer: Native; playerId: number };
type Roster = { kind: "roster"; teamId: number; complete: boolean;
  members: readonly { nativePlayer: Native; validFrom: string; validTo: string | null }[] };
type Availability = { kind: "availability"; gameId: number; teamId: number; complete: boolean;
  players: readonly { nativePlayer: Native; status: Status }[] };
type Stat = { kind: "stat"; gameId: number; teamId: number; season: number; startedAt: string; final: boolean;
  complete: boolean; players: readonly { nativePlayer: Native; minutes: number; estimatedNet: number | null; pie: number | null }[] };
export type NbaPlayerStateObservation = Receipt & (Identity | Roster | Availability | Stat);
export type NbaPlayerStateTarget = { gameId: number; season: number; homeTeamId: number; awayTeamId: number; startAt: string; cutoff: string };
type Player = { playerId: number; participation: number; conditionalMinutes: number; net: number; pie: number;
  baselineMinutes: number; expectedMinutes: number; referenceMinutes: number; status: Status; tenureDays: number };
type Team = { teamId: number; status: "complete" | "unknown"; reasons: string[]; players: Player[];
  netShock: number | null; pieShock: number | null; overlapLoss: number | null; outMinuteShare: number | null;
  referenceRotation: readonly { playerId: number; minutes: number; net: number; pie: number }[];
  topOneOutShare: number | null; topThreeOutShare: number | null; rosterChange: boolean | null };
export type NbaPlayerStateSnapshot = { release: typeof NBA_PLAYER_STATE_LEDGER_RELEASE; target: NbaPlayerStateTarget;
  status: "complete" | "unknown"; teams: readonly Team[]; features: readonly number[] | null;
  receipts: readonly { id: string; payloadSha256: string; collectorRelease: string }[]; hash: string };
const instant = (v: string) => { const x = Date.parse(v); if (!Number.isFinite(x)) throw Error("invalid_clock"); return x; };
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export function nbaPlayerStateHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function unknown(teamId: number, reason: string): Team { return { teamId, status: "unknown", reasons: [reason], players: [],
  netShock: null, pieShock: null, overlapLoss: null, outMinuteShare: null, referenceRotation: [], topOneOutShare: null, topThreeOutShare: null, rosterChange: null }; }
/** Proportional constrained allocation, not a score/grade threshold. */
export function allocateNbaRegulationMinutes(weights: ReadonlyMap<number, number>, total = 240): Map<number, number> | null {
  if (!Number.isFinite(total) || total < 0 || total > weights.size * 48 || [...weights].some(([id, w]) => !positive(id) || !Number.isFinite(w) || w < 0)) return null;
  const ordered = [...weights].sort(([a], [b]) => a - b);
  const result = new Map(ordered.map(([id]) => [id, 0]));
  let remaining = total; const active = new Map(ordered.filter(([, w]) => w > 0));
  for (let iteration = 0; iteration <= weights.size && remaining > 1e-9; iteration++) {
    const sum = [...active.values()].reduce((a, b) => a + b, 0); if (!sum) return null;
    const capped = [...active].filter(([, w]) => remaining * w / sum > 48);
    if (!capped.length) { for (const [id, w] of active) result.set(id, remaining * w / sum); remaining = 0; break; }
    for (const [id] of capped) { result.set(id, 48); active.delete(id); remaining -= 48; }
  }
  return remaining <= 1e-9 && Math.abs([...result.values()].reduce((a, b) => a + b, 0) - total) <= 1e-7 ? result : null;
}
export function buildNbaPlayerStateSnapshot(args: { target: NbaPlayerStateTarget; observations: readonly NbaPlayerStateObservation[] }): NbaPlayerStateSnapshot {
  const t = args.target, cutoff = instant(t.cutoff);
  if (![t.gameId, t.homeTeamId, t.awayTeamId, t.season].every(positive) || t.homeTeamId === t.awayTeamId || cutoff > instant(t.startAt) - 60 * 60_000) throw Error("invalid_T60_target");
  if (args.observations.length > 200_000) throw Error("observation_budget_exceeded");
  // Exclude target outcomes and later evidence before inspecting feature fields.
  const eligible = args.observations.filter(o => !(o.kind === "stat" && o.gameId === t.gameId) &&
    instant(o.fetchedAt) <= cutoff && instant(o.publishedAt) <= cutoff && instant(o.effectiveAt) <= cutoff &&
    (o.kind !== "stat" || instant(o.startedAt) < cutoff));
  const used = new Map<string, Receipt>();
  const markUsed = (o: Receipt) => { used.set(o.id, o); };
  let invalid: string | null = null; const ids = new Map<string, string>();
  for (const o of eligible) {
    if (!o.id || !/^[a-f0-9]{64}$/.test(o.payloadSha256) || !o.collectorRelease || instant(o.publishedAt) > instant(o.fetchedAt)) invalid = "invalid_receipt";
    if (o.kind === "stat" && (![o.gameId, o.teamId, o.season].every(positive) || instant(o.publishedAt) < instant(o.startedAt))) invalid = "invalid_stat_identity_or_clock";
    if (o.kind === "roster" && !positive(o.teamId) || o.kind === "availability" && ![o.gameId, o.teamId].every(positive)) invalid = "invalid_team_or_game_identity";
    const bytes = canonical(o); if (ids.has(o.id) && ids.get(o.id) !== bytes) invalid = "conflicting_receipt_identity"; ids.set(o.id, bytes);
  }
  const identity = new Map<Native, { playerId: number; rows: NbaPlayerStateObservation[] }>();
  for (const o of eligible) if (o.kind === "identity") {
    const prev = identity.get(o.nativePlayer);
    if (!positive(o.playerId) || !/^(balldontlie|espn|official_nba):[^:]+$/.test(o.nativePlayer) || o.nativePlayer.startsWith("balldontlie:") && o.nativePlayer !== `balldontlie:${o.playerId}` || prev && prev.playerId !== o.playerId) invalid = "ambiguous_player_identity";
    identity.set(o.nativePlayer, { playerId: o.playerId, rows: [...(prev?.rows ?? []), o] });
  }
  const resolve = (native: Native) => { const match = identity.get(native); if (!match) throw Error("missing_native_identity"); match.rows.forEach(markUsed); return match.playerId; };
  const latest = <T extends NbaPlayerStateObservation>(rows: T[], missing = "missing_evidence"): T => {
    if (!rows.length) throw Error(missing);
    rows.sort((a, b) => instant(b.effectiveAt) - instant(a.effectiveAt) || instant(b.publishedAt) - instant(a.publishedAt) || instant(b.fetchedAt) - instant(a.fetchedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const top = rows[0]!; if (rows.some(o => o !== top && instant(o.effectiveAt) === instant(top.effectiveAt) && instant(o.publishedAt) === instant(top.publishedAt) && instant(o.fetchedAt) === instant(top.fetchedAt) && o.payloadSha256 !== top.payloadSha256)) throw Error("ambiguous_same_clock_evidence");
    markUsed(top); return top;
  };
  const team = (teamId: number): Team => {
    if (invalid) return unknown(teamId, invalid);
    try {
      const roster = latest(eligible.filter((o): o is Receipt & Roster => o.kind === "roster" && o.teamId === teamId), "missing_effective_roster");
      const availability = latest(eligible.filter((o): o is Receipt & Availability => o.kind === "availability" && o.gameId === t.gameId && o.teamId === teamId), "missing_exact_game_availability");
      if (!roster.complete || !availability.complete) throw Error("incomplete_roster_or_availability");
      const members = new Map<number, number>();
      for (const m of roster.members) {
        if (instant(m.validFrom) > cutoff || m.validTo !== null && instant(m.validTo) <= cutoff) continue;
        const id = resolve(m.nativePlayer); if (members.has(id)) throw Error("duplicate_roster_player"); members.set(id, instant(m.validFrom));
      }
      if (members.size < 5 || members.size > 25) throw Error("incomplete_roster");
      const statuses = new Map<number, Status>();
      for (const p of availability.players) { if (!["available", "out", "questionable", "probable", "unknown"].includes(p.status)) throw Error("invalid_availability_status"); const id = resolve(p.nativePlayer); if (statuses.has(id)) throw Error("duplicate_availability_player"); statuses.set(id, p.status); }
      for (const id of members.keys()) if (!statuses.has(id) || statuses.get(id) === "unknown") throw Error("unknown_player_availability");
      type ResolvedStat = { observation: Receipt & Stat; players: Map<number, { minutes: number; net: number; pie: number }> };
      const byGame = new Map<string, (Receipt & Stat)[]>();
      for (const o of eligible) if (o.kind === "stat" && o.season >= t.season - 1 && o.season <= t.season) { const key = `${o.gameId}:${o.teamId}`; byGame.set(key, [...(byGame.get(key) ?? []), o]); }
      const stats: ResolvedStat[] = [];
      for (const rows of byGame.values()) {
        // Select corrections by original evidence clocks, never present-day cache order.
        const o = latest(rows); if (!o.final || !o.complete) continue;
        const players = new Map<number, { minutes: number; net: number; pie: number }>(); let minutes = 0;
        for (const p of o.players) {
          if (!Number.isFinite(p.minutes) || p.minutes < 0 || p.minutes > 80) throw Error("invalid_stat_minutes");
          if (p.minutes === 0) continue;
          const id = resolve(p.nativePlayer); if (players.has(id)) throw Error("duplicate_player_game");
          if (p.estimatedNet === null || p.pie === null || !Number.isFinite(p.estimatedNet) || !Number.isFinite(p.pie)) throw Error("missing_player_impact");
          players.set(id, { minutes: p.minutes, net: p.estimatedNet, pie: p.pie }); minutes += p.minutes;
        }
        if (minutes < 239 || minutes > 400 || Math.abs((minutes - 240) / 25 - Math.round((minutes - 240) / 25)) > .05) throw Error("incomplete_team_stat_minutes");
        for (const p of players.values()) p.minutes *= 240 / minutes;
        stats.push({ observation: o, players });
      }
      stats.sort((a, b) => instant(a.observation.startedAt) - instant(b.observation.startedAt) || a.observation.gameId - b.observation.gameId);
      const recentTeam = stats.filter(s => s.observation.teamId === teamId).slice(-10);
      if (!recentTeam.length) throw Error("missing_reference_rotation");
      const referenceIds = new Set(recentTeam.flatMap(s => [...s.players.keys()]));
      const profiles = new Map<number, { participation: number; conditionalMinutes: number; net: number; pie: number; weight: number }>();
      for (const id of new Set([...members.keys(), ...referenceIds])) {
        const appearances = stats.filter(s => s.players.has(id));
        const current = appearances.filter(s => s.observation.season === t.season).slice(-10);
        const prior = appearances.filter(s => s.observation.season === t.season - 1).slice(-10);
        if (!current.length && !prior.length) throw Error("missing_player_prior");
        const sample = [...prior, ...current];
        const lastTeam = appearances.at(-1)!.observation.teamId;
        const exposure = stats.filter(s => s.observation.teamId === lastTeam).slice(-10);
        const participation = exposure.filter(s => s.players.has(id)).length / exposure.length;
        const minutes = sample.reduce((sum, s) => sum + s.players.get(id)!.minutes, 0);
        const conditionalMinutes = minutes / sample.length;
        profiles.set(id, { participation, conditionalMinutes, weight: participation * conditionalMinutes,
          net: sample.reduce((sum, s) => sum + s.players.get(id)!.minutes * s.players.get(id)!.net, 0) / minutes,
          pie: sample.reduce((sum, s) => sum + s.players.get(id)!.minutes * s.players.get(id)!.pie, 0) / minutes });
      }
      const baseline = allocateNbaRegulationMinutes(new Map([...members.keys()].map(id => [id, profiles.get(id)!.weight])));
      const reference = allocateNbaRegulationMinutes(new Map([...referenceIds].map(id => [id, profiles.get(id)!.weight])));
      if (!baseline || !reference) throw Error("incoherent_baseline_rotation");
      const expected = new Map(baseline); let freed = 0;
      for (const [id, m] of baseline) if (statuses.get(id) === "out") { freed += m; expected.set(id, 0); }
      const available = [...baseline].filter(([id]) => statuses.get(id) === "available");
      let remaining = freed;
      const capacity = new Map(available.filter(([, m]) => m < 48).map(([id, m]) => [id, 48 - m]));
      for (let i = 0; i <= members.size && remaining > 1e-8; i++) {
        const weight = [...capacity.keys()].reduce((sum, id) => sum + profiles.get(id)!.weight, 0); if (!weight) throw Error("unavailable_replacement_minutes");
        const shares = [...capacity].map(([id, cap]) => [id, Math.min(cap, remaining * profiles.get(id)!.weight / weight)] as const);
        let added = 0; for (const [id, m] of shares) { expected.set(id, expected.get(id)! + m); capacity.set(id, capacity.get(id)! - m); added += m; if (capacity.get(id)! <= 1e-9) capacity.delete(id); }
        remaining -= added;
      }
      if (remaining > 1e-7 || Math.abs([...expected.values()].reduce((a, b) => a + b, 0) - 240) > 1e-7) throw Error("incoherent_240_minute_rotation");
      const allIds = [...new Set([...members.keys(), ...referenceIds])].sort((a, b) => a - b);
      const netShock = allIds.reduce((sum, id) => sum + ((expected.get(id) ?? 0) - (reference.get(id) ?? 0)) * profiles.get(id)!.net / 240, 0);
      const pieShock = allIds.reduce((sum, id) => sum + ((expected.get(id) ?? 0) - (reference.get(id) ?? 0)) * profiles.get(id)!.pie / 240, 0);
      const overlapLoss = Math.max(0, 1 - allIds.reduce((sum, id) => sum + Math.min(expected.get(id) ?? 0, reference.get(id) ?? 0), 0) / 240);
      const outs = [...baseline].filter(([id]) => statuses.get(id) === "out").map(([, m]) => m / 240).sort((a, b) => b - a);
      return { teamId, status: "complete", reasons: [], netShock, pieShock, overlapLoss, outMinuteShare: freed / 240,
        topOneOutShare: outs[0] ?? 0, topThreeOutShare: outs.slice(0, 3).reduce((a, b) => a + b, 0),
        referenceRotation: [...reference].sort(([a], [b]) => a - b).map(([id, minutes]) => ({ playerId: id, minutes, net: profiles.get(id)!.net, pie: profiles.get(id)!.pie })),
        rosterChange: allIds.some(id => members.has(id) !== referenceIds.has(id)),
        players: [...members].sort(([a], [b]) => a - b).map(([id, since]) => ({ playerId: id, ...profiles.get(id)!,
          baselineMinutes: baseline.get(id)!, expectedMinutes: expected.get(id)!, referenceMinutes: reference.get(id) ?? 0,
          status: statuses.get(id)!, tenureDays: (cutoff - since) / 86_400_000 })) };
    } catch (error) { return unknown(teamId, error instanceof Error ? error.message : "invalid_evidence"); }
  };
  let home = team(t.homeTeamId), away = team(t.awayTeamId);
  if (home.status === "complete" && away.status === "complete" && home.players.some(p => away.players.some(q => q.playerId === p.playerId))) {
    home = unknown(t.homeTeamId, "conflicting_team_membership"); away = unknown(t.awayTeamId, "conflicting_team_membership");
  }
  const features = home.status === "complete" && away.status === "complete" ?
    [home.netShock! - away.netShock!, home.netShock! + away.netShock!, home.pieShock! - away.pieShock!, home.pieShock! + away.pieShock!, home.overlapLoss! - away.overlapLoss!, home.overlapLoss! + away.overlapLoss!] : null;
  const core = { release: NBA_PLAYER_STATE_LEDGER_RELEASE, target: t, status: features ? "complete" as const : "unknown" as const,
    teams: [home, away], features, receipts: [...used.values()].map(o => ({ id: o.id, payloadSha256: o.payloadSha256, collectorRelease: o.collectorRelease })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  return { ...core, hash: nbaPlayerStateHash(core) };
}
export const NBA_PLAYER_STATE_SCHEMA_HASH = nbaPlayerStateHash({ release: NBA_PLAYER_STATE_LEDGER_RELEASE,
  features: ["net_difference", "net_sum", "pie_difference", "pie_sum", "overlap_difference", "overlap_sum"],
  historyGames: 10, priorAppearances: 10, regulationMinutes: 240, maximumPlayerMinutes: 48 });
export function qualifyNbaPlayerStateLedger(rows: readonly NbaPlayerStateSnapshot[], proof?: {
  schemaHash: string; ledgerHash: string; mutationSuiteSha256: string; receiptsVerified: boolean;
}) {
  const ledgerHash = nbaPlayerStateHash([...rows].sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const unique = new Set<string>(), selectionGames = new Set<number>(); let selectionComplete = 0, selectionVerifiedChanges = 0; const issues: string[] = [];
  const bySeason: Record<number, { complete: number; unknown: number }> = {};
  for (const row of rows) {
    const { hash, ...core } = row;
    if (hash !== nbaPlayerStateHash(core)) issues.push("snapshot_hash_mismatch");
    const key = `${row.target.gameId}:${row.target.cutoff}`; if (unique.has(key)) issues.push("duplicate_game_cutoff"); unique.add(key);
    const cohort = bySeason[row.target.season] ??= { complete: 0, unknown: 0 }; cohort[row.status]++;
    if ([2023, 2024].includes(row.target.season) && row.status === "complete") {
      if (selectionGames.has(row.target.gameId)) { issues.push("duplicate_selection_game"); continue; }
      selectionGames.add(row.target.gameId);
      if (instant(row.target.cutoff) !== instant(row.target.startAt) - 60 * 60_000) { issues.push("selection_not_exact_T60"); continue; }
      selectionComplete++;
      if (row.teams.some(t => t.rosterChange || t.outMinuteShare! > 0)) selectionVerifiedChanges++;
    }
  }
  if (selectionComplete < 1000) issues.push("selection_complete_below_1000");
  if (selectionVerifiedChanges < 300) issues.push("verified_change_games_below_300");
  if (!proof || proof.schemaHash !== NBA_PLAYER_STATE_SCHEMA_HASH || proof.ledgerHash !== ledgerHash ||
      !/^[a-f0-9]{64}$/.test(proof.mutationSuiteSha256) || !proof.receiptsVerified) issues.push("frozen_ledger_and_mutation_proof_missing");
  return { release: NBA_PLAYER_STATE_LEDGER_RELEASE, schemaHash: NBA_PLAYER_STATE_SCHEMA_HASH, selectionComplete, selectionVerifiedChanges, bySeason, issues: [...new Set(issues)],
    mayFit: issues.length === 0, ledgerHash };
}
