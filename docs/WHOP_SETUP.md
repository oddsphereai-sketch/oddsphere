# Whop Access Integration — Setup Guide

This doc covers the manual Whop dashboard + Vercel steps required to
activate the OAuth + access-check scaffold added in Phase 6B.3a. Until
every step here is completed, `WHOP_OAUTH_ENABLED` stays `false` and
the login page surfaces only the beta-password fallback.

## 1. Whop dashboard setup

### a. Create / confirm your Whop product (store)

1. https://whop.com/dashboard → your company → **Products**
2. Create the OddSphere Premium product (or confirm the existing one).
3. Note the product ID — it looks like `prod_XXXXXXXXXXXXXXXX`.
4. Copy the public checkout URL (the "Get Access" link). This goes into
   `WHOP_CHECKOUT_URL`.

### Current public pricing

OddSphere Premium uses two public recurring plans on the same product:

- Monthly: 7 days free, then $19.99 every 30 days.
- Yearly: $199 every 365 days, charged immediately with no free trial.

The website's canonical direct-checkout URLs live in
`lib/marketing/trialOffer.ts`. General marketing CTAs route through `/pricing`
so customers can choose a billing cadence. Legacy monthly plans may remain
hidden while they still have active memberships; never delete or move the
product itself because the product ID is the access-control resource.

If you'd rather gate on the company (any product in your Whop store)
or a specific experience, use a `biz_XXX` or `exp_XXX` id instead.
Whichever id you choose goes into `WHOP_RESOURCE_ID` and is what every
member must hold access to in order to enter the Lab.

### b. Create a Developer App

1. https://whop.com/dashboard → **Developer** → **Apps** → **Create App**
2. Name it "OddSphere AI Lab"
3. Note the **App ID** (`app_XXXXXXXXXXXXXXXX`) — this is `WHOP_CLIENT_ID`
4. Generate / reveal the **Client Secret** — this is `WHOP_CLIENT_SECRET`

### c. Register the OAuth redirect URI

In the Developer App config, add an exact-match redirect URI. The
scaffold uses:

- Production: `https://oddsphereai.com/api/auth/whop/callback`
- Local dev:  `http://localhost:3000/api/auth/whop/callback`

(Whop allows multiple URIs — register both so you can run the flow
end-to-end against `npm run dev`.)

### d. Server API key

The access-check endpoint requires a server-side API key with
permission to read membership/access for the resource above.

1. Developer → **API Keys** → **Create**
2. Grant it the membership / access read scope.
3. Copy the key into `WHOP_API_KEY`.

### e. (Optional) Webhook

Phase 6B.3a does **not** ship a webhook receiver — the OAuth + access
check on login is enough for the launch contract (we re-check on every
sign-in). A `WHOP_WEBHOOK_SECRET` env will be added later when we wire
`/api/webhooks/whop`.

## 2. Vercel environment variables

In your Vercel project → **Settings** → **Environment Variables**, add
the following for **Production** (and optionally **Preview**):

| Name                  | Source                                        |
| --------------------- | --------------------------------------------- |
| `WHOP_OAUTH_ENABLED`  | `true`                                        |
| `WHOP_CLIENT_ID`      | App ID from step 1b                           |
| `WHOP_CLIENT_SECRET`  | Client Secret from step 1b                    |
| `WHOP_REDIRECT_URI`   | `https://oddsphereai.com/api/auth/whop/callback` |
| `WHOP_API_KEY`        | API key from step 1d                          |
| `WHOP_RESOURCE_ID`    | `prod_XXX` (or `biz_XXX` / `exp_XXX`) from 1a |
| `WHOP_SESSION_SECRET` | `openssl rand -hex 32`                        |
| `WHOP_CHECKOUT_URL`   | Public checkout URL from step 1a              |

Keep `LAB_BETA_PASSWORD` set as the emergency-override fallback —
clear it later only after Whop has been verified working end-to-end.

## 3. Redeploy

Trigger a redeploy in Vercel so the new env vars take effect.

## 4. Smoke test (must do)

After redeploy, verify these four flows by hand:

1. **Logged-out homepage** still loads at `/` and shows the marketing
   page.
2. **Visit `/lab/daily-edge` while logged out** → redirected to
   `/login?next=%2Flab%2Fdaily-edge`.
3. **Click "Sign in with Whop"** → bounces through `whop.com` → returns
   to `/api/auth/whop/callback` → and lands on `/lab/daily-edge` when
   the Whop account holds the configured resource.
4. **Sign in with a Whop account that does NOT hold access** → lands on
   `/pricing` (or `WHOP_CHECKOUT_URL` if configured). Never on the Lab.

If any step misbehaves, the relevant error code lands as a `?error=`
param on `/login` so the page surface tells you which leg failed
(`whop_token`, `whop_userinfo`, `whop_access_error`, …).

## 5. Remove the beta fallback (optional, later)

Once Whop is verified in production:

1. Delete `LAB_BETA_PASSWORD` from Vercel.
2. The login page automatically removes the beta form (the page reads
   `isBetaFallbackEnabled()` on every render).

Whop remains the only entry path. The middleware still accepts an old
beta cookie if a member is mid-session at the time of removal; the
cookie expires within 7 days.

## 6. Files involved

```
lib/auth/whopConfig.ts        env validation + endpoint constants
lib/auth/whopSession.ts       HMAC-signed session cookie
lib/auth/whopOAuth.ts         PKCE, authorize URL, token exchange, userinfo
lib/auth/whopAccess.ts        Whop access-check API call

app/api/auth/whop/start/route.ts     OAuth start
app/api/auth/whop/callback/route.ts  OAuth callback → access check → mint cookie
app/api/auth/whop/status/route.ts    Public flag probe (debug)
app/api/auth/logout/route.ts         Clears both sessions
proxy.ts                             Accepts Whop OR beta session
app/login/page.tsx                   Surfaces Whop button when enabled
app/pricing/page.tsx                 monthly + yearly CTAs → Whop checkout
lib/marketing/trialOffer.ts          canonical prices + direct-checkout URLs
```

All of these fail closed if `WHOP_OAUTH_ENABLED` is anything other than
`"true"` AND every required env var is set.

## 7. Troubleshooting

### `{"error":"invalid_request","error_description":"redirect_uri is invalid"}`

This is Whop telling you the `redirect_uri` we sent doesn't match any of
the URIs registered in your Whop Developer App. Diagnose:

```
curl -s https://oddsphereai.com/api/auth/whop/status | jq .redirect_uri
```

The response carries the **exact** URI we hand to Whop:

```json
{
  "full": "https://oddsphereai.com/api/auth/whop/callback",
  "host": "oddsphereai.com",
  "path": "/api/auth/whop/callback",
  "protocol": "https",
  "has_trailing_slash": false,
  "parsed": true
}
```

In the Whop dashboard → Developer → your OAuth app → Redirect URIs, you
must have a row that **character-for-character matches `full`**.
Common mismatches:

| Field | Typical correct value | Common mistake |
| --- | --- | --- |
| `host` | `oddsphereai.com` | `www.oddsphereai.com` or `oddsphere.ai` |
| `protocol` | `https` | `http` (Whop rejects http on production hosts) |
| `path` | `/api/auth/whop/callback` | `/auth/whop/callback` (missing `/api`) or typo |
| `has_trailing_slash` | `false` | `true` (extra `/` at end) |

Two fixes either of which clears the error:

1. **Update Whop** — open the Developer App config, edit the registered
   redirect URI to match the `full` value above. Save.
2. **Update Vercel** — change the `WHOP_REDIRECT_URI` env var to match
   what's already registered in Whop, then redeploy.

If `parsed` is `false`, `WHOP_REDIRECT_URI` is unset or malformed —
re-check the Vercel env var, redeploy, then `curl /api/auth/whop/status`
again.

### "Sign in with Whop" button doesn't appear

```
curl -s https://oddsphereai.com/api/auth/whop/status | jq
```

Look at `whop_enabled` and `missing_whop_envs`:

- `whop_enabled: true` + empty `missing_whop_envs` → config is good; the
  button should appear. Force-reload the login page.
- `whop_enabled: false` + non-empty `missing_whop_envs` → those exact
  env names are missing or empty in Vercel. Set them, redeploy.
- `whop_enabled: false` + `whop_oauth_enabled_flag: false` → set
  `WHOP_OAUTH_ENABLED=true` in Vercel, redeploy.

### Sign-in succeeds but `whop_access_error` shows on `/login`

The OAuth round-trip worked but the access-check API returned an error.
Most often the `WHOP_API_KEY` lacks `access_pass:basic:read` scope or
the `WHOP_RESOURCE_ID` doesn't exist under your company. Verify with:

```
npx tsx --env-file=.env.local scripts/operator/discover-whop-resources.ts \
  --company-id biz_NS0QQRENKrAf96
```

Confirm the `prod_xxx` matches what's in Vercel.

### "Sign-in was cancelled" appears immediately after clicking Sign in with Whop

The callback now shows the exact Whop error code on the login page
(`Whop responded: <code>`). Match that code below:

| Whop code | OddSphere shows | What it usually means |
| --- | --- | --- |
| `access_denied` | `whop_denied` | The user clicked **Deny** on the consent screen, OR the Whop OAuth app's scopes (`openid profile email`) aren't all approved for this user. |
| `unauthorized_client` | `whop_oauth_unauthorized` | The Whop OAuth app is **not authorized to run the OAuth flow**. Common causes:<br>• OAuth not enabled on the Developer App.<br>• App is still in draft / not published.<br>• Redirect URI not listed in the app's allowed URIs (different from the previous "redirect_uri is invalid" — this means the app itself is blocked even before URI check). |
| `invalid_scope` | `whop_oauth_scope` | One of the requested scopes (`openid`, `profile`, `email`) isn't enabled on the OAuth app. Edit the app config → Scopes → tick all three. |
| `invalid_request` | `whop_oauth_request` | Our authorize URL params are malformed. If you see this with our scaffold, file an issue — usually means a Whop API change. |
| `server_error` / `temporarily_unavailable` | `whop_oauth_server` / `whop_oauth_unavailable` | Whop-side outage. Try again in a minute. |

The most common cause for an `access_denied` you can't explain is
that the Whop Developer App needs **OAuth approval / publication**.
Open the app in Whop dashboard → check for a "Publish", "Enable OAuth",
or "Submit for review" toggle. Also confirm all three scopes
(`openid`, `profile`, `email`) are listed as **enabled**, not just
requested.

### Sign-in succeeds but a paying member is sent to `/pricing`

The API key + resource id are reachable, but the access check returned
`has_access: false` for that user. Two paths:

1. They actually don't hold an active membership (check Whop dashboard
   → Members).
2. The `WHOP_RESOURCE_ID` is pinned to the wrong product. Re-run the
   discovery script; verify the highlighted row.
