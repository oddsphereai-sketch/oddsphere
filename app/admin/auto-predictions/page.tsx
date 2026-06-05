"use client";

/**
 * R-19 Phase 5f — admin-only read-only preview of auto-model predictions.
 *
 * /admin/auto-predictions
 *
 * Pre-publish preview of what the orchestrator wrote into game_predictions
 * for a given (sport, slate_date). Member-facing Daily Edge correctly hides
 * draft slates; this page is the only safe operator-facing surface to
 * visually verify each game's ML / O-U / NRFI pick before the publish
 * workflow promotes the slate to members.
 *
 * READ-ONLY. No publish, no edit, no rerun, no overwrite. Same email +
 * token auth pattern as /admin/scores-model, /admin/slate, /admin/cron-status
 * (credentials live in localStorage, sent as headers with every fetch).
 *
 * V1 scope: MLB only. Sport-aware admin preview deferred to a future phase.
 */

import { useCallback, useEffect, useState } from "react";

const SPORT = "mlb" as const;

type MarketDto = {
  pick: string | null;
  confidence_pct: number | null;
  grade: string | null;
  held: boolean;
  hold_reason: string | null;
};

type AdminGameRow = {
  external_id: number;
  game_date: string;
  matchup: string;
  away_code: string | null;
  home_code: string | null;
  game_status: string | null;
  slate_status: string | null;
  has_prediction: boolean;
  excluded_inferred_reason: string | null;
  prediction: null | {
    prediction_source: string | null;
    is_override: boolean;
    computed_at: string | null;
    locked_at: string | null;
    fully_held: boolean;
    held_count: number;
    model_breakdown: string | null;
    ml: MarketDto;
    ou: MarketDto;
    nrfi: MarketDto;
  };
};

type ApiResponse = {
  as_of: string;
  sport: "mlb";
  slate_date: string;
  totals: {
    games_count: number;
    predictions_count: number;
    excluded_count: number;
    fully_held_count: number;
    partial_held_count: number;
    no_hold_count: number;
  };
  slate_status_summary: {
    draft: number;
    published: number;
    final: number;
    hidden: number;
    null_or_other: number;
  };
  games: AdminGameRow[];
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTimeET(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level — handles auth gate (mirrors /admin/scores-model)
// ─────────────────────────────────────────────────────────────────────────
export default function AdminAutoPredictionsPage() {
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
    const res = await fetch(
      `/api/admin/auto-predictions?sport=${SPORT}&date=${todayDate()}`,
      { headers: { "x-admin-email": email, "x-admin-token": token } }
    );
    if (res.ok) {
      localStorage.setItem(
        "admin_credentials",
        JSON.stringify({ email, token })
      );
      setAuthed(true);
    } else {
      const body = await res.text();
      setAuthError(`Auth failed (${res.status}): ${body}`);
    }
  }

  if (!authed) {
    return (
      <main
        style={{
          maxWidth: 480,
          margin: "80px auto",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>
          Admin · Auto-Predictions Preview
        </h1>
        <p style={{ color: "#666", marginBottom: 24 }}>
          Email + admin token (set in env). Same credentials as other admin
          pages.
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: 8,
              marginTop: 4,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{
              width: "100%",
              padding: 8,
              marginTop: 4,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <button
          onClick={handleAuth}
          style={{
            padding: "8px 16px",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Continue
        </button>
        {authError && (
          <p style={{ color: "#b00", marginTop: 16, fontSize: 14 }}>
            {authError}
          </p>
        )}
      </main>
    );
  }

  return (
    <AutoPredictionsView
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

// ─────────────────────────────────────────────────────────────────────────
// Main view — date picker + summary + per-game table
// ─────────────────────────────────────────────────────────────────────────
function AutoPredictionsView({
  email,
  token,
  onSignOut,
}: {
  email: string;
  token: string;
  onSignOut: () => void;
}) {
  const [date, setDate] = useState(todayDate());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/auto-predictions?sport=${SPORT}&date=${date}`,
        {
          headers: { "x-admin-email": email, "x-admin-token": token },
          cache: "no-store",
        }
      );
      if (!res.ok) {
        throw new Error(
          `Fetch failed (${res.status}): ${await res.text()}`
        );
      }
      const body = (await res.json()) as ApiResponse;
      setData(body);
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date, email, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "32px auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>
          Admin · Auto-Predictions Preview
        </h1>
        <button
          onClick={onSignOut}
          style={{
            padding: "6px 12px",
            background: "#fff",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Sign out
        </button>
      </header>

      <p style={{ color: "#666", margin: "0 0 20px", fontSize: 14 }}>
        Read-only operator preview of what the slate-cycle orchestrator
        wrote into <code>game_predictions</code> for the selected date.
        Daily Edge (member-facing) correctly hides draft slates — use this
        page to verify picks before publishing. No publish / edit / rerun
        controls are exposed here.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <label style={{ fontSize: 14 }}>
          Sport
          <select
            value={SPORT}
            disabled
            style={{
              marginLeft: 6,
              padding: 6,
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#f5f5f5",
            }}
          >
            <option value="mlb">mlb</option>
          </select>
        </label>
        <label style={{ fontSize: 14 }}>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              marginLeft: 6,
              padding: 6,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <button
          onClick={reload}
          disabled={loading}
          style={{
            padding: "6px 14px",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Reload"}
        </button>
        {data && (
          <span style={{ color: "#999", fontSize: 12, marginLeft: "auto" }}>
            as of {new Date(data.as_of).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 4,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {data && <SummaryStrip data={data} />}
      {data && <GamesTable data={data} expanded={expanded} onToggle={toggleExpand} />}
    </main>
  );
}

function SummaryStrip({ data }: { data: ApiResponse }) {
  const s = data.slate_status_summary;
  const t = data.totals;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          padding: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: "#64748b",
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          Slate status
        </div>
        <div style={{ fontSize: 14 }}>
          draft={s.draft} · published={s.published} · final={s.final} ·
          hidden={s.hidden}
          {s.null_or_other > 0 ? ` · other=${s.null_or_other}` : ""}
        </div>
      </div>
      <div
        style={{
          padding: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: "#64748b",
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          Predictions
        </div>
        <div style={{ fontSize: 14 }}>
          {t.predictions_count} / {t.games_count} games · excluded=
          {t.excluded_count} · fully held={t.fully_held_count} · partial=
          {t.partial_held_count} · no-hold={t.no_hold_count}
        </div>
      </div>
    </div>
  );
}

function GamesTable({
  data,
  expanded,
  onToggle,
}: {
  data: ApiResponse;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  if (data.games.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#666",
          background: "#f9fafb",
          border: "1px dashed #d1d5db",
          borderRadius: 6,
        }}
      >
        No games on the slate for {data.slate_date}.
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            <Th>Time (ET)</Th>
            <Th>Matchup</Th>
            <Th>Slate</Th>
            <Th>Source</Th>
            <Th>ML</Th>
            <Th>O/U</Th>
            <Th>NRFI</Th>
            <Th>Held</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {data.games.map((g) => (
            <GameRow
              key={g.external_id}
              g={g}
              expanded={expanded.has(g.external_id)}
              onToggle={() => onToggle(g.external_id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "#475569",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  colSpan,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "8px 10px",
        borderBottom: "1px solid #f1f5f9",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function MarketCell({ m }: { m: MarketDto }) {
  if (m.held) {
    return (
      <span style={{ color: "#b45309", fontSize: 12 }}>
        HELD {m.hold_reason ? `· ${m.hold_reason}` : ""}
      </span>
    );
  }
  if (m.pick === null) {
    return <span style={{ color: "#999" }}>—</span>;
  }
  return (
    <span>
      <strong>{m.pick}</strong>
      {m.confidence_pct !== null ? (
        <span style={{ color: "#555", marginLeft: 6, fontSize: 12 }}>
          {m.confidence_pct}%
        </span>
      ) : null}
      {m.grade ? (
        <span style={{ color: "#999", marginLeft: 6, fontSize: 11 }}>
          ({m.grade})
        </span>
      ) : null}
    </span>
  );
}

function GameRow({
  g,
  expanded,
  onToggle,
}: {
  g: AdminGameRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isExcluded = !g.has_prediction;
  const rowBg = isExcluded ? "#fef3c7" : undefined;

  if (isExcluded) {
    return (
      <tr style={{ background: rowBg }}>
        <Td>{formatTimeET(g.game_date)}</Td>
        <Td>
          <strong>{g.matchup}</strong>
          <div style={{ color: "#92400e", fontSize: 11 }}>
            external_id {g.external_id}
          </div>
        </Td>
        <Td>{g.slate_status ?? "—"}</Td>
        <Td colSpan={6}>
          <span style={{ color: "#92400e", fontWeight: 600 }}>
            ⚠ EXCLUDED — no prediction row
          </span>
          {g.excluded_inferred_reason && (
            <div style={{ color: "#78350f", fontSize: 12, marginTop: 2 }}>
              best-effort cause: {g.excluded_inferred_reason}
            </div>
          )}
          {g.game_status && (
            <div style={{ color: "#92400e", fontSize: 11, marginTop: 2 }}>
              games.status = {g.game_status}
            </div>
          )}
        </Td>
      </tr>
    );
  }

  const p = g.prediction!;
  return (
    <>
      <tr>
        <Td>{formatTimeET(g.game_date)}</Td>
        <Td>
          <strong>{g.matchup}</strong>
          <div style={{ color: "#94a3b8", fontSize: 11 }}>
            external_id {g.external_id}
          </div>
        </Td>
        <Td>{g.slate_status ?? "—"}</Td>
        <Td>
          <span style={{ fontSize: 12 }}>{p.prediction_source ?? "—"}</span>
          {p.is_override && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                background: "#dbeafe",
                color: "#1e40af",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              OVERRIDE
            </span>
          )}
        </Td>
        <Td>
          <MarketCell m={p.ml} />
        </Td>
        <Td>
          <MarketCell m={p.ou} />
        </Td>
        <Td>
          <MarketCell m={p.nrfi} />
        </Td>
        <Td>
          {p.fully_held ? (
            <span style={{ color: "#b45309", fontSize: 12, fontWeight: 600 }}>
              fully
            </span>
          ) : p.held_count > 0 ? (
            <span style={{ color: "#a16207", fontSize: 12 }}>
              {p.held_count}/3
            </span>
          ) : (
            <span style={{ color: "#15803d", fontSize: 12 }}>—</span>
          )}
        </Td>
        <Td>
          <button
            onClick={onToggle}
            style={{
              padding: "2px 8px",
              background: "#fff",
              color: "#475569",
              border: "1px solid #cbd5e1",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {expanded ? "Hide" : "Show"}
          </button>
        </Td>
      </tr>
      {expanded && (
        <tr style={{ background: "#fafafa" }}>
          <Td colSpan={9}>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>
              <strong>computed_at:</strong> {p.computed_at ?? "—"}
              {" · "}
              <strong>locked_at:</strong> {p.locked_at ?? "null"}
            </div>
            {p.model_breakdown ? (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12,
                  color: "#1f2937",
                  background: "#fff",
                  padding: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 4,
                  margin: 0,
                }}
              >
                {p.model_breakdown}
              </pre>
            ) : (
              <em style={{ color: "#94a3b8", fontSize: 12 }}>
                no model_breakdown stored (breakdown_v2.model_breakdown is
                empty)
              </em>
            )}
          </Td>
        </tr>
      )}
    </>
  );
}
