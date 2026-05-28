"use client";

/**
 * /admin/scores-model — Daniel's scores-model upload UI (V1).
 *
 * Auth: simple email + token form on first load. Credentials persisted in
 * localStorage; sent as headers with every API call.
 *
 * Workflow:
 *   1. Pick sport + date
 *   2. UI fetches tonight's slate from /api/admin/games → renders game rows
 *   3. Each row exposes sport-specific form fields (driven by sportSchemas)
 *   4. Form values auto-saved to localStorage on every change (per sport+date)
 *   5. Preview button → summary of what would be uploaded
 *   6. Publish button → POST /api/admin/upload-scores-model
 *
 * V1 priorities: WORKS, sport-aware, idempotent. Polish is Phase 6.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { SPORT_SCHEMAS, type SportSchemaField } from "@/lib/scoresModel/sportSchemas";
import type { Sport } from "@/lib/types/domain/Sport";

const SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl", "ucl", "cfb", "cbb"];

type SlateGame = {
  external_id: number;
  game_date: string;
  status: string;
  home_team: { abbreviation: string; display_name: string };
  away_team: { abbreviation: string; display_name: string };
};

type FormValuesByGame = Record<number, Record<string, unknown>>;

type GradesUpdated = {
  game_predictions: number;
  prop_predictions: number;
  per_market: {
    ml: { derived: number; written: number };
    ou: { derived: number; written: number };
    nrfi: { derived: number; written: number };
  };
  /** Set only when synchronous derivation throws — see Flag B1. */
  error?: string;
};

type PublishResult = {
  sport: Sport;
  date: string;
  inserted: number;
  updated: number;
  failed: number;
  /** Fix 6.1.1: grades derived at upload time (replaces verdicts_updated). */
  grades_updated: GradesUpdated;
  errors: Array<{ game_external_id: number; errors: string[] }>;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────
// Page (top-level — handles auth gate)
// ─────────────────────────────────────────────────────────────────────────
export default function AdminScoresModelPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Restore saved credentials on mount
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
    // Sanity-check by hitting /api/admin/games for MLB today
    const res = await fetch(`/api/admin/games?sport=mlb&date=${todayDate()}`, {
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
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Admin · Scores Model Upload</h1>
        <p style={{ color: "#666", marginBottom: 24 }}>
          Email + admin token (set in env). V1 simple auth — Phase 8 wires
          Whop admin role.
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
    <ScoresModelForm
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
// Main form
// ─────────────────────────────────────────────────────────────────────────
function ScoresModelForm({
  email,
  token,
  onSignOut,
}: {
  email: string;
  token: string;
  onSignOut: () => void;
}) {
  const [sport, setSport] = useState<Sport>("mlb");
  const [date, setDate] = useState(todayDate());
  const [games, setGames] = useState<SlateGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [formValues, setFormValues] = useState<FormValuesByGame>({});
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schema = SPORT_SCHEMAS[sport];
  const draftKey = useMemo(() => `scores_model_draft_${sport}_${date}`, [sport, date]);

  // Load slate when sport/date changes
  useEffect(() => {
    setError(null);
    setPublishResult(null);
    setLoading(true);
    fetch(`/api/admin/games?sport=${sport}&date=${date}`, {
      headers: { "x-admin-email": email, "x-admin-token": token },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Slate fetch failed (${res.status}): ${await res.text()}`);
        return res.json();
      })
      .then((data: { games: SlateGame[] }) => setGames(data.games))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sport, date, email, token]);

  // Load draft from localStorage on sport/date change
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      setFormValues(saved ? (JSON.parse(saved) as FormValuesByGame) : {});
    } catch {
      setFormValues({});
    }
  }, [draftKey]);

  // Auto-save draft on change
  useEffect(() => {
    if (Object.keys(formValues).length > 0) {
      localStorage.setItem(draftKey, JSON.stringify(formValues));
    }
  }, [draftKey, formValues]);

  function setFieldValue(gameExtId: number, fieldKey: string, value: unknown) {
    setFormValues((prev) => ({
      ...prev,
      [gameExtId]: { ...(prev[gameExtId] ?? {}), [fieldKey]: value },
    }));
  }

  function buildPredictions() {
    return games.map((g) => {
      const values = formValues[g.external_id] ?? {};
      const topLevel: Record<string, unknown> = {
        game_external_id: g.external_id,
        model_version: "daniels-v3.2",
        computed_at: new Date().toISOString(),
      };
      const sportSpecific: Record<string, unknown> = {};
      for (const f of schema.fields) {
        // Fix 7.2.3 (Q1 = BOTH): for fields declared `computeFrom`, derive
        // the value here instead of reading from formValues. The server-side
        // ingester also recomputes defensively, so client + server agree.
        let v: unknown = values[f.key];
        if (f.computeFrom === "predicted_home_score + predicted_away_score") {
          v = computeTotalFromValues(values);
        }
        if (v === undefined || v === "") continue;
        if (f.scope === "top_level") topLevel[f.key] = v;
        else sportSpecific[f.key] = v;
      }
      if (Object.keys(sportSpecific).length > 0) {
        topLevel.sport_specific = sportSpecific;
      }
      return topLevel;
    });
  }

  async function handlePublish() {
    setError(null);
    setPublishResult(null);
    const predictions = buildPredictions();
    try {
      const res = await fetch("/api/admin/upload-scores-model", {
        method: "POST",
        headers: {
          "x-admin-email": email,
          "x-admin-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sport, date, predictions }),
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
      }
      const body = (await res.json()) as PublishResult;
      setPublishResult(body);
      if (body.failed === 0) {
        // Clear draft on full success
        localStorage.removeItem(draftKey);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function clearDraft() {
    localStorage.removeItem(draftKey);
    setFormValues({});
  }

  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Scores Model Upload</h1>
        <button onClick={onSignOut} style={{ padding: "4px 12px", fontSize: 13, background: "#eee", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}>
          Sign out
        </button>
      </header>

      {/* Fix 6.1 (Gap-23.5) — Daniel-facing provenance note. Uploads here
          write source_type='manual' and pass the production filter at
          lib/db/productionFilter.ts. */}
      <div style={{ background: "#eef6ff", border: "1px solid #bcd9f5", color: "#1d4d8c", padding: "10px 14px", borderRadius: 4, marginBottom: 24, fontSize: 13, lineHeight: 1.5 }}>
        Uploads are tagged <strong>manual</strong> and can surface in
        Production Daily Edge. Use seed/dev data only for mock testing.
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "center" }}>
        <label>
          Sport
          <select value={sport} onChange={(e) => setSport(e.target.value as Sport)} style={{ marginLeft: 8, padding: 6 }}>
            {SPORTS.map((s) => (
              <option key={s} value={s}>{SPORT_SCHEMAS[s].displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 8, padding: 6 }} />
        </label>
        <button onClick={clearDraft} style={{ padding: "4px 12px", fontSize: 13, background: "#eee", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", marginLeft: "auto" }}>
          Clear draft
        </button>
      </div>

      {error && (
        <div style={{ color: "#b00", background: "#fee", padding: 12, borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && <p>Loading slate…</p>}

      {!loading && games.length === 0 && (
        <p style={{ color: "#666" }}>
          No games found for {schema.displayName} on {date}. Try a different date or sport.
        </p>
      )}

      {games.map((g) => (
        <GameRow
          key={g.external_id}
          game={g}
          schemaFields={schema.fields}
          values={formValues[g.external_id] ?? {}}
          onChange={(field, value) => setFieldValue(g.external_id, field, value)}
        />
      ))}

      {games.length > 0 && (
        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <button
            onClick={handlePublish}
            style={{ padding: "10px 20px", background: "#000", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 15 }}
          >
            Publish
          </button>
          <span style={{ alignSelf: "center", color: "#666", fontSize: 13 }}>
            {games.length} games · drafts auto-saved
          </span>
        </div>
      )}

      {publishResult && (
        <div style={{ marginTop: 24, padding: 16, background: publishResult.failed === 0 ? "#efe" : "#fee", borderRadius: 4 }}>
          <h3 style={{ marginTop: 0 }}>Publish result</h3>
          <p>
            Inserted: {publishResult.inserted} · Updated: {publishResult.updated} · Failed: {publishResult.failed}
          </p>
          {/* Fix 6.1.1: surface per-market grade-derivation counts so the
              operator can see Daily Edge will render actual pick cards. */}
          <p style={{ marginTop: 8 }}>
            Grades derived: {publishResult.grades_updated.game_predictions} game(s)
            {" · "}
            ML {publishResult.grades_updated.per_market.ml.derived}/{publishResult.grades_updated.per_market.ml.written}
            {" · "}
            OU {publishResult.grades_updated.per_market.ou.derived}/{publishResult.grades_updated.per_market.ou.written}
            {" · "}
            NRFI {publishResult.grades_updated.per_market.nrfi.derived}/{publishResult.grades_updated.per_market.nrfi.written}
            {publishResult.grades_updated.error && (
              <span style={{ color: "#b00" }}>
                {" · Derivation error: "}
                {publishResult.grades_updated.error}
              </span>
            )}
          </p>
          {publishResult.errors.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              {publishResult.errors.map((e, i) => (
                <li key={i}>
                  Game {e.game_external_id}: {e.errors.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// One game row with all sport-specific fields
// ─────────────────────────────────────────────────────────────────────────
function GameRow({
  game,
  schemaFields,
  values,
  onChange,
}: {
  game: SlateGame;
  schemaFields: readonly SportSchemaField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const gameTime = new Date(game.game_date).toLocaleString();
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 16, marginBottom: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <strong>
          {game.away_team.abbreviation} @ {game.home_team.abbreviation}
        </strong>
        <span style={{ color: "#666", fontSize: 13 }}>{gameTime}</span>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {schemaFields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            allValues={values}
            onChange={(v) => onChange(field.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Fix 7.2.3 — decimal-safe parsing helpers used by both the form's
// computed-total derivation and the DecimalInput component.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Strict decimal regex used to validate the raw string before committing
 * to parent state. Accepts integers and positive decimals; rejects
 * intermediate states like "4." or ".5" that JavaScript's Number() would
 * silently coerce in surprising ways.
 */
const STRICT_DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Parse a value (string or number) into a number, returning undefined for any unparseable input. */
function parseDecimal(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  if (!STRICT_DECIMAL_RE.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Compute predicted_total from a row's values map. Returns undefined when
 * either component is missing/unparseable so the disabled total input
 * renders "—" instead of a misleading 0 or NaN.
 */
function computeTotalFromValues(values: Record<string, unknown>): number | undefined {
  const home = parseDecimal(values.predicted_home_score);
  const away = parseDecimal(values.predicted_away_score);
  if (home === undefined || away === undefined) return undefined;
  return Math.round((home + away) * 10) / 10;
}

function FieldInput({
  field,
  value,
  allValues,
  onChange,
}: {
  field: SportSchemaField;
  value: unknown;
  allValues: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${field.key}`;

  // Fix 7.2.3: computed field (predicted_total) renders as a disabled
  // text input showing the live home + away derivation. Operator can see
  // the value that will be submitted but cannot edit it directly.
  if (field.computeFrom === "predicted_home_score + predicted_away_score") {
    const computed = computeTotalFromValues(allValues);
    return (
      <label htmlFor={id} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
        <span style={{ marginBottom: 4 }}>{field.label}{field.required && " *"}</span>
        <input
          id={id}
          type="text"
          disabled
          value={computed !== undefined ? String(computed) : "—"}
          title="Auto-calculated from away + home."
          style={{ padding: 6, background: "#f5f5f5", color: "#555", cursor: "not-allowed" }}
        />
        <span style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
          Auto-calculated from away + home.
        </span>
      </label>
    );
  }

  // Fix 7.2.3: decimal-safe text input. Holds the raw user-typed string
  // in local state while editing so intermediate values like "4." don't
  // get mangled by Number() round-tripping. Pushes parsed numbers to
  // parent on any keystroke that produces a clean integer/decimal; on
  // blur, snaps back to the parent's value if the raw is unparseable
  // (rejects garbage cleanly).
  if (field.decimal) {
    return (
      <DecimalInput
        id={id}
        label={field.label}
        required={field.required}
        helpText={field.helpText}
        min={field.min}
        max={field.max}
        value={value as number | undefined}
        onChange={onChange}
      />
    );
  }

  if (field.type === "enum") {
    return (
      <label htmlFor={id} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
        <span style={{ marginBottom: 4 }}>{field.label}{field.required && " *"}</span>
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={{ padding: 6 }}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "boolean") {
    return (
      <label htmlFor={id} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
        <span style={{ marginBottom: 4 }}>{field.label}{field.required && " *"}</span>
        <select id={id} value={value === undefined ? "" : value ? "true" : "false"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")} style={{ padding: 6 }}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    );
  }
  // number / percent
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
      <span style={{ marginBottom: 4 }}>{field.label}{field.required && " *"}</span>
      <input
        id={id}
        type="number"
        // Fix 7.2.2: inputMode='decimal' hints to the browser (especially
        // mobile keyboards) that the operator will enter decimal values.
        // Combined with step='any' it prevents the "can't type a dot"
        // friction the smoke surfaced. If issues persist on specific
        // browsers/locales, the next escalation is type='text' +
        // pattern='[0-9]*\.?[0-9]*' + onBlur normalization.
        inputMode="decimal"
        step="any"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        min={field.min}
        max={field.max}
        style={{ padding: 6 }}
      />
      {field.helpText && <span style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{field.helpText}</span>}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Fix 7.2.3 — decimal-safe text input.
//
// Holds the user-typed string in local state during editing so React's
// controlled-input round-trip doesn't lose intermediate characters like
// "4." that JavaScript's Number() coerces to 4 (then the value prop
// re-renders as "4" instead of "4."). On any keystroke that produces a
// clean integer/decimal we push the parsed number to parent; on blur we
// clamp the raw to the last valid parent value if the current text is
// unparseable (rejects garbage cleanly).
// ─────────────────────────────────────────────────────────────────────────
function DecimalInput({
  id,
  label,
  required,
  helpText,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  required: boolean;
  helpText?: string;
  min?: number;
  max?: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const valueAsString = value === undefined ? "" : String(value);
  const [raw, setRaw] = useState<string>(valueAsString);
  const isFocusedRef = useRef(false);

  // Sync raw → parent's value when parent changes externally (e.g.
  // localStorage hydration, game switch). Skip the sync while the user
  // is actively typing so we don't clobber their input mid-edit.
  useEffect(() => {
    if (!isFocusedRef.current && raw !== valueAsString) {
      setRaw(valueAsString);
    }
    // raw intentionally omitted from deps: this hook reacts to parent
    // value changes only; raw changes are driven by user input below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueAsString]);

  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
      <span style={{ marginBottom: 4 }}>{label}{required && " *"}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        value={raw}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          if (next === "") {
            onChange(undefined);
          } else if (STRICT_DECIMAL_RE.test(next)) {
            onChange(Number(next));
          }
          // Otherwise: keep raw as-is, don't push to parent (intermediate
          // state like "4." — wait for the user to keep typing or blur).
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          if (raw === "") {
            onChange(undefined);
          } else if (STRICT_DECIMAL_RE.test(raw)) {
            onChange(Number(raw));
          } else {
            // Invalid at blur — snap raw back to last valid parent value.
            setRaw(value === undefined ? "" : String(value));
          }
        }}
        style={{ padding: 6 }}
      />
      {/* Honor min/max as advisory hints for the operator; final
          enforcement lives in the schema validator server-side. */}
      {(min !== undefined || max !== undefined) && (
        <span style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
          {min !== undefined && max !== undefined && `${min}–${max}`}
          {min !== undefined && max === undefined && `min ${min}`}
          {min === undefined && max !== undefined && `max ${max}`}
        </span>
      )}
      {helpText && <span style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{helpText}</span>}
    </label>
  );
}
