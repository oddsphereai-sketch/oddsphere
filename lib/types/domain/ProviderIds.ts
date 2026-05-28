/**
 * Fix 7.1 (Identity model) — per-provider id attachments on teams / games /
 * players. Mirrors the `provider_ids JSONB` column added in V14 migration.
 *
 * The canonical internal identity remains the `id` column on each table.
 * `provider_ids` is purely the federated identity attachment surface: each
 * provider that knows about a row attaches its own id under a stable
 * snake_case key.
 *
 * Reserved key conventions (not DB-enforced, kept consistent in code):
 *   • "balldontlie" — BALLDONTLIE.io ids (current seed provider)
 *   • "sharpapi"    — future SharpAPI ids (Phase 8)
 *   • "oddsapi"     — future OddsAPI ids (fallback)
 *   • "manual"      — internal serial assigned by the manual-slate
 *                     provider (Fix 7.2; not in scope for Fix 7.1)
 *
 * Values may be string or number (JSONB preserves both). Convention for
 * lookups: coerce via `String(value)` so int-vs-string mismatches don't
 * silently miss.
 *
 * Defaults to `{}` for every row in V14; Fix 7.1 ships no backfill, so
 * existing rows have empty provider_ids until the provider that owns them
 * attaches its key.
 */
export type ProviderIds = Record<string, string | number>;
