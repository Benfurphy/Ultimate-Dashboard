// POST /api/garmin/login — Garmin equivalent of the WHOOP/Fitbit "Connect" button.
// No OAuth screen: this logs into Garmin Connect with the user's own username +
// password (sent once, over HTTPS, never stored) and keeps only the resulting
// session tokens server-side. Garmin sometimes challenges logins from cloud IPs
// (Vercel's) with a verification step this library can't complete — when that
// happens this returns reason: 'mfa_or_blocked' so the UI can offer the
// paste-tokens fallback (see /api/garmin/tokens and GARMIN_SETUP.md).
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

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' })); return; }

  const body = await readBody(req);
  const username = body && body.username;
  const password = body && body.password;
  if (!username || !password) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'missing_credentials' })); return; }

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
};
