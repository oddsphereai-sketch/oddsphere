"use client";

/**
 * /admin/slate — Fix 7.2 admin manual slate upload UI.
 *
 * Workflow:
 *   1. Email + token auth gate (matches /admin/scores-model pattern).
 *   2. Sport selector (all 7 sports — Flag H1).
 *   3. Date picker (default today, UTC YYYY-MM-DD).
 *   4. Teams are fetched from /api/admin/teams?sport=X for dropdowns.
 *      Empty result triggers a "no teams seeded — see Fix 7.2.1" hint.
 *   5. Per-game rows: home dropdown, away dropdown, start time (datetime-local),
 *      optional venue, optional notes.
 *   6. "Add game" / "Remove" controls per row.
 *   7. "Publish slate" → POST /api/admin/upload-slate; result panel renders
 *      records_updated / staging_id / any errors.
 *
 * Scope guardrails:
 *   • Slate data only (sport, date, teams, start time, venue, notes).
 *   • No ML/total/NRFI/prop prediction fields here — those flow through
 *     /admin/scores-model (Fix 6.1 upload path) or auto-generate via
 *     propModelOrchestrator.
 *   • No team CRUD (Flag B1: pre-seeded teams only).
 *   • Same admin auth surface as /admin/scores-model — no auth changes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { computeSlateDate } from "@/lib/dates/slateDate";

const SPORTS = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl"] as const;
type Sport = (typeof SPORTS)[number];

const SPORT_LABELS: Record<Sport, string> = {
  mlb: "MLB ⚾",
  nba: "NBA 🏀",
  nfl: "NFL 🏈",
  cbb: "NCAAB 🏀",
  cfb: "NCAAF 🏈",
  nhl: "NHL 🏒",
  ucl: "UCL ⚽",
};

type TeamRow = {
  external_id: number;
  abbreviation: string;
  display_name: string;
  location: string | null;
  league: string | null;
  division: string | null;
};

type GameRow = {
  home_team_abbrev: string;
  away_team_abbrev: string;
  /** datetime-local string ("YYYY-MM-DDTHH:mm"); converted to ISO at publish. */
  game_local: string;
  venue: string;
  notes: string;
};

type PublishResult = {
  sport: string;
  slate_date: string;
  staging_id: number;
  records_updated: number;
  api_calls_made: number;
  details: { skipped_external_ids?: number[] } | null;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fix 7.2.4: when a new game row is added, prefill `game_local` to the
 * selected slate_date at 19:00 (a generic evening time). Reduces the
 * surface area for the operator to type a mismatched date — they only
 * have to set the time, and even an unchanged default lands on the
 * correct slate.
 */
function blankGame(slateDateForDefault?: string): GameRow {
  return {
    home_team_abbrev: "",
    away_team_abbrev: "",
    game_local: slateDateForDefault ? `${slateDateForDefault}T19:00` : "",
    venue: "",
    notes: "",
  };
}

function localToIso(local: string): string {
  // datetime-local omits timezone — interpret as local time, convert to UTC ISO.
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Fix 7.2.4: compute the canonical slate_date a given local-input
 * datetime would map to, using the same `computeSlateDate` the server
 * uses. Returns undefined when the input can't be parsed so the warning
 * UI silently skips empty/invalid rows. Wrapped in try/catch so an
 * unparseable date doesn't crash the form.
 */
function deriveSlateDateForGame(
  sport: Sport,
  gameLocal: string
): string | undefined {
  const iso = localToIso(gameLocal);
  if (!iso) return undefined;
  try {
    return computeSlateDate(sport, iso);
  } catch {
    return undefined;
  }
}

export default function AdminSlatePage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_credentials");
      if (saved) {
        const parsed = JSON.parse(saved) as { email: string; token: string };
        setEmail(parsed.email);
        setToken(parsed.token);
        setAuthed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  async function handleAuth() {
    setAuthError(null);
    const res = await fetch(`/api/admin/teams?sport=mlb`, {
      headers: { "x-admin-email": email, "x-admin-token": token },
    });
    if (res.ok) {
      localStorage.setItem("admin_credentials", JSON.stringify({ email, token }));
      setAuthed(true);
    } else {
      const body = await res.text();
      setAuthError(`Auth failed (${res.status}): ${body}`);
    }
  }

  if (!authed) {
    return (
      <main style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Admin · Slate Upload</h1>
        <p style={{ color: "#666", marginBottom: 24 }}>
          Email + admin token (set in env). Same auth surface as /admin/scores-model.
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 4, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 4, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </label>
        <button
          onClick={handleAuth}
          style={{ padding: "8px 16px", background: "#000", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
        >
          Continue
        </button>
        {authError && (
          <p style={{ color: "#b00", marginTop: 16, fontSize: 14 }}>{authError}</p>
        )}
      </main>
    );
  }

  return (
    <SlateForm
      email={email}
      token={token}
      onSignOut={() => {
        localStorage.removeItem("admin_credentials");
        setAuthed(false);
        setEmail("");
        setToken("");
      }}
    />
  );
}

function SlateForm({
  email,
  token,
  onSignOut,
}: {
  email: string;
  token: string;
  onSignOut: () => void;
}) {
  const [sport, setSport] = useState<Sport>("mlb");
  const [slateDate, setSlateDate] = useState(todayISO());
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  // Fix 7.2.4: initial blank game prefills game_local to {slateDate}T19:00
  // so the operator only needs to set the time, not re-type the date. The
  // initial state runs once at mount; subsequent slate-date changes don't
  // retroactively rewrite existing rows (operator may have intentionally
  // entered something else; the per-row warning catches divergence).
  const [games, setGames] = useState<GameRow[]>(() => [blankGame(slateDate)]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Load teams whenever sport changes
  useEffect(() => {
    setTeamsError(null);
    setPublishResult(null);
    setTeamsLoading(true);
    fetch(`/api/admin/teams?sport=${sport}`, {
      headers: { "x-admin-email": email, "x-admin-token": token },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Teams fetch failed (${res.status}): ${await res.text()}`);
        return res.json();
      })
      .then((data: { teams: TeamRow[] }) => setTeams(data.teams))
      .catch((e: Error) => setTeamsError(e.message))
      .finally(() => setTeamsLoading(false));
  }, [sport, email, token]);

  const teamsSeeded = teams.length > 0;
  const sportLabel = SPORT_LABELS[sport];

  const updateGame = useCallback((idx: number, patch: Partial<GameRow>) => {
    setGames((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }, []);

  const removeGame = useCallback((idx: number) => {
    setGames((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Fix 7.2.4: when the operator clicks "Add game", prefill the new
  // row's game_local to the currently-selected slate_date at 19:00 so
  // the default is consistent and the per-row warning starts silent.
  const addGame = useCallback(() => {
    setGames((prev) => [...prev, blankGame(slateDate)]);
  }, [slateDate]);

  const canPublish = useMemo(() => {
    if (!teamsSeeded) return false;
    if (games.length === 0) return false;
    return games.every(
      (g) =>
        g.home_team_abbrev &&
        g.away_team_abbrev &&
        g.home_team_abbrev !== g.away_team_abbrev &&
        g.game_local
    );
  }, [teamsSeeded, games]);

  async function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);

    const payload = {
      sport,
      slate_date: slateDate,
      games: games.map((g) => ({
        home_team_abbrev: g.home_team_abbrev,
        away_team_abbrev: g.away_team_abbrev,
        game_date: localToIso(g.game_local),
        season: new Date(slateDate).getUTCFullYear(),
        venue: g.venue || undefined,
        notes: g.notes || undefined,
      })),
    };

    try {
      const res = await fetch("/api/admin/upload-slate", {
        method: "POST",
        headers: {
          "x-admin-email": email,
          "x-admin-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as PublishResult & { error?: string };
      if (!res.ok) {
        setPublishError(body.error ?? `Upload failed (${res.status})`);
      } else {
        setPublishResult(body);
      }
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "32px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Slate Upload</h1>
        <button
          onClick={onSignOut}
          style={{ padding: "4px 12px", fontSize: 13, background: "#eee", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
        >
          Sign out
        </button>
      </header>

      <div
        style={{
          background: "#eef6ff",
          border: "1px solid #bcd9f5",
          color: "#1d4d8c",
          padding: "10px 14px",
          borderRadius: 4,
          marginBottom: 24,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Fix 7.2 — manual slate upload bridge. Uploads create canonical{" "}
        <code>games</code> rows tagged{" "}
        <code>provider_ids.manual = &quot;sport:date:home:away&quot;</code>. Scores-
        model predictions still flow through <a href="/admin/scores-model">/admin/scores-model</a>.
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "center" }}>
        <label>
          Sport
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value as Sport)}
            style={{ marginLeft: 8, padding: 6 }}
          >
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {SPORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Slate date
          <input
            type="date"
            value={slateDate}
            onChange={(e) => setSlateDate(e.target.value)}
            style={{ marginLeft: 8, padding: 6 }}
          />
        </label>
      </div>

      {teamsLoading && <p>Loading teams for {sportLabel}…</p>}
      {teamsError && (
        <div style={{ color: "#b00", background: "#fee", padding: 12, borderRadius: 4, marginBottom: 16 }}>
          {teamsError}
        </div>
      )}

      {!teamsLoading && !teamsSeeded && (
        <div
          style={{
            background: "#fff7e6",
            border: "1px solid #f0c674",
            color: "#7a5d0e",
            padding: "12px 16px",
            borderRadius: 4,
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          <strong>No teams seeded for {sportLabel}.</strong> Manual slate uploads
          require team rows to exist first. See Fix 7.2.1 (multi-sport team
          seed) to enable slate uploads for this sport.
        </div>
      )}

      {teamsSeeded && (
        <>
          <p style={{ color: "#666", marginBottom: 8, fontSize: 13 }}>
            {teams.length} teams available for {sportLabel}. Pick home + away
            by abbreviation per game.
          </p>

          {games.map((g, idx) => (
            <GameRowEditor
              key={idx}
              index={idx}
              row={g}
              teams={teams}
              sport={sport}
              selectedSlateDate={slateDate}
              onChange={(patch) => updateGame(idx, patch)}
              onRemove={() => removeGame(idx)}
              canRemove={games.length > 1}
            />
          ))}

          <button
            onClick={addGame}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              background: "#eee",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
              marginBottom: 24,
            }}
          >
            + Add game
          </button>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={handlePublish}
              disabled={!canPublish || publishing}
              style={{
                padding: "10px 20px",
                background: canPublish && !publishing ? "#000" : "#999",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: canPublish && !publishing ? "pointer" : "not-allowed",
                fontSize: 15,
              }}
            >
              {publishing ? "Publishing…" : "Publish slate"}
            </button>
            <span style={{ color: "#666", fontSize: 13 }}>
              {games.length} game(s) · sport={sport} · date={slateDate}
            </span>
          </div>

          {publishError && (
            <div style={{ marginTop: 24, padding: 16, background: "#fee", color: "#b00", borderRadius: 4 }}>
              {publishError}
            </div>
          )}
          {publishResult && (
            <div style={{ marginTop: 24, padding: 16, background: "#efe", borderRadius: 4 }}>
              <h3 style={{ marginTop: 0 }}>Slate published</h3>
              <p>
                Records updated: <strong>{publishResult.records_updated}</strong>{" "}
                · Staging row id: <code>{publishResult.staging_id}</code>
              </p>
              {publishResult.details?.skipped_external_ids &&
                publishResult.details.skipped_external_ids.length > 0 && (
                  <p style={{ color: "#7a5d0e" }}>
                    Skipped game external_ids:{" "}
                    {publishResult.details.skipped_external_ids.join(", ")}
                  </p>
                )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function GameRowEditor({
  index,
  row,
  teams,
  sport,
  selectedSlateDate,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  row: GameRow;
  teams: TeamRow[];
  sport: Sport;
  selectedSlateDate: string;
  onChange: (patch: Partial<GameRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // Fix 7.2.4: compute the slate_date this game's start time would map
  // to, using the same canonical computeSlateDate the server uses for
  // validation + the games table for slate_date. Renders a warning
  // below the start-time input when the operator's entry diverges from
  // the slate-date selector. The server-side check is authoritative;
  // this is just an early heads-up so the operator can fix it before
  // clicking Publish.
  const derivedSlateDate = deriveSlateDateForGame(sport, row.game_local);
  const mismatchedSlateDate =
    derivedSlateDate !== undefined && derivedSlateDate !== selectedSlateDate;

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 4,
        padding: 16,
        marginBottom: 12,
        display: "grid",
        gridTemplateColumns: "1.5fr 1.5fr 2fr 2fr 1.5fr auto",
        gap: 12,
        alignItems: "end",
      }}
    >
      <label style={{ fontSize: 13 }}>
        Game {index + 1} · Home
        <select
          value={row.home_team_abbrev}
          onChange={(e) => onChange({ home_team_abbrev: e.target.value })}
          style={{ display: "block", marginTop: 4, padding: 6, width: "100%" }}
        >
          <option value="">— pick —</option>
          {teams.map((t) => (
            <option key={t.external_id} value={t.abbreviation}>
              {t.abbreviation} · {t.display_name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 13 }}>
        Away
        <select
          value={row.away_team_abbrev}
          onChange={(e) => onChange({ away_team_abbrev: e.target.value })}
          style={{ display: "block", marginTop: 4, padding: 6, width: "100%" }}
        >
          <option value="">— pick —</option>
          {teams.map((t) => (
            <option key={t.external_id} value={t.abbreviation}>
              {t.abbreviation} · {t.display_name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 13 }}>
        Start (local)
        <input
          type="datetime-local"
          value={row.game_local}
          onChange={(e) => onChange({ game_local: e.target.value })}
          style={{
            display: "block",
            marginTop: 4,
            padding: 6,
            width: "100%",
            borderColor: mismatchedSlateDate ? "#d18b1c" : undefined,
            borderWidth: mismatchedSlateDate ? 2 : undefined,
            borderStyle: mismatchedSlateDate ? "solid" : undefined,
          }}
        />
        {mismatchedSlateDate && (
          <span
            style={{
              fontSize: 11,
              color: "#a06400",
              marginTop: 4,
              display: "block",
              lineHeight: 1.35,
            }}
            title="The start time you entered rolls into a different slate than the selected slate-date."
          >
            ⚠ Start time rolls into slate{" "}
            <strong>{derivedSlateDate}</strong>, not the selected slate{" "}
            <strong>{selectedSlateDate}</strong>. The server will reject this.
          </span>
        )}
      </label>
      <label style={{ fontSize: 13 }}>
        Venue (optional)
        <input
          type="text"
          value={row.venue}
          onChange={(e) => onChange({ venue: e.target.value })}
          style={{ display: "block", marginTop: 4, padding: 6, width: "100%" }}
        />
      </label>
      <label style={{ fontSize: 13 }}>
        Notes (optional)
        <input
          type="text"
          value={row.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          style={{ display: "block", marginTop: 4, padding: 6, width: "100%" }}
        />
      </label>
      <button
        onClick={onRemove}
        disabled={!canRemove}
        style={{
          padding: "6px 10px",
          fontSize: 13,
          background: canRemove ? "#fee" : "#eee",
          border: "1px solid " + (canRemove ? "#fbb" : "#ccc"),
          color: canRemove ? "#b00" : "#999",
          borderRadius: 4,
          cursor: canRemove ? "pointer" : "not-allowed",
          height: 32,
        }}
      >
        Remove
      </button>
    </div>
  );
}
