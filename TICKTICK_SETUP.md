# Connecting TickTick (real to-do sync)

The **To Do** tile's checklist and `goals.html`'s **Connect TickTick** button use
TickTick's official Open API (OAuth2) — a different thing from `mcp.ticktick.com`,
which is a Model Context Protocol server for AI assistants (Claude, etc.), not
something a browser can call directly. The flow here runs through a serverless
function at [`/api/ticktick`](api/ticktick) so your **client secret never touches
the browser**.

This only works on a deployed host that runs serverless functions (e.g. **Vercel**).
Opened as a local file, or without TickTick connected, `goals.html` falls back to
the original local list (same `goals:<date>` storage + rollover it always had).

## ⚠️ Before you deploy: Vercel's 12-function cap

Vercel's **Hobby plan caps a deployment at 12 Serverless Functions**, and this
project is already sitting at exactly 12 without TickTick (`config`, `social`,
`fitbit` ×4, `garmin`, `vald`, `whoop` ×4). Everything TickTick needs is
consolidated into **one** function (`api/ticktick/index.js`, dispatched by
`?action=`, same trick `garmin` and `social` already use) — but that's still a
13th function. Before this will deploy, do **one** of:

- **Upgrade to Vercel Pro** (raises the function cap well past 13), or
- **Free up a slot** — e.g. fold `api/social.js` (TikTok/YouTube stat lookups,
  probably the least-used function here) into another file the same way, or
  drop an integration you're not using.

If you skip this, Vercel will simply refuse to deploy until you're back at ≤12
(or ≤ whatever your plan allows) — nothing on the client breaks, it just won't
build.

## One-time setup

1. **Create a TickTick app** at <https://developer.ticktick.com> → *Manage Apps* → *App Registration*.
2. Note the **Client ID** and **Client Secret**.
3. Add a **Redirect URI** to the app, matching your deployment exactly (note this
   is a query param on `/api/ticktick`, not its own path — that's the
   consolidation from above):
   - Production: `https://YOUR-APP.vercel.app/api/ticktick?action=callback`
   - Local (`vercel dev`): `http://localhost:3000/api/ticktick?action=callback`
4. Scopes requested: `tasks:read tasks:write` (TickTick doesn't support finer-grained scopes).
5. In **Vercel → Project → Settings → Environment Variables**, set:
   - `TICKTICK_CLIENT_ID`
   - `TICKTICK_CLIENT_SECRET`

   (For local dev, put the same two lines in `.env`.)
6. Redeploy. Open **To Do** (`goals.html`) → **Connect TickTick**.

## How it works

| Request | Purpose |
|---|---|
| `GET /api/ticktick?action=login` | Redirects to TickTick's login/consent screen (with a CSRF `state`). |
| `GET /api/ticktick?action=callback` | Exchanges the code for tokens. Stores a **refresh token** if TickTick returns one; otherwise falls back to storing the (long-lived, ~6 month) **access token** directly — TickTick's refresh-token support isn't consistently documented, so both paths are handled. |
| `GET /api/ticktick` | Resolves a valid access token (refreshing if needed), lists every project, pulls each project's **open** tasks, and returns one flat list — priority-flagged tasks first. |
| `POST /api/ticktick?action=complete` `{ projectId, id }` | Marks a task done in TickTick. |
| `POST /api/ticktick?action=add` `{ title, projectId? }` | Creates a task (defaults to your first project if none given). |
| `GET /api/ticktick?action=logout` | Forgets the stored token (disconnect). |

## What you get vs. what you don't

TickTick's Open API is built around active task management, not historical
analytics — the project-data endpoint only returns **open** (uncompleted) tasks,
the same way TickTick's own list view works. So:

- ✅ Live open-task list, priority-sorted, checkable from the dashboard.
- ✅ Adding a task from `goals.html` creates it in TickTick for real.
- ❌ No "completed today" count or streak-style history — there's no reliable way
  to ask the Open API "what did I finish today," so the tile shows **open task
  count**, not a done/total ratio.

> A forker without TickTick env vars set just sees the original local to-do list;
> nothing breaks.

## One more thing worth knowing

I couldn't test this OAuth flow end-to-end — that needs your real TickTick app
credentials, which only you have. It follows the exact same shape as the WHOOP
integration (see `WHOOP_SETUP.md`), which *is* battle-tested in this repo, but
give the first **Connect TickTick** attempt a close look and tell me what you see
if it doesn't come back "connected."
