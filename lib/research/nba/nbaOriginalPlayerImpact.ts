import { createHash } from "node:crypto";

/** Research only. All numerical fields come from the original game-local files. */
export const NBA_ORIGINAL_PLAYER_IMPACT_RELEASE = "nba_original_player_impact_2026_11_23_r4_primary_event_impact_scope" as const;
export const NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE = "nba_original_two_way_impact_2026_11_23_r1_offense_defense" as const;
type Receipt = { url: string; status: number; requestedAt: string; receivedAt: string; lastModified: string | null; sha256: string };
type Counts = Record<string, number>;
type NativePlayer = { personId: number; name: string; firstName?: string; familyName?: string; played: string; starter: string;
  statistics: Record<(typeof fields)[keyof typeof fields] | "plus" | "minus", number> & { minutes: string } };
type NativeTeam = { teamId: number; teamTricode: string; score: number; players: NativePlayer[] };
type NativeBox = { gameId: string; gameTimeUTC: string; gameStatus: number; period: number; homeTeam: NativeTeam; awayTeam: NativeTeam };
type Action = { actionNumber: number; orderNumber: number; period: number; clock: string; actionType: string; subType?: string;
  personId?: number; teamId?: number; description?: string; shotResult?: string; assistPersonId?: number; foulDrawnPersonId?: number;
  jumpBallRecoverdPersonId?: number; jumpBallRecoveredPersonId?: number; jumpBallWonPersonId?: number; jumpBallLostPersonId?: number;
  timeActual?: string; edited?: string };
const fields = { pts: "points", fgm: "fieldGoalsMade", fga: "fieldGoalsAttempted", fg3m: "threePointersMade", fg3a: "threePointersAttempted", ftm: "freeThrowsMade", fta: "freeThrowsAttempted", oreb: "reboundsOffensive", dreb: "reboundsDefensive", ast: "assists", stl: "steals", blk: "blocks", pf: "foulsPersonal", tov: "turnovers" } as const;
const time = (s: string) => { const t = Date.parse(s); if (!Number.isFinite(t)) throw Error("invalid_native_clock"); return t; };
const duration = (s: string) => { const m = /^PT(\d+)M(\d+(?:\.\d+)?)S$/.exec(s); if (!m || +m[2]! >= 60) throw Error("invalid_native_duration"); return +m[1]! * 60 + +m[2]!; };
const sum = (c: Counts, k: string) => c[k] ?? 0;
const contribution = (c: Counts) => sum(c, "pts") + sum(c, "fgm") + sum(c, "ftm") - sum(c, "fga") - sum(c, "fta") + sum(c, "dreb") + .5 * sum(c, "oreb") + sum(c, "ast") + sum(c, "stl") + .5 * sum(c, "blk") - sum(c, "pf") - sum(c, "tov");
const estimatedPossessions = (c: Counts) => sum(c, "fga") + .44 * sum(c, "fta") - sum(c, "oreb") + sum(c, "tov") + sum(c, "teamTov");

/** The NBA liveData meta.time is a naive Eastern wall clock. Resolve DST by
 * round-tripping the named zone, never by assigning a fixed UTC offset. */
function sourceClock(value: string, modified: number): number {
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return time(value);
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d+))?$/.exec(value);
  if (!match) throw Error("invalid_native_publication_clock");
  const wall = `${match[1]}T${match[2]}`, candidates: number[] = [];
  for (const offset of ["-04:00", "-05:00"]) {
    const t = time(`${wall}.${(match[3] ?? "0").slice(0, 3).padEnd(3, "0")}${offset}`);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(t);
    const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === wall && t <= modified + 999 && modified - t <= 5_000) candidates.push(t);
  }
  if (candidates.length !== 1) throw Error("ambiguous_native_publication_clock");
  return candidates[0]!;
}
function verifyRaw(bytes: Uint8Array, receipt: Receipt, kind: "boxscore" | "playbyplay", gameId: string) {
  if (!/^002\d{7}$/.test(gameId) || receipt.url !== `https://cdn.nba.com/static/json/liveData/${kind}/${kind}_${gameId}.json` || receipt.status !== 200 || bytes.byteLength > 4_000_000 || !receipt.lastModified ||
      createHash("sha256").update(bytes).digest("hex") !== receipt.sha256 || time(receipt.requestedAt) > time(receipt.receivedAt)) throw Error("unverified_native_receipt");
  const json = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const modified = time(receipt.lastModified), fetched = time(receipt.receivedAt);
  // HTTP dates have whole-second precision. Use the end of that interval as
  // the conservative publication bound, while preserving the original receipt.
  const bound = modified + 999;
  const published = json.meta?.time ? sourceClock(json.meta.time, modified) : null;
  // Newer original PBP editions omit meta.time. Require their independently
  // embedded edit/event clocks instead; a URL and HTTP date alone cannot pass.
  const eventClocks = kind === "playbyplay" ? (json.game?.actions as Action[] | undefined)?.flatMap(a => [a.edited, a.timeActual].filter((v): v is string => !!v).map(time)) ?? [] : [];
  if (json.game?.gameId !== gameId || published === null && (kind !== "playbyplay" || eventClocks.length < 100) ||
      published !== null && (published > bound || modified - published > 5_000) || bound > fetched) throw Error("unverified_native_publication");
  const sourceAvailableAt = Math.max(bound, ...eventClocks);
  if (sourceAvailableAt > fetched) throw Error("future_native_event_clock");
  return { json, sourceAvailableAt, sha256: receipt.sha256, fetchedAt: receipt.receivedAt };
}

export type NbaOriginalImpactPlayer = { playerId: number; teamId: number; name: string; played: boolean; seconds: number;
  reconstructedSeconds: number; counts: Counts; pointsFor: number; pointsAgainst: number; numerator: number; denominator: number;
  physicalPointsFor: number; physicalPointsAgainst: number; scoringContextConvention: "both" | "foul_trip" | "physical" | "unverified";
  estimatedNet: number | null; pie: number | null; issues: string[]; diagnostics?: string[];
  estimatedOffense?: number | null; estimatedDefense?: number | null };
/** Prior-game roster/participation authority remains usable even when an event
 * stream cannot establish every player's advanced metric. Never use a target
 * game's roster as a pregame input. */
export function verifyNbaOriginalRoster(args: { gameId: string; bytes: Uint8Array; receipt: Receipt }) {
  const source = verifyRaw(args.bytes, args.receipt, "boxscore", args.gameId), box = source.json.game as NativeBox;
  if (box.gameStatus !== 3 || source.sourceAvailableAt <= time(box.gameTimeUTC)) throw Error("incomplete_original_roster");
  const ids = new Set<number>();
  const teams = [box.homeTeam, box.awayTeam].map(t => {
    if (t.players.length < 5 || t.players.length > 25) throw Error("incomplete_original_roster");
    return { teamId: t.teamId, abbreviation: t.teamTricode, players: t.players.map(p => {
      if (!Number.isSafeInteger(p.personId) || p.personId <= 0 || ids.has(p.personId) || !["0", "1"].includes(p.played)) throw Error("invalid_original_roster_identity"); ids.add(p.personId);
      return { playerId: p.personId, name: p.name, sourceNames: [...new Set([p.name, ...(p.firstName && p.familyName ? [`${p.firstName} ${p.familyName}`] : [])])], played: p.played === "1", seconds: duration(p.statistics.minutes) };
    }) };
  });
  return { gameId: args.gameId, startAt: box.gameTimeUTC, sourceAvailableAt: new Date(source.sourceAvailableAt).toISOString(), fetchedAt: source.fetchedAt, sha256: source.sha256, teams };
}
export function reconstructNbaOriginalImpact(box: NativeBox, rawActions: readonly Action[]) {
  return reconstructImpact(box, rawActions, false);
}
function reconstructImpact(box: NativeBox, rawActions: readonly Action[], twoWay: boolean) {
  if (box.gameStatus !== 3 || box.period < 4 || rawActions.length < 100 || rawActions.length > 5_000) throw Error("incomplete_native_game");
  // Native insertion priorities can appear unsorted in the transport array.
  // Sort a copy by the source's explicit order, never by actionNumber.
  const actions = [...rawActions].sort((a, b) => a.orderNumber - b.orderNumber);
  const teams = [box.homeTeam, box.awayTeam], players = new Map<number, NativePlayer & { teamId: number }>();
  for (const team of teams) {
    if (!Number.isSafeInteger(team.teamId) || team.players.length < 5 || team.players.length > 25) throw Error("invalid_native_roster");
    for (const p of team.players) { if (!Number.isSafeInteger(p.personId) || p.personId <= 0 || players.has(p.personId)) throw Error("duplicate_native_player"); players.set(p.personId, { ...p, teamId: team.teamId }); }
    const played = team.players.filter(p => p.played === "1"), total = played.reduce((n, p) => n + duration(p.statistics.minutes), 0);
    if (played.filter(p => p.starter === "1").length !== 5 || Math.abs(total - (14400 + (box.period - 4) * 1500)) > .5 * played.length || played.reduce((n, p) => n + p.statistics.points, 0) !== team.score) throw Error("incoherent_native_box_rotation");
  }
  if (teams[0]!.teamId === teams[1]!.teamId || teams[0]!.score === teams[1]!.score) throw Error("invalid_native_teams");
  let order = -Infinity; const numbers = new Set<number>();
  for (const a of actions) { if (!Number.isFinite(a.orderNumber) || a.orderNumber <= order || numbers.has(a.actionNumber) || a.period < 1 || a.period > box.period) throw Error("invalid_native_event_order"); order = a.orderNumber; numbers.add(a.actionNumber); }
  const stats = new Map([...players.keys()].map(id => [id, {} as Counts])), seconds = new Map([...players.keys()].map(id => [id, 0]));
  const context = new Map([...players.keys()].map(id => [id, new Map(teams.map(t => [t.teamId, {} as Counts]))]));
  const points = new Map([...players.keys()].map(id => [id, [0, 0]]));
  const physicalPoints = new Map([...players.keys()].map(id => [id, [0, 0]]));
  const minuteEdges = new Map([...players.keys()].map(id => [id, 0]));
  const dependencies = new Map([...players.keys()].map(id => [id, new Set<number>()]));
  const periods: { period: number; teams: { teamId: number; players: number[] }[] }[] = [];
  let previousFloor: Map<number, Set<number>> | null = null;
  const participatory = new Set(["2pt", "3pt", "freethrow", "rebound", "foul", "turnover", "steal", "block", "jumpball", "violation"]);
  for (let period = 1; period <= box.period; period++) {
    const events = actions.filter(a => a.period === period), firstSub = new Map<number, string>(), seenIn = new Set<number>(), actorBeforeIn = new Set<number>();
    for (const a of events) {
      if (a.actionType === "substitution") { if (!players.has(a.personId!)) throw Error("unknown_native_substitute"); if (!firstSub.has(a.personId!)) firstSub.set(a.personId!, a.subType!); if (a.subType === "in") seenIn.add(a.personId!); }
      else if (participatory.has(a.actionType)) for (const id of [a.personId, a.assistPersonId, a.foulDrawnPersonId, a.jumpBallRecoverdPersonId, a.jumpBallRecoveredPersonId, a.jumpBallWonPersonId, a.jumpBallLostPersonId]) {
        // Technicals may be assessed to a bench player; they do not establish
        // that player's floor membership or count as a personal foul.
        if (a.actionType === "foul" && a.subType === "technical") continue;
        if (id && players.has(id) && !seenIn.has(id)) actorBeforeIn.add(id);
      }
    }
    const initial = new Set([...firstSub].filter(([, kind]) => kind === "out").map(([id]) => id));
    for (const id of actorBeforeIn) if (firstSub.get(id) !== "in") initial.add(id);
    if (period === 1) for (const [id, p] of players) if (p.starter === "1") initial.add(id);
    // A silent player can have no recorded action in a short overtime. Carry
    // a prior-period survivor only when the native substitution constraints
    // leave exactly one complete set, then verify full box minutes and scoring.
    if (previousFloor) for (const t of teams) {
      const known = [...initial].filter(id => players.get(id)!.teamId === t.teamId);
      const candidates = [...previousFloor.get(t.teamId)!].filter(id => !initial.has(id) && firstSub.get(id) !== "in");
      if (known.length < 5 && candidates.length === 5 - known.length) for (const id of candidates) initial.add(id);
    }
    const floor = new Map(teams.map(t => [t.teamId, new Set([...initial].filter(id => players.get(id)!.teamId === t.teamId))]));
    const requireFive = () => { if ([...floor.values()].some(f => f.size !== 5)) throw Error(`unresolved_native_lineup:${period}`); };
    requireFive();
    for (const id of initial) minuteEdges.set(id, minuteEdges.get(id)! + 1);
    if (period === 1 && [...initial].some(id => players.get(id)!.starter !== "1")) throw Error("native_starter_mismatch");
    periods.push({ period, teams: [...floor].map(([teamId, ids]) => ({ teamId, players: [...ids].sort((a, b) => a - b) })) });
    const floorIds = () => [...floor.values()].flatMap(s => [...s]);
    type Trip = { kind: "normal" | "technical"; floor: number[]; drawnBy?: number };
    let remaining = period <= 4 ? 720 : 300, pending: Trip[] = [];
    for (const a of events) {
      const clock = duration(a.clock), elapsed = remaining - clock;
      // Editorial memos have an annotation clock, not a game-clock event.
      if (a.actionType === "memo") continue;
      if (elapsed < -1e-6 && ["instantreplay", "timeout"].includes(a.actionType)) continue;
      if (elapsed < -1e-6) throw Error(`native_clock_reversal:${a.actionNumber}`);
      if (elapsed > 0) { requireFive(); const on = floorIds(); for (const id of on) { seconds.set(id, seconds.get(id)! + elapsed); for (const actor of on) dependencies.get(id)!.add(actor); } pending = []; }
      remaining = clock;
      const type = a.actionType, id = a.personId ?? 0, teamId = a.teamId ?? 0, sub = a.subType ?? "";
      if (type === "substitution") {
        minuteEdges.set(id, minuteEdges.get(id)! + 1);
        const f = floor.get(teamId); if (!f || players.get(id)?.teamId !== teamId) throw Error("native_substitution_team_mismatch");
        if (sub === "out") { if (!f.delete(id)) throw Error(`native_out_not_on:${a.actionNumber}`); }
        else if (sub === "in") { if (f.has(id)) throw Error(`native_in_already_on:${a.actionNumber}`); f.add(id); }
        else throw Error("unknown_native_substitution");
        continue;
      }
      requireFive();
      const tripKind = /technical/i.test(a.description ?? "") ? "technical" : "normal";
      const trip = type === "freethrow" ? [...pending].reverse().find(t => t.kind === tripKind && t.drawnBy === id) ?? [...pending].reverse().find(t => t.kind === tripKind) : undefined;
      const on = trip?.floor ?? floorIds();
      for (const view of on) for (const actor of on) dependencies.get(view)!.add(actor);
      const add = (actor: number, key: string, count = 1) => {
        const p = players.get(actor); if (!p || !on.includes(actor) && type !== "freethrow") throw Error("native_actor_not_on_floor");
        const s = stats.get(actor)!; s[key] = sum(s, key) + count;
        for (const view of on) { const c = context.get(view)!.get(p.teamId)!; c[key] = sum(c, key) + count; }
      };
      if (["2pt", "3pt", "freethrow"].includes(type)) {
        const made = a.shotResult === "Made"; if (!made && a.shotResult !== "Missed") throw Error("unknown_native_shot_result");
        const value = type === "3pt" ? 3 : type === "2pt" ? 2 : 1;
        if (type === "freethrow") { add(id, "fta"); add(id, "ftm", +made); }
        else { add(id, "fga"); add(id, "fgm", +made); add(id, "fg3a", +(type === "3pt")); add(id, "fg3m", +(made && type === "3pt")); if (made && a.assistPersonId) add(a.assistPersonId, "ast"); }
        add(id, "pts", value * +made);
        if (made) { for (const view of on) points.get(view)![players.get(view)!.teamId === teamId ? 0 : 1]! += value;
          for (const view of floorIds()) physicalPoints.get(view)![players.get(view)!.teamId === teamId ? 0 : 1]! += value; }
      } else if (type === "rebound" && id) { if (!["offensive", "defensive"].includes(sub)) throw Error("unknown_native_rebound"); add(id, sub === "offensive" ? "oreb" : "dreb"); }
      else if (type === "turnover") {
        if (id) add(id, "tov");
        else { if (!floor.has(teamId)) throw Error("unknown_native_team_turnover"); for (const view of on) { const c = context.get(view)!.get(teamId)!; c.teamTov = sum(c, "teamTov") + 1; } }
      } else if (type === "steal" || type === "block") add(id, type === "steal" ? "stl" : "blk");
      else if (type === "foul" && sub !== "technical") { if (id) add(id, "pf"); pending.push({ kind: "normal", floor: floorIds(), drawnBy: a.foulDrawnPersonId }); }
      if (type === "foul" && sub === "technical") pending.push({ kind: "technical", floor: floorIds() });
      if (type === "freethrow" && /^(\d+) of \1$/.test(sub) && trip) pending = pending.filter(t => t !== trip);
    }
    if (remaining !== 0) throw Error("incomplete_native_period");
    for (const id of floorIds()) minuteEdges.set(id, minuteEdges.get(id)! + 1);
    previousFloor = new Map([...floor].map(([id, values]) => [id, new Set(values)]));
  }
  const output: NbaOriginalImpactPlayer[] = [];
  for (const [id, p] of players) {
    const c = stats.get(id)!, on = context.get(id)!, own = on.get(p.teamId)!, other = [...on].find(([t]) => t !== p.teamId)![1];
    const numerator = contribution(c), denominator = contribution(own) + contribution(other) - sum(own, "teamTov") - sum(other, "teamTov"), op = estimatedPossessions(own), dp = estimatedPossessions(other);
    const rate = (pts: number, poss: number) => Number.isFinite(pts) && Number.isFinite(poss) ? poss !== 0 ? 100 * pts / poss : 0 : null;
    const off = rate(sum(own, "pts"), op), def = rate(sum(other, "pts"), dp), scoring = points.get(id)!, physical = physicalPoints.get(id)!, issues: string[] = [];
    const tripMatch = scoring[0] === p.statistics.plus && scoring[1] === p.statistics.minus, physicalMatch = physical[0] === p.statistics.plus && physical[1] === p.statistics.minus;
    const scoringContextConvention = tripMatch && physicalMatch ? "both" : tripMatch ? "foul_trip" : physicalMatch ? "physical" : "unverified";
    const played = p.played === "1", sourceSeconds = duration(p.statistics.minutes), diagnostics: string[] = [];
    if (played) {
      for (const [key, field] of Object.entries(fields)) if (sum(c, key) !== p.statistics[field]) {
        // Three-point attempts/makes are checked and retained, but are absent
        // from both declared impact equations; they cannot taint another
        // player's unrelated scoring/possession/contribution evidence.
        (key === "fg3a" || key === "fg3m" ? diagnostics : issues).push(`original_count_mismatch:${key}`);
      }
      // This live aggregate is retained as an independent diagnostic, not an
      // input to either declared impact equation. Never overwrite it or choose
      // a rating from it. The original complete event sequence, exact player
      // counts and verified stint minutes own the reconstructed impact.
      if (!tripMatch && !physicalMatch) diagnostics.push("live_box_scoring_context_disagreement");
      // Independent clocks are quantized separately at each stint endpoint.
      // Bound accumulated rounding; never alter the authoritative box seconds.
      if (Math.abs(sourceSeconds - seconds.get(id)!) > .5 * (minuteEdges.get(id)! + 1)) issues.push("original_stint_minutes_mismatch");
      if (off === null || def === null) issues.push("undefined_original_impact");
      if (denominator === 0) diagnostics.push("published_zero_denominator_pie_convention");
      if (op === 0 || dp === 0) diagnostics.push("published_zero_denominator_estimated_rating_convention");
    } else if (sourceSeconds !== 0 || Object.values(c).some(n => n !== 0) || seconds.get(id)! !== 0) issues.push("inactive_player_participation");
    output.push({ playerId: id, teamId: p.teamId, name: p.name, played, seconds: sourceSeconds, reconstructedSeconds: seconds.get(id)!, counts: c,
      pointsFor: scoring[0]!, pointsAgainst: scoring[1]!, numerator, denominator,
      physicalPointsFor: physical[0]!, physicalPointsAgainst: physical[1]!, scoringContextConvention,
      estimatedNet: played && off !== null && def !== null ? off - def : null, pie: played ? denominator !== 0 ? numerator / denominator : 0 : null, issues, diagnostics,
      ...(twoWay ? { estimatedOffense: played ? off : null, estimatedDefense: played ? def : null } : {}) });
  }
  // A count disagreement can affect every overlapping player's denominator.
  // Preserve unrelated validated observations instead of discarding the whole
  // game because a different player has an undefined metric or bad context.
  const disagreeing = output.filter(p => p.issues.some(i => i.startsWith("original_count_mismatch:"))).map(p => p.playerId);
  for (const p of output) if (disagreeing.some(id => dependencies.get(p.playerId)!.has(id))) p.issues.push("original_context_count_disagreement");
  return { players: output, periods, issues: output.flatMap(p => p.issues.map(issue => `${p.playerId}:${issue}`)) };
}

export function verifyNbaOriginalPlayerImpact(args: { gameId: string; boxBytes: Uint8Array; boxReceipt: Receipt; pbpBytes: Uint8Array; pbpReceipt: Receipt; computedAt: string }) {
  return verifyImpact(args, false);
}
export function verifyNbaOriginalTwoWayImpact(args: Parameters<typeof verifyNbaOriginalPlayerImpact>[0]) {
  return verifyImpact(args, true);
}
function verifyImpact(args: Parameters<typeof verifyNbaOriginalPlayerImpact>[0], twoWay: boolean) {
  const boxSource = verifyRaw(args.boxBytes, args.boxReceipt, "boxscore", args.gameId), pbpSource = verifyRaw(args.pbpBytes, args.pbpReceipt, "playbyplay", args.gameId);
  const box = boxSource.json.game as NativeBox, actions = pbpSource.json.game.actions as Action[], start = time(box.gameTimeUTC);
  const available = Math.max(boxSource.sourceAvailableAt, pbpSource.sourceAvailableAt);
  if (available <= start || time(args.computedAt) < Math.max(time(boxSource.fetchedAt), time(pbpSource.fetchedAt))) throw Error("invalid_native_edition_clock");
  for (const a of actions) for (const clock of [a.edited, a.timeActual]) if (clock && time(clock) > available) throw Error("native_event_after_publication");
  const result = reconstructImpact(box, actions, twoWay);
  return { release: twoWay ? NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE : NBA_ORIGINAL_PLAYER_IMPACT_RELEASE, gameId: args.gameId, startAt: box.gameTimeUTC,
    sourceAvailableAt: new Date(available).toISOString(), computedAt: args.computedAt,
    sources: [boxSource, pbpSource].map(({ sourceAvailableAt, sha256, fetchedAt }) => ({ sourceAvailableAt: new Date(sourceAvailableAt).toISOString(), sha256, fetchedAt })),
    homeTeamId: box.homeTeam.teamId, awayTeamId: box.awayTeam.teamId, ...result };
}
export function admitNbaOriginalImpact(source: { gameId: string; startAt: string; sourceAvailableAt: string }, target: { gameId: string; cutoff: string }) {
  return source.gameId !== target.gameId && time(source.startAt) < time(target.cutoff) && time(source.sourceAvailableAt) <= time(target.cutoff);
}
