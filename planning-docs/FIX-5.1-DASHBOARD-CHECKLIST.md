# Fix 5.1 — Vercel Dashboard + Operational Pre-Push Checklist

**Status:** Manual verification required by Daniel before pushing Fix 4.1 + Fix 5.1 to `origin/main`.

**Why this exists:** Fix 5.1 ships code-level protection (Edge middleware + beta password cookie + fail-closed `ODDSPHERE_DATA_MODE`), but defense-in-depth requires Vercel dashboard settings + production env vars to be correctly configured. This document is the operational gate — every item must be verified before push.

The repo cannot self-verify these items. Daniel checks each one in the Vercel dashboard or Vercel CLI.

---

## 1. Vercel project Git integration

- [ ] Open `vercel.com → OddSphere project → Settings → Git`.
- [ ] **Production Branch** = `main` (or note actual value if different).
- [ ] **Auto-deploy from production branch** = enabled (Vercel default — confirm not disabled).
- [ ] **Preview deployments** — note current configuration. Preview deploys from other branches WILL be created on push of any branch unless explicitly disabled.

**Why:** Confirms whether `git push origin main` triggers a production deploy. If `main` is NOT the production branch, the deploy goes to a preview URL instead — different exposure pattern.

---

## 2. Vercel Deployment Protection

- [ ] Open `vercel.com → OddSphere project → Settings → Deployment Protection`.

### Production deployment

Recommended: **Standard Protection (Password Protection)** with the **same** value as `LAB_BETA_PASSWORD`.

- [ ] If enabling: set the password to match `LAB_BETA_PASSWORD` so members enter the password once at the Vercel edge and again at `/login` is not required (Vercel cookie unlocks the deployment; `/login` cookie unlocks the app gate). **Or** use different values and accept two-step entry.
- [ ] If skipping dashboard protection: explicitly note "dashboard protection disabled; relying on middleware code-gate" — acceptable per Fix 5.1 design (A3 defense-in-depth recommends both; A2 is code-only).

### Preview deployment

Recommended: **Vercel Authentication** (only members of your Vercel team can view previews).

- [ ] If enabling: confirm only the developers/operators you trust are on the Vercel team.
- [ ] **Alternative:** Password Protection with the same `LAB_BETA_PASSWORD` value — simpler for solo dev.

---

## 3. Production environment variables

Open `vercel.com → OddSphere project → Settings → Environment Variables → Production scope`.

Required (set + non-empty):

- [ ] `LAB_BETA_PASSWORD` — **strong random value** (generate locally: `openssl rand -hex 24` → 48 hex chars). **Do NOT commit this value anywhere; only set it in Vercel + share via Whop announcement.** If missing or empty in production, the gate fails closed (every Lab route redirects to /login with `error=unavailable`).
- [ ] `ODDSPHERE_DATA_MODE` — **either UNSET or set to anything OTHER than `development`** (e.g., `production`). Per Fix 5.1 Flag C1 fail-closed inversion, the filter is active by default; only the literal `"development"` disables it.
- [ ] `ADMIN_TOKEN` — existing admin auth, verify still present.
- [ ] `ADMIN_EMAIL_ALLOWLIST` — existing admin email allowlist, verify still present (should contain Daniel's email).
- [ ] `CRON_SECRET` — existing cron auth, verify still present.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server-side only, never `NEXT_PUBLIC_`).

Provider switches (existing — confirm not regressed):

- [ ] `USE_REAL_STATS=false` (or unset)
- [ ] `USE_REAL_BETTING=false`
- [ ] `USE_REAL_WEATHER=false`
- [ ] `USE_REAL_PARK_FACTORS=false`
- [ ] `USE_AUTO_SCORES_MODEL_*` — all `false` for V1 launch.

Optional (Phase 7+):

- [ ] `BALLDONTLIE_API_KEY`, `SHARPAPI_KEY`, `OPENWEATHER_API_KEY` — empty at launch (V1 uses mock providers + Daniel's manual upload).

---

## 4. Preview environment variables

Open `vercel.com → OddSphere project → Settings → Environment Variables → Preview scope`.

- [ ] `LAB_BETA_PASSWORD` — set (can match production OR a separate preview-only value for staging).
- [ ] `ODDSPHERE_DATA_MODE=development` — **explicitly set to `development`** so preview deploys surface seed mock data for pre-launch QA. Without this set, preview deploys fail closed and the Lab returns empty arrays (no QA visibility into seed data).
- [ ] All other vars (admin, cron, Supabase) — same as production.

---

## 5. Production database (Supabase)

- [ ] If launching with real data: verify `game_predictions.source_type` for live rows is `'real_api'` or `'manual'` (NOT `'mock'`) so the filter passes them through.
- [ ] If launching with manual-upload data only: confirm Daniel's upload flow writes `source_type='manual'`. **Note: Gap-23.5 follow-up still tracks that `slatePublishService.ts` hardcodes `'mock'`. Manual upload tooling needs the `'manual'` write when Phase 7.25 lands.** Until then, manually inserted rows may need a SQL update to set `source_type` correctly.
- [ ] RLS policies for the `anon` role allow reads of the rows you want member-visible (currently mostly handled in `lib/db/schema.sql`).

---

## 6. Post-push verification (after dashboard items above are confirmed)

After pushing both Fix 4.1 (`adf7be7`) + Fix 5.1 to `origin/main`:

- [ ] Open `https://<production-url>/lab/daily-edge` in a fresh incognito window. Expected: redirect to `/login?next=/lab/daily-edge`. If you see the Lab UI directly, the middleware is not deployed correctly.
- [ ] Submit the beta password at `/login`. Expected: redirect back to `/lab/daily-edge`. Verify the page renders.
- [ ] Open `https://<production-url>/api/lab/daily-edge` in an incognito window. Expected: JSON `{ "error": "auth_required", "login_url": "/login" }` with status 401.
- [ ] If `ODDSPHERE_DATA_MODE` is unset/non-development in production env: the authenticated `/lab/daily-edge` should return zero games (all 12 seed games are `source_type='mock'`). This is the framework-correct empty state — members see "Live data hasn't arrived for tonight's slate yet."
- [ ] Verify admin pages: `https://<production-url>/admin/scores-model` should also redirect to /login when unauthenticated.
- [ ] Verify cron auth unaffected: `https://<production-url>/api/cron/morning-slate` should return 401 (CRON_SECRET gate at handler).
- [ ] Verify admin API auth unaffected: `https://<production-url>/api/admin/cron-status` should return 401 (`validateAdminAuth` at handler).

---

## 7. Rollback plan

If the deploy looks wrong after push:

- [ ] Vercel dashboard → `Deployments` → find the previous green deploy → **"Promote to Production"**. Reverts the production URL to the prior commit (`a9f2db9` for Fix 3.1 or earlier).
- [ ] In `git` locally: `git revert <commit-hash>` to invert the deploy, then push. Cleaner audit trail than promoting a prior deploy.
- [ ] Worst case (gate locks Daniel out due to env misconfiguration): in Vercel dashboard, set `LAB_BETA_PASSWORD` to a known test value, then re-test. Or temporarily unset the env var and redeploy — that will cause the gate to fail closed (still inaccessible) but you'll know the env var is the root cause.

---

## Confirmation log (Daniel fills these in before push)

- Date checked: ___________________
- Production branch: ___________________
- Production Deployment Protection: ___________________
- `LAB_BETA_PASSWORD` set + value-length OK: ___________________
- `ODDSPHERE_DATA_MODE` in production: ___________________
- Preview Deployment Protection: ___________________
- Notes: ___________________

---

**Once every item is checked: Fix 4.1 + Fix 5.1 are safe to push. The gate is real at the code level and reinforced at the dashboard level.**
