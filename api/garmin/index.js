// /api/garmin — all Garmin actions in one function (Vercel's Hobby plan caps a
// deployment at 12 Serverless Functions, so this folder can't afford 4 separate
// route files the way WHOOP/Fitbit do). Dispatches on method + payload shape:
//   GET  /api/garmin                    → today's vitals (like WHOOP/Fitbit's data.js)
//   GET  /api/garmin?action=logout      → forget the stored session
//   GET  /api/garmin?action=activities  → recent running activities (Fitness tab)
//   POST /api/garmin  { username, password } → direct login (like a WHOOP/Fitbit "Connect")
//   POST /api/garmin  { tokens }              → fallback: store tokens from scripts/garmin-get-tokens.js
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

function toDateStr(d) { return d.toISOString().slice(0, 10); }
// Garmin's "*Local" epoch fields encode local wall-clock time as if it were UTC.
function toHHMM(msLocal) {
  if (msLocal == null) return null;
  const d = new Date(msLocal);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

// Body Battery has no named helper in the client library — hit the same
// undocumented endpoint the Garmin Connect web app itself uses, and parse
// defensively since the response shape isn't officially specified anywhere.
async function currentBodyBattery(client, dateStr) {
  try {
    // client.get() hits a bare axios instance with no base URL configured, unlike the
    // library's own named methods (which build full URLs internally) — has to be spelled out.
    const base = client.client.url.GC_API;
    const rows = await client.get(base + '/wellness-service/wellness/bodyBattery/reports/daily?startDate=' + dateStr + '&endDate=' + dateStr);
    const today = Array.isArray(rows) ? rows[rows.length - 1] : rows;
    const series = today && today.bodyBatteryValuesArray;
    if (!Array.isArray(series) || !series.length) return null;
    const last = series[series.length - 1];
    const val = Array.isArray(last) ? last[last.length - 1] : (last && last.value);
    return typeof val === 'number' ? Math.round(val) : null;
  } catch (e) { return null; }
}

// Training Readiness (0-100 + a level like "HIGH"/"MODERATE"/"LOW") is Garmin's own
// composite recovery score — distinct from Body Battery, which is an all-day energy
// gauge rather than a stable daily readiness read. Also undocumented; same defensive
// parsing approach as Body Battery.
async function trainingReadiness(client, dateStr) {
  try {
    const base = client.client.url.GC_API;
    const rows = await client.get(base + '/metrics-service/metrics/trainingreadiness/' + dateStr);
    const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    if (!list.length) return null;
    const morning = list.find(r => r && r.inputContext === 'AFTER_WAKEUP_RESET');
    const entry = morning || list[list.length - 1];
    return entry && typeof entry.score === 'number' ? Math.round(entry.score) : null;
  } catch (e) { return null; }
}

async function handleData(req, res) {
  const client = L.clientFromCookies(req);
  if (!client) { res.statusCode = 200; res.end(JSON.stringify({ connected: false })); return; }

  const dateStr = toDateStr(new Date());
  let sleep;
  try {
    sleep = await client.getSleepData();
  } catch (e) {
    // Stored session no longer valid — drop it so the UI re-prompts to connect.
    res.statusCode = 200;
    res.setHeader('Set-Cookie', L.clearTokensCookie(L.isHttps(req)));
    res.end(JSON.stringify({ connected: false, error: 'expired' }));
    return;
  }

  const dto = sleep && sleep.dailySleepDTO;
  const recovery = await currentBodyBattery(client, dateStr);
  const readiness = await trainingReadiness(client, dateStr);
  const hrv = sleep && sleep.avgOvernightHrv != null ? Math.round(sleep.avgOvernightHrv) : null;
  const rhr = sleep && sleep.restingHeartRate != null ? Math.round(sleep.restingHeartRate) : null;
  const sleepHours = dto && dto.sleepTimeSeconds != null ? Math.round((dto.sleepTimeSeconds / 3600) * 10) / 10 : null;
  const sleepPerf = dto && dto.sleepScores && dto.sleepScores.overall ? Math.round(dto.sleepScores.overall.value) : null;
  const bedtime = toHHMM(dto && dto.sleepStartTimestampLocal);
  const wakeTime = toHHMM(dto && dto.sleepEndTimestampLocal);

  res.statusCode = 200;
  res.end(JSON.stringify({
    connected: true, source: 'garmin', ts: Date.now(),
    recovery, trainingReadiness: readiness, hrv, rhr, sleepPerf, sleepHours, sleepTargetHours: 8, bedtime, wakeTime,
  }));
}

// Garmin's activity list has no "running only" filter that reliably covers every
// running sub-type (treadmill/trail/track/virtual runs all use different typeKeys),
// so fetch broadly and filter client-side on the typeKey containing "run".
function isRun(typeKey) { return /run/i.test(String(typeKey || '')); }
// "startTimeGMT" comes back as "YYYY-MM-DD HH:mm:ss" (space-separated, already UTC).
function parseGmt(s) { return s ? new Date(String(s).replace(' ', 'T') + 'Z').getTime() : null; }

async function handleActivities(req, res) {
  const client = L.clientFromCookies(req);
  if (!client) { res.statusCode = 200; res.end(JSON.stringify({ connected: false })); return; }

  let raw;
  try {
    raw = await client.getActivities(0, 100);
  } catch (e) {
    res.statusCode = 200;
    res.setHeader('Set-Cookie', L.clearTokensCookie(L.isHttps(req)));
    res.end(JSON.stringify({ connected: false, error: 'expired' }));
    return;
  }

  const list = Array.isArray(raw) ? raw : [];
  const activities = list
    .filter(a => a && isRun(a.activityType && a.activityType.typeKey))
    .map(a => {
      const distanceKm = a.distance != null ? a.distance / 1000 : null;
      const durationSec = (a.movingDuration || a.duration || 0) || null;
      const paceMinPerKm = (distanceKm && durationSec) ? (durationSec / 60) / distanceKm : null;
      return {
        id: a.activityId,
        name: a.activityName || 'Run',
        ts: parseGmt(a.startTimeGMT) || Date.now(),
        distanceKm, durationSec,
        avgHR: a.averageHR != null ? Math.round(a.averageHR) : null,
        vo2max: a.vO2MaxValue != null ? Math.round(a.vO2MaxValue) : null,
        paceMinPerKm,
      };
    })
    .sort((x, y) => y.ts - x.ts);

  res.statusCode = 200;
  res.end(JSON.stringify({ connected: true, source: 'garmin', ts: Date.now(), activities }));
}

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', L.clearTokensCookie(L.isHttps(req)));
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

async function handleLogin(req, res, body) {
  const username = body && body.username;
  const password = body && body.password;
  const secure = L.isHttps(req);
  const client = new L.GarminConnect({ username, password });
  try {
    await client.login();
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: L.loginErrorReason(e) }));
    return;
  }
  const tokens = client.exportToken();
  res.statusCode = 200;
  res.setHeader('Set-Cookie', L.tokensCookie(tokens, secure));
  res.end(JSON.stringify({ ok: true }));
}

function handleSaveTokens(req, res, body) {
  const tokens = body && body.tokens;
  if (!tokens || !tokens.oauth1 || !tokens.oauth2) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'invalid_tokens' })); return; }
  res.statusCode = 200;
  res.setHeader('Set-Cookie', L.tokensCookie(tokens, L.isHttps(req)));
  res.end(JSON.stringify({ ok: true }));
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action === 'logout') { handleLogout(req, res); return; }
    if (action === 'activities') { await handleActivities(req, res); return; }
    await handleData(req, res);
    return;
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (body && body.tokens) { handleSaveTokens(req, res, body); return; }
    if (body && body.username && body.password) { await handleLogin(req, res, body); return; }
    res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'missing_credentials' }));
    return;
  }
  res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
};
