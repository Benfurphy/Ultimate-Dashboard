# Connecting Garmin (real auto-sync)

Garmin, unlike WHOOP and Fitbit, doesn't offer a self-serve developer API — their
official Health API requires applying to Garmin's Developer Program as a business,
which isn't realistic for a personal single-user dashboard.

Instead, **Today's vitals → Garmin → Connect Garmin** logs into Garmin Connect
directly with your own username/password (sent once, over HTTPS, straight to
Garmin's servers — never stored). Only the resulting session tokens are kept
server-side in an httpOnly cookie, refreshed automatically, same trust model as the
WHOOP/Fitbit refresh tokens. This runs through [`/api/garmin`](api/garmin).

This only works on a deployed host that runs serverless functions (e.g. **Vercel**).
Opened as a local file, the dashboard falls back to **Apple Watch / Manual** entry.

## Heads up: cloud logins sometimes get challenged

Garmin occasionally throws a "verify it's you" step at logins from unfamiliar IPs —
and every request from Vercel comes from a rotating cloud IP. The library this uses
doesn't have anywhere to put a verification code, so if that happens the direct
**Connect Garmin** button will just fail. If it does:

1. On your own computer (normal home/office network), run:
   ```
   npm install
   node scripts/garmin-get-tokens.js
   ```
2. It'll ask for your Garmin username/password locally and print a JSON blob.
3. In the dashboard, **Today's vitals → Garmin → paste tokens instead**, paste it in, and save.

The dashboard then reuses those tokens (refreshing, not re-logging-in), so this
should only need doing once — the token itself is what lasts, not the IP that fetched it.

## How it works

All four actions live in one function, [`api/garmin/index.js`](api/garmin/index.js) —
Vercel's Hobby plan caps a deployment at 12 Serverless Functions, so this folder
can't afford separate route files the way WHOOP/Fitbit do.

| Request | Purpose |
|---|---|
| `POST /api/garmin` `{ username, password }` | Logs into Garmin Connect; stores session tokens. |
| `POST /api/garmin` `{ tokens }` | Fallback: stores a token JSON produced by `scripts/garmin-get-tokens.js`. |
| `GET /api/garmin` | Restores the session, fetches last night's sleep + today's Body Battery &amp; Training Readiness, returns vitals. |
| `GET /api/garmin?action=logout` | Forgets the stored tokens (disconnect). |

The returned vitals (Body Battery as recovery, Training Readiness, HRV, resting HR, sleep) are written
to the suite-wide `patron_health_v1` record, so the Supplements recommender picks
them up automatically — same as manual or Apple Watch entry, just live.

> A forker who never connects Garmin just sees the **Apple Watch / Manual** options;
> nothing breaks. No env vars or Garmin developer account needed for this one.
