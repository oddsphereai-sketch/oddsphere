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
middleware.ts                        Accepts Whop OR beta session
app/login/page.tsx                   Surfaces Whop button when enabled
app/pricing/page.tsx                 CTA → Whop checkout when configured
```

All of these fail closed if `WHOP_OAUTH_ENABLED` is anything other than
`"true"` AND every required env var is set.
