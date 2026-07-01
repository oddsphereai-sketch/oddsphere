# Ops (local control panel)

Your **private** internal dashboard for running OddSphere. It is **not** part of the
deployed app, has **no route on oddsphereai.com**, and is never bundled or shipped —
it only runs on your machine when you start it.

## Run it

```bash
npm run ops
```

Then open **http://localhost:4317** in your browser. Ctrl-C in the terminal to stop.

(It loads your `.env.local` for read-only database access — the keys stay on your
machine, never in the browser.)

## What's on it

- **Performance** — live unit tracking by sport, by MLB market, and by play grade
  (units from each bet's real odds; No Play / Toss-Up excluded). Pick the window
  with the `since` dropdown.
- **Health** — last slate, last lock, lines freshness, today graded/pending, graded
  coverage by sport.
- **Active model rules** — what's actually shaping picks right now, per sport.
- **To-dos** — pending work with priority/status.
- **Changelog / decisions** — what shipped and when.
- **Standing principles** — the rules we operate by.

## Update it

Everything hand-maintained lives in **`ops-local/content.ts`** — edit the
`MODEL_RULES`, `TODOS`, `CHANGELOG`, `PRINCIPLES` arrays and refresh the page.
The live numbers come from `ops-local/data.ts` (read-only DB queries).

## Files

- `server.ts` — tiny local HTTP server + the page UI (no build step).
- `data.ts` — live data layer (its own Supabase client from your env).
- `content.ts` — your editable notebook (rules / todos / changelog / principles).
