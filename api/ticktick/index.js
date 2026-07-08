// /api/ticktick — every TickTick action in one function, same reason as
// api/garmin/index.js and api/social.js: Vercel's Hobby plan caps a deployment
// at 12 Serverless Functions, and this project is already at that cap without
// TickTick. Adding this as a single consolidated function brings the total to
// 13 — over the Hobby-plan limit. Either upgrade to Vercel Pro, or merge one
// of the existing 12 functions before deploying this (see TICKTICK_SETUP.md).
//
// Dispatches on method + ?action=:
//   GET  /api/ticktick                  → open tasks across all projects (like WHOOP's data.js)
//   GET  /api/ticktick?action=login     → redirect to TickTick's login/consent screen
//   GET  /api/ticktick?action=callback  → OAuth redirect target; exchanges the code for tokens
//   GET  /api/ticktick?action=logout    → forget the stored session
//   POST /api/ticktick?action=complete  { projectId, id } → mark a task done
//   POST /api/ticktick?action=add       { title }         → create a task in the first project
const L = require('./_lib');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}

function handleLogin(req, res) {
  let id;
  try { id = L.creds().id; }
  catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:34rem;margin:4rem auto;line-height:1.5;color:#222">'
      + '<h2>TickTick isn’t configured yet</h2><p>Set <code>TICKTICK_CLIENT_ID</code> and <code>TICKTICK_CLIENT_SECRET</code> in your Vercel project’s Environment Variables, and register <code>' + L.redirectUri(req) + '</code> as a redirect URI in your TickTick developer app. See <code>TICKTICK_SETUP.md</code>.</p><p><a href="/">← back to the dashboard</a></p></body>');
    return;
  }
  const state = L.crypto.randomBytes(12).toString('hex');
  res.setHeader('Set-Cookie', L.cookie('ticktick_state', state, { maxAge: 600, secure: L.isHttps(req) }));
  const params = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: L.redirectUri(req), scope: L.SCOPE, state });
  res.statusCode = 302;
  res.setHeader('Location', L.AUTH_URL + '?' + params.toString());
  res.end();
}

async function handleCallback(req, res, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  const cookies = L.parseCookies(req);
  const secure = L.isHttps(req);
  // Back to goals.html, not the dashboard root — that's the only page that
  // reads ?ticktick= and knows how to show the connected state / fetch tasks.
  const back = (status) => { res.statusCode = 302; res.setHeader('Location', '/goals.html?ticktick=' + status); res.end(); };

  if (oauthErr) return back('denied');
  if (!code || !state || state !== cookies.ticktick_state) return back('error');

  let id, secret;
  try { ({ id, secret } = L.creds()); }
  catch (e) { res.statusCode = 500; res.end('TickTick not configured'); return; }

  try {
    const tok = await L.tokenRequest({ grant_type: 'authorization_code', code, scope: L.SCOPE, redirect_uri: L.redirectUri(req) }, id, secret);
    const out = [L.clearCookie('ticktick_state', secure)];
    if (tok.refresh_token) {
      out.push(L.cookie('ticktick_refresh', tok.refresh_token, { maxAge: 60 * 60 * 24 * 365, secure }));
    } else if (tok.access_token) {
      const maxAge = Math.min(Number(tok.expires_in) || 60 * 60 * 24 * 180, 60 * 60 * 24 * 180);
      out.push(L.cookie('ticktick_access', tok.access_token, { maxAge, secure }));
    }
    res.setHeader('Set-Cookie', out);
    return back(tok.refresh_token || tok.access_token ? 'connected' : 'error');
  } catch (e) {
    return back('error');
  }
}

function handleLogout(req, res) {
  const secure = L.isHttps(req);
  res.setHeader('Set-Cookie', [L.clearCookie('ticktick_refresh', secure), L.clearCookie('ticktick_access', secure)]);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ connected: false }));
}

async function handleData(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  const secure = L.isHttps(req);

  try { L.creds(); }
  catch (e) { res.end(JSON.stringify({ connected: false, error: 'not_configured' })); return; }

  let token, setCookies;
  try { ({ token, setCookies } = await L.resolveToken(req)); }
  catch (e) {
    res.setHeader('Set-Cookie', [L.clearCookie('ticktick_refresh', secure), L.clearCookie('ticktick_access', secure)]);
    res.end(JSON.stringify({ connected: false, error: 'expired' }));
    return;
  }
  if (!token) { res.end(JSON.stringify({ connected: false })); return; }
  if (setCookies && setCookies.length) res.setHeader('Set-Cookie', setCookies);

  try {
    const projects = await L.api('/project', token);
    // GET /project only lists custom lists — Inbox is a separate, special
    // "project" that has to be fetched by the literal id "inbox" and never
    // shows up here, even though it's where most quick-added tasks live.
    const lists = [{ id: 'inbox', name: 'Inbox' }].concat(Array.isArray(projects) ? projects : []);
    const perProject = await Promise.all(lists.map(p => L.api('/project/' + encodeURIComponent(p.id) + '/data', token).catch(() => null)));
    const tasks = [];
    perProject.forEach((data, i) => {
      const proj = lists[i];
      const raw = (data && Array.isArray(data.tasks)) ? data.tasks : [];
      raw.forEach(t => {
        if (t.status === 2) return; // completed — /data shouldn't return these, skip defensively
        tasks.push({ id: t.id, projectId: proj.id, title: t.title || '(untitled)', priority: t.priority || 0, dueDate: t.dueDate || null });
      });
    });
    tasks.sort((a, b) => (b.priority - a.priority));
    res.end(JSON.stringify({ connected: true, source: 'ticktick', ts: Date.now(), total: tasks.length, tasks: tasks.slice(0, 40), defaultProjectId: 'inbox' }));
  } catch (e) {
    res.end(JSON.stringify({ connected: true, source: 'ticktick', ts: Date.now(), total: 0, tasks: [], error: 'fetch_failed' }));
  }
}

async function handleComplete(req, res) {
  res.setHeader('content-type', 'application/json');
  const body = await readBody(req);
  if (!body.projectId || !body.id) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'missing projectId/id' })); return; }
  let token;
  try { ({ token } = await L.resolveToken(req)); } catch (e) { token = null; }
  if (!token) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'not_connected' })); return; }
  try {
    await L.api('/project/' + encodeURIComponent(body.projectId) + '/task/' + encodeURIComponent(body.id) + '/complete', token, { method: 'POST' });
    res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'complete_failed' }));
  }
}

async function handleAdd(req, res) {
  res.setHeader('content-type', 'application/json');
  const body = await readBody(req);
  const title = String(body.title || '').trim();
  if (!title) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'missing title' })); return; }
  let token;
  try { ({ token } = await L.resolveToken(req)); } catch (e) { token = null; }
  if (!token) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'not_connected' })); return; }
  try {
    // Default to Inbox, same as TickTick's own quick-add — not an arbitrary
    // "first custom list," which is wrong for accounts with no custom lists.
    const projectId = body.projectId || 'inbox';
    const created = await L.api('/task', token, { method: 'POST', body: { title, projectId } });
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, task: created }));
  } catch (e) {
    res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'add_failed' }));
  }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, L.getOrigin(req));
  const action = url.searchParams.get('action');

  if (req.method === 'GET') {
    if (action === 'login') return handleLogin(req, res);
    if (action === 'callback') return handleCallback(req, res, url);
    if (action === 'logout') return handleLogout(req, res);
    return handleData(req, res);
  }
  if (req.method === 'POST') {
    if (action === 'complete') return handleComplete(req, res);
    if (action === 'add') return handleAdd(req, res);
  }
  res.statusCode = 404;
  res.end();
};
