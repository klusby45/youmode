# You Mode

A build-your-own accountability app. Talk (or type) your goal, and it turns into a
personalized daily challenge you track your own way — a photo, a checkmark, a logged
number — solo or with friends who keep you honest.

**Live:** https://youmode.app

React 19 + Vite · Supabase (Auth + Postgres + Storage + Realtime) · Netlify (static + serverless functions) · CSS-in-JS.

## What's inside

- **Voice-first onboarding** — ramble a goal; an AI turns it into a structured challenge (daily or weekly items, photo or checkmark proof).
- **Flexible tracking** — photo proof, simple checkmarks, meal logging with macro estimates, weigh-ins.
- **Formats** — solo, head-to-head, accountability partner, or group, with optional referee review and stakes.
- **Two colorways** — Paper (warm, editorial) and Noir (black, sharp), switchable per user.

## Run it locally

```bash
npm install
npm run dev
```

The client reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from a `.env.local`,
and falls back to a demo mode when they're unset. The serverless AI functions
(`netlify/functions/*`) read their own keys from the environment — see `.env.example`.

## Project map

| Path | Role |
|---|---|
| `src/App.jsx` | Shell, theme (CSS-in-JS `THEME` string), nav, realtime |
| `src/theme.js` | The two colorways + accent maps + apply/persist |
| `src/lib/challenge.js` | Day / streak / completion math (pure) |
| `src/supabaseClient.js` | Live Supabase data layer + photo resize/upload |
| `src/components/*` | Today, Standings, History, Goals, onboarding, auth |
| `netlify/functions/*` | AI onboarding/goal coach, meal + photo estimates, transcription, auth email |
| `supabase/*.sql` | Schema, RLS, RPCs (applied by hand in the Supabase SQL editor) |

## Deploy

Netlify. `npm run build`, then `netlify deploy --prod --dir dist`. Serverless functions
build from `netlify/functions/`. AI + service keys live in the Netlify site environment,
never in the repo.

---

*Started life as a private head-to-head 75-day challenge between friends, then grew into a
general self-serve product — some legacy names and IDs linger in the git history.*
