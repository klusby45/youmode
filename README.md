# 75 HARD

A bold, athletic accountability tracker for a customized 75-day challenge between **Kyle** and **Dylen**, judged by **Marcus**. Daily proof (photos + water), a head-to-head scoreboard, the stakes (Kyle → red mohawk, Dylen → bald) front and center, a 75-day proof calendar, the professional launch goals, and a judge's review bench.

React 19 + Vite · Supabase (Auth + Postgres + Storage + Realtime) · CSS-in-JS · deploy on Vercel.

## Live

- **App:** https://kyle-dylen-75hard.netlify.app  (Netlify site `kyle-dylen-75hard`)
- **Supabase:** the **steve-crm** project (ref `aqaubrbssnbtomykexgr`) hosts 75 Hard alongside the CRM — its tables (`profiles`, `challenge_config`, `daily_logs`) are isolated from `contacts`. Creds are the app's built-in fallback, so no `.env.local` is needed.
- **Login:** username = first name, password = first name (`kyle`/`kyle`, `dylen`/`dylen`, `marcus`/`marcus`). Usernames map to `<name>@75hard.app` behind the scenes.

### Two remaining steps (must be done by a human)
1. **Apply the schema.** Open the steve-crm project → SQL Editor → paste all of `supabase/schema-apply.sql` → Run. (Idempotent; creates the tables, RLS, judge RPC, `proof` bucket, Realtime, and config with start date = today. Does not touch `contacts`.)
2. **Create the accounts + seed profiles** — one command:
   ```bash
   cd 75hard
   node scripts/setup-accounts.mjs
   ```
   It pulls the service key at runtime from your authed `supabase` CLI (nothing secret is stored on disk), creates the three logins, and seeds profiles/roles/goals. Safe to re-run. After it finishes, real login works on the live site immediately.

## Run it locally

```bash
cd 75hard
npm install
npm run dev          # uses the built-in steve-crm creds (no .env.local needed)
```

**Demo mode** (the three demo buttons on the login screen) always works with sample data, no backend needed — handy for showing the app off.

### Pointing at a different project
Drop a `.env.local` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (and set the same vars on Netlify) to override the built-in steve-crm creds.

## How the rules map to the app

- **Daily (both):** 2 workouts (Apple Watch screenshots), 3 meals, reading, progress photo = 7 photo slots; 1 gallon of water = a checkmark. All 8 done → the day is sent to Marcus.
- **Verdict:** only Marcus can approve/reject a day (enforced by the `review_day` RPC + RLS). A past day that isn't approved (incomplete, rejected) is a **fail**. One fail lights that person's forfeit on the scoreboard (authentic 75-Hard, all-or-nothing — soften it in `src/lib/challenge.js` if you want grace days).
- **Professional:** launch within 30 days + hit the target (Kyle 40 users, Dylen 10 customers) by day 75, with live countdowns on the Goals tab.

## Project map

| File | Role |
|---|---|
| `src/config.js` | Roster, daily slots, timezone, targets, forfeits |
| `src/lib/challenge.js` | All day/streak/fail/goal math (pure) |
| `src/supabaseClient.js` | Live Supabase data layer + photo resize/upload |
| `src/demoStore.js` | In-memory demo mirror |
| `src/data.js` | Facade that swaps live ↔ demo |
| `src/App.jsx` | Shell, theme (CSS-in-JS), nav, realtime |
| `src/components/*` | Today, Versus, History, Goals, JudgeQueue, Login |
| `supabase/schema-apply.sql` | Tables, RLS, judge RPC, storage policies, bucket, config |

## Deploy

Vercel (same as the sibling `crm` app). Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the Vercel project env if not using the baked-in defaults. `vercel.json` handles SPA routing.
